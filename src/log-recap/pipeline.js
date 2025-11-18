import { segmentIntoTurns } from '../log-pipeline/semantic-analyzer.js'
import { StructuredDigestExtractor } from '../log-pipeline/log-structured-digest.js'

const CHUNK_EVENT_LIMIT = 80
const CHUNK_CHAR_LIMIT = 18000
const SUMMARY_ITEM_LIMIT = 6

/**
 * Main pipeline used by worker and CLI.
 */
function preprocessChatJson(inputText) {
  try {
    const parsed = JSON.parse(inputText)
    if (parsed.version && parsed.conversation?.chatHistory) {
      // Extract clean conversation text with markers
      const history = parsed.conversation.chatHistory
      const cleanText = history
        .filter(item => item.chatItemType !== 'agentic-checkpoint-delimiter')
        .map(item => {
          const userMsg = (item.request_message || '').replace(/\{.*?\}/gs, '').trim()
          const agentMsg = (item.response_text || '').replace(/\{.*?\}/gs, '').trim()
          return `USER: ${userMsg}\nAGENT: ${agentMsg}`.trim()
        })
        .filter(text => text.length > 10) // Skip very short
        .join('\n\n')
      return cleanText || inputText
    }
  } catch (e) {
    // Not JSON, return as is
  }
  return inputText
}

export async function runLogRecapPipeline(inputText, { maxEventsPerChunk = CHUNK_EVENT_LIMIT } = {}) {
  const start = Date.now()

  // 1) Pre-processing
  const processedText = preprocessChatJson(inputText)
  const turns = segmentIntoTurns(processedText)
  const extractor = new StructuredDigestExtractor(processedText, turns)
  const digest = extractor.extract()
  // Filter low-relevance errors for chat context
  if (digest.errorSignatures) {
    console.log('Before filter:', digest.errorSignatures.length)
    digest.errorSignatures = digest.errorSignatures.filter(sig => {
      const match = /run out of credits|failed to build|exit code|npm ci|npm install/i.test(sig.toLowerCase())
      if (match) console.log('Filtering:', sig.substring(0, 50))
      return !match
    })
    console.log('After filter:', digest.errorSignatures.length)
  }

  const timeline = buildEventTimeline(digest)
  const chunks = buildChunks(timeline, maxEventsPerChunk)

  // 2) Per-chunk synthesis
  const chunkSummaries = chunks.map(chunk => summarizeChunkLocally(chunk))

  // 3) Final synthesis
  const finalSummary = stitchNarrativeLocally(chunkSummaries, digest, timeline)

  return {
    compressed: finalSummary.text,
    chunkSummaries,
    digest,
    events: timeline,
    stats: {
      mode: 'log-recap',
      originalSize: +(inputText.length / 1024).toFixed(2),
      compressedSize: +(finalSummary.text.length / 1024).toFixed(2),
      originalLines: inputText.split('\n').length,
      originalTurns: turns.length,
      chunksProcessed: chunks.length,
      sizeReduction: Math.max(0, Math.round((1 - (finalSummary.text.length / Math.max(inputText.length, 1))) * 100)),
      totalTokensUsed: 0,
      processingTimeMs: Date.now() - start
    }
  }
}

