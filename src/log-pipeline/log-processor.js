import {
  newlineRegex,
  placeholderRules,
  CATEGORY_RULES,
  timestampRegex,
  uuidRegex,
  ipRegex,
  longHexRegex,
  pidRegex,
  jwtRegex,
  emailRegex
} from '../config.js'
import { logPipelineConfig } from './pipeline-config.js'
import { Compression } from '../utils/compression.js'

const NOISE_PATTERNS = logPipelineConfig.noisePatterns
const MESSAGE_WEIGHTS = logPipelineConfig.messageWeights
const LATENCY_BUCKETS = logPipelineConfig.latencyBuckets
const STATUS_WEIGHTS = logPipelineConfig.statusWeights
const DEBUG_SCORE = logPipelineConfig.debugScore
const KEEP_FILE_LINE_PREFIX = logPipelineConfig.keepFileLinePrefix
const PRESERVE_TIMESTAMPS = logPipelineConfig.preserveTimestamps
const KEEP_HUMAN_NOTES = logPipelineConfig.keepHumanNotes
const STACK_PREVIEW_HEAD = logPipelineConfig.stackFramePreviewHead
const STACK_PREVIEW_TAIL = logPipelineConfig.stackFramePreviewTail

export function redactSensitiveData(lines) {
  return lines.map(line => {
    let redacted = line

    // Redact JWT tokens - replace with {JWT}
    redacted = redacted.replace(jwtRegex, '{JWT}')

    // Redact long hex strings that might be session tokens
    redacted = redacted.replace(longHexRegex, '{HEX}')

    // Redact API keys that look like long alphanumeric strings
    redacted = redacted.replace(/\b[A-Za-z0-9]{32,}\b/g, '{API_KEY}')

    return redacted
  })
}

export function normalizeLine(line) {
  let normalized = line
  normalized = normalized.replace(/ in \d+ms/g, ' in XXXms')
  normalized = normalized.replace(/\?v=[\w-]+/g, '?v=VERSION')
  normalized = normalized.replace(/(token|authorization)=([A-Za-z0-9._-]+)/gi, '$1={TOKEN}')
  normalized = normalized.replace(/flowId: [\w-]+/g, 'flowId: ID')
  normalized = normalized.replace(/tenantId: [\w-]+/g, 'tenantId: ID')
  normalized = normalized.replace(/flowVersionId: [\w-]+/g, 'flowVersionId: ID')
  normalized = normalized.replace(/timestamp: \d+/g, 'timestamp: TIMESTAMP')
  if (!PRESERVE_TIMESTAMPS) {
    normalized = normalized.replace(timestampRegex, 'TIMESTAMP')
  }
  normalized = normalized.replace(uuidRegex, 'UUID')
  normalized = normalized.replace(ipRegex, 'IP')
  normalized = normalized.replace(longHexRegex, 'HEX')
  normalized = normalized.replace(pidRegex, '$1=ID')
  normalized = normalized.replace(/user[:=]\s*\w+/gi, 'user=USER')
  normalized = normalized.replace(/session[:=]\s*\w+/gi, 'session=SESSION')
  normalized = normalized.replace(/[A-Za-z]+Error:/, 'ERROR:')
  normalized = normalized.replace(emailRegex, 'EMAIL')
  normalized = normalized.replace(jwtRegex, 'TOKEN')
  normalized = normalized.replace(/\b\d+\b/g, 'NUMBER')
  return normalized
}

export function isNoise(line) {
  return NOISE_PATTERNS.some((pattern) => pattern.test(line))
}

export function isHumanNote(line) {
  if (!line) return false
  const trimmed = line.trim()
  if (!trimmed) return false
  // Heuristics: free text, first-person hints, accented chars, lacks HTTP verb/status noise
  const hasAccent = /[áàâãéêíîóôõúç]/i.test(trimmed)
  const firstPerson = /\b(eu|minha|minhas|meu|meus|nossa|nosso|gente)\b/i.test(trimmed)
  const looksHttp = /^(GET|POST|PUT|DELETE|PATCH|OPTIONS|HEAD)\s/i.test(trimmed)
  const looksStatus = /\b[1-5]\d{2}\b/.test(trimmed)
  const hasSentenceLength = trimmed.split(/\s+/).length >= 5
  return (hasAccent || firstPerson || hasSentenceLength) && !looksHttp && !looksStatus
}

