import { segmentIntoTurns } from '../log-pipeline/semantic-analyzer.js'
import { StructuredDigestExtractor } from '../log-pipeline/log-structured-digest.js'

const CHUNK_EVENT_LIMIT = 80
const CHUNK_CHAR_LIMIT = 18000
const SUMMARY_ITEM_LIMIT = 6

/**
 * Main pipeline used by worker and CLI.
 */
export async function runLogRecapPipeline(inputText, { maxEventsPerChunk = CHUNK_EVENT_LIMIT } = {}) {
  const start = Date.now()

  // 1) Pre-processing
  const turns = segmentIntoTurns(inputText)
  const extractor = new StructuredDigestExtractor(inputText, turns)
  const digest = extractor.extract()

  const timeline = buildEventTimeline(digest)
  const chunks = buildChunks(timeline, maxEventsPerChunk)

  // 2) Per-chunk synthesis
  const chunkSummaries = chunks.map(chunk => summarizeChunkLocally(chunk))

  // 3) Final synthesis
  const finalSummary = stitchNarrativeLocally(chunkSummaries, digest)

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

  for (const turn of turns) {
    if (timeline.length >= maxEvents) break
    const event = turnToEvent(turn)
    if (!event) continue

    if (event.intent === 'command') {
      const hash = `${event.intent}:${event.summary}`
      if (commandHashes.has(hash)) continue
      commandHashes.add(hash)
    }

    timeline.push(event)
  }

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

function stitchNarrativeLocally(chunkSummaries, digest) {
  const lines = []
  lines.push('## Overview')
  lines.push(`Session touched ${digest.files?.length || 0} files and ${digest.errors?.length || 0} primary issues.`)
  const aggregatedGroups = aggregateGroups(chunkSummaries)
  lines.push('')
  lines.push('## Highlights')
  const highlightSections = [
    { label: 'Briefing', entries: aggregatedGroups.briefing, limit: 4 },
    { label: 'Investigations', entries: aggregatedGroups.command, limit: 6 },
    { label: 'Implementations', entries: aggregatedGroups.action, limit: 6 },
    { label: 'Decisions', entries: aggregatedGroups.decision, limit: 4 },
    { label: 'Notes', entries: aggregatedGroups.note, limit: 4 }
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

function turnToEvent(turn) {
  const rawText = collapseWhitespace(turn.text || '')
  if (!rawText) return null
  if (/resumo final sintetizado/i.test(rawText)) return null
  if (turn.type === 'user_request' && !/^[›>]/.test(rawText)) return null
  if (/^[›>]/.test(rawText) && turn.type !== 'user_request') return null
  if (/^\s*•\s*i(?:\s+(?:need|see|saw|notice|noticed|plan|intend|want|should|will|also|must|can|could)|(?:['’]m|['’]d|['’]ll))/i.test(turn.text || '')) return null
  if (/^\s*•\s*(explored|analysis)/i.test(turn.text || '')) return null

  const hasSignal =
    (turn.filesReferenced?.length || 0) > 0 ||
    (turn.errorSignatures?.length || 0) > 0 ||
    /(added|created|updated|deleted|fixed|refactor|ran |error|tenant|hook|dialog|route|api|plan|doc|test|lint|deploy|schema|apollo|payload)/i.test(rawText)

  if (!hasSignal) return null

  const { type, intent } = normalizeEventType(turn, rawText)
  const summary = humanizeTurnText(turn, rawText, intent)
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
    order: turn.idx
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
  const normalized = normalizeNarrativeText(text)
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

  if (turn.intent === 'note') {
    return truncateSentence(focus, 200)
  }

  return truncateSentence(focus, 200)
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