function buildEventTimeline(digest) {
  const timeline = []
  const turns = Array.isArray(digest.enrichedTurns) ? digest.enrichedTurns : []
  const maxEvents = Math.max(400, Math.min(2400, Math.floor(turns.length * 0.75)))
  const commandHashes = new Set()

  const briefingEvents = extractBriefingEvents(turns)
  timeline.push(...briefingEvents)

  // Find last user/agent indices first
  let lastUserIdx = -1
  let lastAgentIdx = -1
  for (const turn of turns) {
    if (turn.text.startsWith('USER:')) lastUserIdx = Math.max(lastUserIdx, turn.idx)
    if (turn.text.startsWith('AGENT:')) lastAgentIdx = Math.max(lastAgentIdx, turn.idx)
  }

  // Collect all potential events, prioritizing user messages and recent ones
  const allEvents = []
  const userEvents = []
  for (const turn of turns) {
    const event = turnToEvent(turn)
    if (!event) continue

    // Mark last user/agent
    if (turn.idx === lastUserIdx) event.isLastUser = true
    if (turn.idx === lastAgentIdx) event.isLastAgent = true

    if (event.intent === 'command') {
      const hash = `${event.intent}:${event.summary}`
      if (commandHashes.has(hash)) continue
      commandHashes.add(hash)
    }

    allEvents.push(event)

    // Separate user events
    if (turn.text.startsWith('USER:')) {
      userEvents.push(event)
    }
  }

  // Include all user events, then fill with recent non-user events
  const includedEvents = new Set(userEvents.map(e => e.id))
  timeline.push(...userEvents)

  const remainingSlots = maxEvents - briefingEvents.length - userEvents.length
  if (remainingSlots > 0) {
    const nonUserEvents = allEvents.filter(e => !includedEvents.has(e.id))
    const recentNonUser = nonUserEvents
      .sort((a, b) => b.order - a.order)
      .slice(0, remainingSlots)
      .sort((a, b) => a.order - b.order)
    timeline.push(...recentNonUser)
  }

  // Sort timeline chronologically
  timeline.sort((a, b) => a.order - b.order)

  if (timeline.length === 0 && Array.isArray(digest.files)) {
    digest.files.forEach((file, idx) => {
      timeline.push({
        id: `file_${idx}`,
        type: 'action',
        summary: `Worked on ${file.path} (${file.actions.join(', ')})`,
        files: [file.path],
        errors: file.errors || [],
        actor: 'system',
        order: timeline.length
      })
    })
  }

  appendErrorHighlights(timeline, digest.errors || [])
  return timeline
}

function buildChunks(events, maxEventsPerChunk) {
  if (events.length === 0) {
    return [{
      id: 'chunk_0',
      events: [],
      context: 'No structured events were found.',
      approxChars: 0
    }]
  }

  const chunks = []
  let current = { id: `chunk_0`, events: [], approxChars: 0 }

  events.forEach((event, idx) => {
    const eventText = formatEventForPrompt(event)
    const tentativeChars = current.approxChars + eventText.length

    if (
      (current.events.length >= maxEventsPerChunk) ||
      (tentativeChars > CHUNK_CHAR_LIMIT && current.events.length > 0)
    ) {
      current.context = buildChunkContext(current)
      chunks.push(current)
      current = { id: `chunk_${chunks.length}`, events: [], approxChars: 0 }
    }

    current.events.push({ ...event, promptText: eventText })
    current.approxChars += eventText.length

    if (idx === events.length - 1) {
      current.context = buildChunkContext(current)
      chunks.push(current)
    }
  })

  return chunks
}

function buildChunkContext(chunk) {
  const header = `Events: ${chunk.events.length}`
  const files = new Set()
  const errors = new Set()
  chunk.events.forEach(evt => {
    evt.files?.forEach(f => files.add(f))
    evt.errors?.forEach(e => errors.add(e))
  })

  const lines = chunk.events.map((evt, idx) => `${idx + 1}. ${evt.promptText}`)
  return [
    header,
    files.size ? `Files: ${Array.from(files).slice(0, 6).join(', ')}` : '',
    errors.size ? `Errors: ${Array.from(errors).slice(0, 4).join(', ')}` : '',
    '',
    'Timeline:',
    ...lines
  ].filter(Boolean).join('\n')
}

function summarizeChunkLocally(chunk) {
  const groups = {
    briefing: [],
    action: [],
    error: [],
    decision: [],
    note: [],
    command: []
  }

  chunk.events.forEach(event => {
    const targetGroup =
      event.type === 'briefing' ? 'briefing' :
      event.intent === 'command' ? 'command' :
      event.type === 'action' ? 'action' :
      event.type === 'error' ? 'error' :
      event.type === 'decision' ? 'decision' :
      'note'

    groups[targetGroup].push(event.summary)
  })

  Object.keys(groups).forEach(key => {
    groups[key] = dedupeStrings(groups[key])
  })

  const lines = []
  const sectionOrder = [
    { label: 'Initial context', key: 'briefing', limit: 3 },
    { label: 'Investigations', key: 'command', limit: 4 },
    { label: 'Implementation', key: 'action', limit: 5 },
    { label: 'Issues', key: 'error', limit: 5 },
    { label: 'Decisions', key: 'decision', limit: 3 },
    { label: 'Notes', key: 'note', limit: 3 }
  ]

  sectionOrder.forEach(({ label, key, limit }) => {
    const sectionLine = formatGroupSection(label, groups[key], limit)
    if (sectionLine) {
      lines.push(sectionLine)
    }
  })

  return {
    chunkId: chunk.id,
    text: lines.join('\n'),
    events: chunk.events,
    tokensUsed: 0,
    source: 'local',
    groups
  }
}

