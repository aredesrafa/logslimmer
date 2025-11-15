import {
  newlineRegex,
  noisePatterns,
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
  normalized = normalized.replace(timestampRegex, 'TIMESTAMP')
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
  return noisePatterns.some((pattern) => pattern.test(line))
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
      result.push(`[STACKTRACE ${signature}] × ${buffer.length}`)
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

export function lineScore(line) {
  let score = 0
  if (/error|fail|exception|timed out|denied/i.test(line)) score += 3
  if (/\b5\d{2}\b/.test(line)) {
    score += 3
  } else if (/\b(401|403)\b/.test(line)) {
    score += 2
  }
  if (/\[.*?ERROR.*?\]/i.test(line)) score += 3
  if (/warn|deprecated/i.test(line)) score += 1
  if (line.includes('[WORKFLOW_') || line.includes('[EditorClient]')) score += 1
  if (/authentication|unauthorized|permission/i.test(line)) score += 1
  return score
}

export function computeEventScore(lines) {
  let score = 0
  const urls = new Set()
  const numbers = new Set()
  const tokens = new Set()

  for (const line of lines) {
    if (isNoise(line)) continue

    score += lineScore(line)

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
    originalLines: lines,
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

  for (const line of lines) {
    if (eventBoundary(line, current.length > 0)) {
      const event = createEvent(current)
      if (event) events.push(event)
      current = []
    }
    current.push(line)
  }

  const finalEvent = createEvent(current)
  if (finalEvent) events.push(finalEvent)

  return events
}