export function stackTraceSignature(lines) {
  const normalized = lines
    .map((line) => normalizeLine(line).replace(/\s+/g, ' ').trim())
    .filter(Boolean)
  if (!normalized.length) return 'Stacktrace'
  const first = normalized[0].replace(/[0-9]+/g, 'N').replace(/[A-Za-z_]+/g, 'X')
  return first || 'Stacktrace'
}

export function foldStackTrace(lines) {
  const result = []
  let buffer = []

  const flushBuffer = () => {
    if (buffer.length > 0) {
      const signature = stackTraceSignature(buffer)
      const headCount = Math.max(0, STACK_PREVIEW_HEAD)
      const tailCount = Math.max(0, STACK_PREVIEW_TAIL)
      const keepAll = buffer.length <= headCount + tailCount || (headCount === 0 && tailCount === 0)

      if (keepAll) {
        result.push(...buffer)
      } else {
        const head = buffer.slice(0, headCount)
        const tail = tailCount > 0 ? buffer.slice(-tailCount) : []
        const omitted = buffer.length - head.length - tail.length
        result.push(`[STACKTRACE ${signature}] (${buffer.length} frames)`)
        result.push(...head)
        if (omitted > 0) {
          result.push(`… (${omitted} frames omitted)`)
        }
        if (tail.length > 0) {
          result.push(...tail)
        }
      }
      buffer = []
    }
  }

  for (const line of lines) {
    const trimmed = line.trim()
    if (
      /^(at\s|\s+at\s|\s*@|react_stack_bottom_frame|runWithFiberInDEV)/.test(trimmed) ||
      trimmed.includes(' @ ') ||
      /react-dom_client|next@|webpack-internal|node:/.test(trimmed)
    ) {
      buffer.push(line)
      continue
    }
    flushBuffer()
    result.push(line)
  }

  flushBuffer()
  return result
}

export function applyPlaceholders(line, variables) {
  let transformed = line

  for (const rule of placeholderRules) {
    const regex = rule.regex()
    transformed = transformed.replace(regex, (...args) => {
      const match = args[0]
      const placeholder = rule.placeholder
      const replacement = rule.replace ? rule.replace(...args) : placeholder
      if (replacement === match) {
        return match
      }
      if (!variables.has(placeholder)) {
        variables.set(placeholder, new Set())
      }
      const value = rule.capture ? rule.capture(...args) : match
      if (value && typeof value === 'string') {
        variables.get(placeholder).add(value)
      }
      return replacement
    })
  }

  return transformed
}

export function buildTemplate(lines) {
  const variables = new Map()
  const templateLines = lines.map((line) => applyPlaceholders(line, variables))
  return { templateLines, variables }
}