function stitchNarrativeLocally(chunkSummaries, digest, timeline) {
  const lines = []
  lines.push('## Overview')
  lines.push(`Session touched ${digest.files?.length || 0} files and ${digest.errors?.length || 0} primary issues.`)
  const aggregatedGroups = aggregateGroups(chunkSummaries)
  lines.push('')
  lines.push('## Highlights')
  // Find last user event
  const lastUserEvent = timeline.find(e => e.isLastUser)
  const lastUserSection = lastUserEvent ? [{ label: 'Last User Interaction', entries: [lastUserEvent.summary], limit: 1 }] : []

  const highlightSections = [
    { label: 'Briefing', entries: aggregatedGroups.briefing, limit: 3 },
    { label: 'Investigations', entries: aggregatedGroups.command, limit: 8 },
    { label: 'Implementations', entries: aggregatedGroups.action, limit: 8 },
    { label: 'Decisions', entries: aggregatedGroups.decision, limit: 5 },
    { label: 'Notes', entries: aggregatedGroups.note, limit: 3 },
    ...lastUserSection
  ]
  let highlightsAdded = false
  highlightSections.forEach(({ label, entries, limit }) => {
    const formatted = formatGroupSection(label, entries, limit)
    if (formatted) {
      lines.push(`- ${formatted}`)
      highlightsAdded = true
    }
  })
  if (!highlightsAdded) {
    lines.push('- No major highlights were extracted.')
  }
  lines.push('')
  lines.push('## Issues & Resolutions')
  const problemLines = buildProblemResolutionLines(digest)
  if (problemLines.length) {
    problemLines.forEach(line => lines.push(`- ${line}`))
  } else {
    lines.push('- No critical issues highlighted.')
  }
  lines.push('')
  lines.push('## Next Steps')
  if (digest.plans?.nextSteps?.length) {
    digest.plans.nextSteps.slice(0, 3).forEach(step => lines.push(`- ${step}`))
  } else {
    lines.push('- Define next steps based on the timeline above.')
  }
  lines.push('')
  lines.push('## Detailed Timeline')
  chunkSummaries.forEach((summary, idx) => {
    if (!summary.text) return
    lines.push(`### Block ${idx + 1}`)
    summary.text.split('\n').forEach(line => {
      if (line) {
        lines.push(`- ${line}`)
      }
    })
    lines.push('')
  })

  return {
    text: lines.join('\n'),
    tokensUsed: 0,
    source: 'local'
  }
}

function buildProblemResolutionLines(digest) {
  const errors = Array.isArray(digest.errors) ? digest.errors : []
  const filesMap = new Map()
  const files = Array.isArray(digest.files) ? digest.files : []
  files.forEach(file => {
    (file.errors || []).forEach(err => {
      if (!filesMap.has(err)) filesMap.set(err, [])
      filesMap.get(err).push(file.path)
    })
  })

  return errors.slice(0, 6).map(err => {
    const files = filesMap.get(err.signature) || err.fixes || []
    const scope = files.length ? ` (affected ${files.slice(0, 2).join(', ')})` : ''
    const status = err.resolved ? 'resolved' : 'pending'
    const title = truncateSentence(err.message, 80)
    return `${title}${scope} — ${status}`
  })
}

function aggregateGroups(chunkSummaries) {
  const buckets = {
    briefing: [],
    action: [],
    error: [],
    decision: [],
    note: [],
    command: []
  }

  chunkSummaries.forEach(summary => {
    if (!summary?.groups) return
    Object.keys(buckets).forEach(key => {
      if (summary.groups[key]?.length) {
        buckets[key].push(...summary.groups[key])
      }
    })
  })

  Object.keys(buckets).forEach(key => {
    buckets[key] = dedupeStrings(buckets[key])
  })
  return buckets
}

