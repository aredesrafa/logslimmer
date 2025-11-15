/**
 * Structural pattern analysis for log clustering without embeddings
 * Detects common log patterns and structures to improve clustering quality
 */

// Common log patterns with regex and metadata
export const STRUCTURAL_PATTERNS = [
  {
    name: 'http_error',
    regex: /(GET|POST|PUT|DELETE|PATCH)\s+http[s]?:\/\/[^\s]+ (\d{3})/i,
    category: 'HTTP',
    description: 'HTTP request with status code',
    priority: 1
  },
  {
    name: 'stacktrace_java',
    regex: /\s+at\s+[^\s]+\([^)]+\)/,
    category: 'StackTrace',
    description: 'Java stack trace line',
    priority: 1
  },
  {
    name: 'stacktrace_python',
    regex: /\s+File\s+"[^"]+",\s+line\s+\d+,/i,
    category: 'StackTrace',
    description: 'Python stack trace line',
    priority: 1
  },
  {
    name: 'log_level_timestamp',
    regex: /\[(DEBUG|INFO|WARN|ERROR|FATAL|TRACE)\]\s+\d{4}-\d{2}-\d{2}/i,
    category: 'LogEntry',
    description: 'Standard log entry with level and timestamp',
    priority: 2
  },
  {
    name: 'uuid_reference',
    regex: /[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/i,
    category: 'UUID',
    description: 'UUID reference',
    priority: 3
  },
  {
    name: 'json_error_response',
    regex: /"error"\s*:\s*\{[^}]*"message"\s*:\s*"[^"]*"/i,
    category: 'JSON',
    description: 'JSON error response',
    priority: 2
  },
  {
    name: 'database_error',
    regex: /(SQLSTATE|ORA-|MySQL|PostgreSQL).*error/i,
    category: 'Database',
    description: 'Database error',
    priority: 1
  },
  {
    name: 'auth_error',
    regex: /(unauthorized|forbidden|authentication.*failed|invalid.*token)/i,
    category: 'Authentication',
    description: 'Authentication/authorization error',
    priority: 1
  },
  {
    name: 'network_error',
    regex: /(connection.*refused|timeout|ECONNRESET|ENOTFOUND)/i,
    category: 'Network',
    description: 'Network connectivity error',
    priority: 1
  },
  {
    name: 'file_system_error',
    regex: /(ENOENT|EACCES|EPERM|file.*not.*found)/i,
    category: 'FileSystem',
    description: 'File system error',
    priority: 1
  }
]

/**
 * Detect structural patterns in a log line
 */
export function detectStructuralPatterns(text) {
  const patterns = []

  for (const pattern of STRUCTURAL_PATTERNS) {
    if (pattern.regex.test(text)) {
      patterns.push({
        name: pattern.name,
        category: pattern.category,
        priority: pattern.priority,
        description: pattern.description
      })
    }
  }

  return patterns
}

/**
 * Extract structural signature from a log line
 * This creates a normalized version that focuses on structure rather than content
 */
export function extractStructuralSignature(text) {
  let signature = text

  // Replace variable parts with placeholders
  signature = signature.replace(/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/gi, '{UUID}')
  signature = signature.replace(/\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z?/g, '{TIMESTAMP}')
  signature = signature.replace(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g, '{IP}')
  signature = signature.replace(/https?:\/\/[^\s]+/g, '{URL}')
  signature = signature.replace(/\d+/g, '{NUMBER}')
  signature = signature.replace(/"[^"]*"/g, '{STRING}')  // JSON strings
  signature = signature.replace(/'[^']*'/g, '{STRING}')  // SQL strings

  return signature
}

/**
 * Calculate structural similarity between two log lines
 * Based on detected patterns and normalized signatures
 */
export function calculateStructuralSimilarity(textA, textB) {
  const patternsA = detectStructuralPatterns(textA)
  const patternsB = detectStructuralPatterns(textB)

  // If both have the same high-priority patterns, they're very similar
  const highPriorityA = patternsA.filter(p => p.priority === 1).map(p => p.name)
  const highPriorityB = patternsB.filter(p => p.priority === 1).map(p => p.name)

  if (highPriorityA.length > 0 && highPriorityB.length > 0) {
    const commonHighPriority = highPriorityA.filter(p => highPriorityB.includes(p))
    if (commonHighPriority.length > 0) {
      return 0.9 + (commonHighPriority.length * 0.05) // 0.95, 1.0, etc.
    }
  }

  // Check for same categories
  const categoriesA = [...new Set(patternsA.map(p => p.category))]
  const categoriesB = [...new Set(patternsB.map(p => p.category))]

  const commonCategories = categoriesA.filter(c => categoriesB.includes(c))
  if (commonCategories.length > 0) {
    return 0.7 + (commonCategories.length * 0.1) // 0.8, 0.9, etc.
  }

  // Check structural signatures
  const sigA = extractStructuralSignature(textA)
  const sigB = extractStructuralSignature(textB)

  if (sigA === sigB) {
    return 0.8
  }

  // Count common structural elements
  const elementsA = sigA.split(/[^a-zA-Z0-9{}_-]/).filter(e => e.includes('{'))
  const elementsB = sigB.split(/[^a-zA-Z0-9{}_-]/).filter(e => e.includes('{'))

  const commonElements = elementsA.filter(e => elementsB.includes(e))
  const maxElements = Math.max(elementsA.length, elementsB.length)

  if (maxElements > 0) {
    return (commonElements.length / maxElements) * 0.6
  }

  return 0
}

/**
 * Group logs by structural patterns
 * Returns groups of logs that share similar structures
 */
export function groupByStructuralPatterns(logs) {
  const groups = new Map()

  for (const log of logs) {
    const text = typeof log === 'string' ? log : (log.signature || log.templateLines?.join(' ') || '')
    const signature = extractStructuralSignature(text)

    if (!groups.has(signature)) {
      groups.set(signature, [])
    }

    groups.get(signature).push(log)
  }

  return groups
}

/**
 * Enhanced similarity function that combines textual and structural similarity
 */
export function calculateEnhancedSimilarity(textA, textB, adaptiveThresholds) {
  // First check structural similarity
  const structuralSim = calculateStructuralSimilarity(textA, textB)

  if (structuralSim >= 0.8) {
    return structuralSim // High structural similarity takes precedence
  }

  // Fall back to textual similarity with adaptive thresholds
  // This would be used in conjunction with the existing similarity functions
  return structuralSim * 0.5 // Reduce weight of structural similarity for lower matches
}

/**
 * Check if two logs should be clustered based on structural patterns
 */
export function shouldClusterByStructure(textA, textB) {
  const structuralSim = calculateStructuralSimilarity(textA, textB)

  // Very high structural similarity means they should definitely cluster
  if (structuralSim >= 0.9) {
    return true
  }

  // High structural similarity with same high-priority patterns
  if (structuralSim >= 0.8) {
    const patternsA = detectStructuralPatterns(textA)
    const patternsB = detectStructuralPatterns(textB)
    const highPriorityCommon = patternsA
      .filter(p => p.priority === 1)
      .some(p => patternsB.some(pb => pb.name === p.name && pb.priority === 1))

    return highPriorityCommon
  }

  return false
}