export function structuralSignature(lines) {
  return lines
    .map((line) => normalizeLine(line).replace(/[A-Za-z0-9_]+/g, 'X').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n')
}

export function lineScore(line, debugCollector) {
  let score = 0
  const record = (delta, reason) => {
    score += delta
    if (debugCollector) {
      debugCollector.push({ reason, delta })
    }
  }

  const statusMatch = line.match(/\b([1-5]\d{2})\b/)
  if (statusMatch) {
    const statusCode = statusMatch[1]
    const series = `${statusCode[0]}xx`
    if (STATUS_WEIGHTS[statusCode] !== undefined) {
      record(STATUS_WEIGHTS[statusCode], `status:${statusCode}`)
    } else if (STATUS_WEIGHTS[series] !== undefined) {
      record(STATUS_WEIGHTS[series], `status:${series}`)
    }
  }
  // Extra penalty for 2xx without error tokens to avoid dominating summary
  if (statusMatch && statusMatch[1].startsWith('2') && !/(error|fail|exception|aborted|timeout|denied|reset)/i.test(line)) {
    record(-2, 'status:2xx-success')
  }

  const latencyMatch = line.match(/\b(\d+)ms\b/i)
  if (latencyMatch) {
    const ms = Number(latencyMatch[1])
    for (const bucket of LATENCY_BUCKETS) {
      if (ms >= bucket.minMs) {
        record(bucket.weight, bucket.label || `latency>=${bucket.minMs}`)
      }
    }
  }

  for (const { regex, weight, label } of MESSAGE_WEIGHTS) {
    if (regex.test(line)) {
      record(weight, `message:${label || regex}`)
    }
  }

  if (KEEP_HUMAN_NOTES && isHumanNote(line)) {
    record(2, 'human-note')
  }

  return score
}

export function computeEventScore(lines, debug = DEBUG_SCORE) {
  let score = 0
  const urls = new Set()
  const numbers = new Set()
  const tokens = new Set()
  const debugLines = debug ? [] : null

  for (const line of lines) {
    if (isNoise(line)) continue

    const lineDebug = debug ? [] : null
    const delta = lineScore(line, lineDebug)
    score += delta

    if (debug && debugLines) {
      debugLines.push({
        line,
        score: delta,
        reasons: lineDebug
      })
    }

    // Extract URLs for diversity scoring
    const urlMatches = line.match(/https?:\/\/[^\s]+/gi) || []
    urlMatches.forEach(url => urls.add(url.toLowerCase()))

    // Extract numbers for diversity scoring
    const numberMatches = line.match(/\b\d+\b/g) || []
    numberMatches.forEach(num => numbers.add(num))

    // Extract tokens for diversity scoring
    const tokenMatches = line.toLowerCase().match(/\b\w{3,}\b/g) || []
    tokenMatches.forEach(token => tokens.add(token))
  }

  // Add diversity bonuses
  if (urls.size > 1) score += urls.size * 2  // Multiple URLs = important
  if (numbers.size > 2) score += numbers.size  // Multiple numbers = potentially important
  if (tokens.size > 10) score += Math.floor(tokens.size / 5)  // High token diversity = rich information

  if (debug && typeof console !== 'undefined') {
    console.debug('[logslimmer][score]', {
      totalScore: score,
      linesEvaluated: debugLines?.length || 0,
      lineBreakdown: debugLines?.slice(0, 25) // avoid flooding console
    })
  }

  return score
}

export function categorizeEvent(lines) {
  const joined = lines.join('\n')
  const matches = []

  // Find all matching categories with their priorities
  for (const rule of CATEGORY_RULES) {
    if (rule.test.test(joined)) {
      matches.push({
        name: rule.name,
        priority: rule.priority || 99
      })
    }
  }

  // Sort by priority (lowest number = highest priority)
  matches.sort((a, b) => a.priority - b.priority)

  // Return the highest priority match
  if (matches.length > 0) {
    const primaryCategory = matches[0].name
    // Create a set with just the primary category for backward compatibility
    return { primaryCategory, categories: new Set([primaryCategory]) }
  }

  return { primaryCategory: 'Other', categories: new Set(['Other']) }
}

export function eventBoundary(line, hasCurrent) {
  const trimmed = line.trim()
  if (trimmed === '') return hasCurrent
  if (!hasCurrent) return false
  if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) return true
  if (/^[A-Za-z0-9_.-]+:\d+/.test(trimmed)) return true
  if (/^\[[^\]]+\]/.test(trimmed)) return true
  if (/\b(Error|Exception|Warning|WARN|INFO|DEBUG|TRACE)\b/.test(trimmed)) return true
  if (/^(GET|POST|PUT|DELETE|PATCH)\s/.test(trimmed)) return true
  return false
}

export function createEvent(lines) {
  const filtered = lines.filter((line) => !isNoise(line) && line.trim() !== '')
  if (filtered.length === 0) {
    return null
  }

  // Apply sensitive data redaction first
  const redactedLines = redactSensitiveData(filtered)

  const foldedLines = foldStackTrace(redactedLines)
  const score = computeEventScore(foldedLines)
  const { templateLines, variables } = buildTemplate(foldedLines)
  const signature = structuralSignature(foldedLines)
  const { categories, primaryCategory } = categorizeEvent(foldedLines)

  return {
    _compressedOriginalLines: Compression.compress(lines.join('\n')),
    get originalLines() {
      const decompressed = Compression.decompress(this._compressedOriginalLines)
      return decompressed ? decompressed.split('\n') : []
    },
    processedLines: foldedLines,
    templateLines,
    variables,
    signature,
    score,
    categories,
    primaryCategory
  }
}

export function splitIntoEvents(inputText) {
  const lines = inputText.split(newlineRegex)
  const events = []
  let current = []
  let order = 0

  for (const line of lines) {
    if (eventBoundary(line, current.length > 0)) {
      const event = createEvent(current)
      if (event) {
        event.order = order++
        events.push(event)
      }
      current = []
    }
    current.push(line)
  }

  const finalEvent = createEvent(current)
  if (finalEvent) {
    finalEvent.order = order++
    events.push(finalEvent)
  }

  return events
}