function formatGroupSection(label, entries = [], limit = SUMMARY_ITEM_LIMIT) {
  if (!entries || !entries.length) return ''
  const unique = dedupeStrings(entries)
  if (unique.length === 0) return ''
  const simplified = unique.map(compactSummaryEntry).filter(Boolean)
  if (!simplified.length) return ''
  const shown = simplified.slice(0, limit)
  const extra = unique.length > limit ? ` (+${unique.length - limit} more)` : ''
  return `${label}: ${shown.join('; ')}${extra}`
}

function dedupeStrings(entries = []) {
  return Array.from(new Set(entries.filter(Boolean).map(str => str.trim()))).filter(Boolean)
}

function compactSummaryEntry(entry) {
  if (!entry) return ''
  const clause = extractPrimaryClause(entry)
  return truncateSentence(clause, 140)
}

function extractBriefingEvents(turns) {
  const events = []
  for (const turn of turns) {
    const text = (turn.text || '').trim()
    if (!text) continue
    if (turn.type === 'user_request' && /^[›>]/.test(text)) {
      events.push({
        id: `brief_${turn.idx}`,
        type: 'briefing',
        summary: text.replace(/^[›>\s]+/, '').trim(),
        files: turn.filesReferenced || [],
        errors: [],
        actor: 'user',
        order: events.length
      })
    } else if (events.length > 0) {
      break
    }
  }
  return events.slice(0, 3)
}

function relevanceScorer(turn, rawText) {
  let score = 0
  // Boost user messages (conversational, important)
  if (rawText.startsWith('USER:')) score += 5
  // Files and errors are high signal
  score += (turn.filesReferenced?.length || 0) * 2
  score += (turn.errorSignatures?.length || 0) * 1 // Reduce error weight for chat context
  // Action verbs indicate changes/decisions
  const actionWords = ['add', 'create', 'update', 'delete', 'fix', 'refactor', 'run', 'change', 'modify', 'configure', 'debug', 'investigate', 'implement', 'deploy', 'test', 'connect', 'refresh', 'token']
  score += actionWords.filter(word => rawText.toLowerCase().includes(word)).length
  // Penalize generic errors or build failures, or low-value content
  if (/error|exit code|failed to build|auth_expired|⚠️|you have run out of credits|here's the result/i.test(rawText.toLowerCase())) score -= 5
  // Penalize machine-like logs
  if (/log =>|CACHED|COPY|\.npmrc|package-lock/i.test(rawText)) score -= 2
  // Penalize high JSON density (likely tool output)
  const jsonMatches = rawText.match(/\{|\}|\[|\]|".*?":/g) || []
  const jsonDensity = jsonMatches.length / Math.max(rawText.length, 1)
  if (jsonDensity > 0.05) score -= Math.min(jsonDensity * 20, 10)
  // Code-like content (paths, brackets)
  if (/src\/|lib\/|\.js|\.ts/i.test(rawText)) score += 1
  // Length bonus (longer turns often more detailed)
  score += Math.min(rawText.length / 100, 2)
  // Recency bonus (higher idx)
  score += (turn.idx || 0) / 100
  return score
}

function turnToEvent(turn) {
  const rawText = turn.text || ''
  // Clean markers for processing
  const cleanText = rawText.replace(/^USER:\s*|^AGENT:\s*/, '').trim()
  const score = relevanceScorer(turn, rawText)

  // Filter out low-signal content: JSON artifacts, tool outputs, low scores
  const noiseRegex = /no matches found|file not found|regex search results|here's the result|note:\nend line|total lines in file|successfully edited|file saved|command completed|\{.*?\}|\[.*?\]|encrypted_content|tool_use_id|⚠️|run out of credits/i
  if (score < 4 || noiseRegex.test(rawText)) {
    if (rawText.startsWith('USER:')) console.log('Filtering USER turn:', rawText.substring(0, 100), 'score:', score)
    if (noiseRegex.test(rawText)) console.log('Filtering noise:', rawText.substring(0, 50))
    return null
  }

  const { type, intent } = normalizeEventType(turn, cleanText)
  // Skip low-relevance errors
  if (intent === 'error' && score < 5) return null
  const summary = humanizeTurnText(turn, cleanText, intent)
  if (!summary) return null

  if (type === 'note' && intent !== 'code_change' && !(turn.filesReferenced?.length || turn.errorSignatures?.length)) {
    return null
  }

  return {
    id: `turn_${turn.idx}`,
    type,
    intent,
    summary,
    files: turn.filesReferenced || [],
    errors: turn.errorSignatures || [],
    actor: type === 'briefing' ? 'user' : 'agent',
    order: turn.idx,
    isLastUser: false,
    isLastAgent: false
  }
}

function normalizeEventType(turn, text) {
  const lowered = text.toLowerCase()
  if (turn.type === 'error' || /error|failed|exception|panic|crash|timeout|fatal|segfault/.test(lowered)) {
    return { type: 'error', intent: 'issue' }
  }
  if (/bash -lc|rg -n|ls -la|pnpm|npm|yarn|git\s|xcode|gradle|adb|fastlane|flutter|expo|buck|bazel/i.test(lowered)) {
    return { type: 'action', intent: 'command' }
  }
  if (turn.type === 'action' || /(added|created|updated|implemented|refactor|hook|dialog|route|screen|view|component|service|controller|handler|api|endpoint|migration|schema|adapter|widget|fragment|activity|swift|kotlin|objective\-c|java|android|ios|flutter|react native|lambda|cloud|infra|terraform|helm|docker|kubernetes|monitoring|telemetry|ci|cd)/i.test(text)) {
    return { type: 'action', intent: 'code_change' }
  }
  if (turn.type === 'decision' || turn.milestoneTags?.length || /(decide|plan|milestone|stack|should focus|roadmap|next steps|prioritize|strategy|architecture|approach|proposal)/i.test(text)) {
    return { type: 'decision', intent: 'decision' }
  }
  return { type: 'note', intent: 'note' }
}

function humanizeTurnText(turn, text, intent) {
  // Remove markers
  const cleanText = text.replace(/^USER:\s*|^AGENT:\s*/, '')
  const normalized = normalizeNarrativeText(cleanText)
  if (!normalized) return ''

  if (intent === 'command') {
    return summarizeCommand(normalized)
  }

  const diffSummary = summarizeDiff(turn.text || '', turn.filesReferenced || [])
  if (diffSummary) {
    return diffSummary
  }

  const focus = extractPrimaryClause(normalized)

  if (/error/i.test(focus) && turn.errorSignatures?.length) {
    return `Error ${turn.errorSignatures[0]}: ${truncateSentence(focus, 200)}`
  }

  if (intent === 'decision') {
    return formatDecisionSummary(focus)
  }

  if (turn.filesReferenced?.length) {
    const filesSnippet = turn.filesReferenced.slice(0, 2).join(', ')
    const actionVerb = extractActionVerb(focus)
    const detail = extractKeyDetail(focus, turn.filesReferenced)
    const suffix = detail ? ` – ${detail}` : ''
    return `${actionVerb} ${filesSnippet}${suffix}`
  }

  const limit = turn.isLastUser || turn.isLastAgent ? 1000 : 200

  if (turn.intent === 'note') {
    return truncateSentence(focus, limit)
  }

  return truncateSentence(focus, limit)
}

function summarizeCommand(text) {
  const lowered = text.toLowerCase()
  const lineMatch = text.match(/^\s*(\d{2,5})\s+-/)
  if (lineMatch) {
    return `Inspected code around line ${lineMatch[1]}`
  }
  if (/rg -n/.test(lowered) || /ripgrep/.test(lowered)) {
    return 'Scanned repository with ripgrep'
  }
  if (/ls -/.test(lowered)) {
    return 'Listed directories to map artifacts'
  }
  if (/pnpm lint|npm run lint|yarn lint/.test(lowered)) {
    return 'Ran lint to validate types/rules'
  }
  if (/git status/.test(lowered)) {
    return 'Checked repository status (git status)'
  }
  if (/bash -lc/.test(lowered) && /nl -ba/.test(lowered)) {
    return 'Read files with numbering for contextual review'
  }
  if (/bash -lc/.test(lowered) && /rg/.test(lowered)) {
    return 'Executed custom grep to locate routes/plans'
  }
  return `Ran command: ${truncateSentence(text, 160)}`
}

function summarizeDiff(rawText, files) {
  const diffHeader = rawText.match(/•\s+(Added|Edited|Deleted)\s+([^\s]+)\s+\(\+(\d+)\s+-?(\d+)\)/i)
  if (diffHeader) {
    const [, verb, file, added, removed] = diffHeader
    const friendlyVerb = verb.toLowerCase()
      .replace('added', 'Added')
      .replace('edited', 'Updated')
      .replace('deleted', 'Removed')
    return `${friendlyVerb} ${file} (+${added.trim()} / -${removed.trim()})`
  }

  const ref = files?.[0]
  if (ref && /<Dialog|<View|<Screen|class\s+/.test(rawText)) {
    return `Updated ${ref} (${truncateSentence(rawText, 140)})`
  }

  return ''
}

function normalizeNarrativeText(text) {
  return (text || '')
    .replace(/^\s*[-•]+\s*/g, '')
    .replace(/^\d+\s+\+\s+/g, '')
    .replace(/^\s*(Implementation|Investigation|Issues?|Notes?):\s*/i, '')
    .replace(/\\n/g, ' ')
    .replace(/└.*$/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function extractPrimaryClause(text) {
  if (!text) return ''
  const parts = text.split(/(?:;|\s{2,}| -- | — | – )+/).map(part => part.trim()).filter(Boolean)
  if (parts.length === 0) return text.trim()
  const clause = parts.slice(0, 2).join('; ')
  return clause || text.trim()
}

function extractKeyDetail(text, files = []) {
  if (!text) return ''
  let detail = text
  if (files.length) {
    const escaped = files[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const regex = new RegExp(`\\b${escaped}\\b`, 'i')
    detail = detail.replace(regex, '').trim()
  }
  detail = detail.replace(/^(Updated|Refactored|Changed|Fixed|Added)\s+/i, '').trim()
  detail = detail.replace(/^[\u2014\u2013\-:]+\s*/, '')
  detail = extractPrimaryClause(detail)
  return truncateSentence(detail, 160)
}

function formatDecisionSummary(text) {
  if (!text) return ''
  const lowered = text.toLowerCase()
  if (/^(will|should|plan|decided|prioritize|focus)/.test(lowered)) {
    return `Decision: ${truncateSentence(text, 200)}`
  }
  return `Decision: ${truncateSentence(`to ${text}`, 200)}`
}

function extractActionVerb(text) {
  if (/implement/i.test(text)) return 'Implemented'
  if (/refactor/i.test(text)) return 'Refactored'
  if (/update|updated/i.test(text)) return 'Updated'
  if (/create|created/i.test(text)) return 'Created'
  if (/add|added/i.test(text)) return 'Added'
  if (/fix|fixed/i.test(text)) return 'Fixed'
  if (/ran/i.test(text)) return 'Ran'
  return 'Changed'
}

function truncateSentence(text, limit = 240) {
  return text.length > limit ? `${text.slice(0, limit)}…` : text
}

function appendErrorHighlights(timeline, errors) {
  (errors || []).slice(0, 5).forEach((err, idx) => {
    timeline.push({
      id: `error_${idx}`,
      type: 'error',
      summary: `Error ${err.signature}: ${truncateSentence(err.message, 180)}`,
      files: err.fixes || [],
      errors: [err.signature],
      actor: 'system',
      order: timeline.length + idx
    })
  })
}

function formatEventForPrompt(event) {
  const files = event.files?.length ? `Files: ${event.files.slice(0, 3).join(', ')}` : ''
  const errors = event.errors?.length ? `Errors: ${event.errors.slice(0, 2).join(', ')}` : ''
  const info = [files, errors].filter(Boolean).join(' | ')
  return `[${event.type}] ${event.summary}${info ? ` (${info})` : ''}`
}

function collapseWhitespace(text) {
  return (text || '').replace(/\s+/g, ' ').trim()
}
