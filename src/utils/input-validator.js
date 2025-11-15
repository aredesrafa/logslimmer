/**
 * Input Validator - Prevent memory issues and crashes from invalid inputs
 *
 * Problem: No input validation for log sizes causing memory issues, crashes
 * Solution: Centralized validation with configurable limits
 * Impact: Prevent OutOfMemory errors, improve error messages, graceful degradation
 */

export const INPUT_LIMITS = {
  // Maximum size limits
  MAX_LOG_SIZE_MB: 100, // Maximum input log file size
  MAX_EVENTS: 50000, // Maximum number of events to process
  MAX_EVENT_LENGTH_CHARS: 1000000, // Maximum length per event - no practical limit
  MAX_CLUSTER_SIZE: 5000, // Maximum events in a single cluster
  MAX_PLACEHOLDER_VALUE_LENGTH: 1000, // Maximum length for variable values

  // Tokenization limits
  MAX_TOKENS_PER_STRING: 1000,
  MIN_TOKEN_LENGTH: 1,

  // Clustering limits
  MAX_SIMILARITY_CHECKS_PER_EVENT: 100,
  MAX_CACHE_SIZE: 5000,

  // Timeout limits
  MAX_PROCESSING_TIME_MS: 60000 // 60 seconds
}

export class InputValidator {
  constructor(limits = INPUT_LIMITS) {
    this.limits = { ...INPUT_LIMITS, ...limits }
  }

  /**
   * Validate log input
   * @param {string} logInput - Raw log input
   * @returns {Object} Validation result with isValid and errors
   */
  validateLogInput(logInput) {
    const errors = []

    if (typeof logInput !== 'string') {
      errors.push('Input must be a string')
      return { isValid: false, errors }
    }

    if (logInput.length === 0) {
      errors.push('Input cannot be empty')
      return { isValid: false, errors }
    }

    const sizeInMB = (logInput.length * 2) / (1024 * 1024) // UTF-16 estimate
    if (sizeInMB > this.limits.MAX_LOG_SIZE_MB) {
      errors.push(`Log size (${sizeInMB.toFixed(2)}MB) exceeds maximum (${this.limits.MAX_LOG_SIZE_MB}MB)`)
    }

    return {
      isValid: errors.length === 0,
      errors,
      sizeInMB: sizeInMB.toFixed(2)
    }
  }

  /**
   * Validate events array
   * @param {Array} events - Events array
   * @returns {Object} Validation result with isValid and errors
   */
  validateEvents(events) {
    const errors = []

    if (!Array.isArray(events)) {
      errors.push('Events must be an array')
      return { isValid: false, errors }
    }

    if (events.length === 0) {
      errors.push('Events array cannot be empty')
      return { isValid: false, errors }
    }

    if (events.length > this.limits.MAX_EVENTS) {
      errors.push(`Event count (${events.length}) exceeds maximum (${this.limits.MAX_EVENTS})`)
    }

    // Validate individual events
    for (let i = 0; i < events.length; i++) {
      const event = events[i]

      if (typeof event !== 'object' || event === null) {
        errors.push(`Event ${i} is not a valid object`)
        continue
      }

      // Check event structure
      const signature = event.signature || (event.templateLines && event.templateLines.join(''))
      if (!signature) {
        errors.push(`Event ${i} missing signature or templateLines`)
      }

      // Validate signature length
      if (signature && signature.length > this.limits.MAX_EVENT_LENGTH_CHARS) {
        errors.push(`Event ${i} signature exceeds maximum length (${this.limits.MAX_EVENT_LENGTH_CHARS} chars)`)
      }
    }

    return {
      isValid: errors.length === 0,
      errors,
      eventCount: events.length
    }
  }

  /**
   * Validate event clustering results
   * @param {Array} clusters - Cluster results
   * @returns {Object} Validation result with isValid and errors
   */
  validateClusters(clusters) {
    const errors = []

    if (!Array.isArray(clusters)) {
      errors.push('Clusters must be an array')
      return { isValid: false, errors }
    }

    for (let i = 0; i < clusters.length; i++) {
      const cluster = clusters[i]

      if (!Array.isArray(cluster.events)) {
        errors.push(`Cluster ${i} has invalid events array`)
        continue
      }

      if (cluster.events.length > this.limits.MAX_CLUSTER_SIZE) {
        errors.push(`Cluster ${i} size (${cluster.events.length}) exceeds maximum (${this.limits.MAX_CLUSTER_SIZE})`)
      }

      // Validate variables if present
      if (cluster.variables instanceof Map) {
        for (const [placeholder, values] of cluster.variables.entries()) {
          if (values instanceof Set) {
            for (const value of values) {
              if (String(value).length > this.limits.MAX_PLACEHOLDER_VALUE_LENGTH) {
                errors.push(`Cluster ${i} has placeholder value exceeding maximum length`)
              }
            }
          }
        }
      }
    }

    return {
      isValid: errors.length === 0,
      errors,
      clusterCount: clusters.length
    }
  }

  /**
   * Validate tokenization parameters
   * @param {string} text - Text to tokenize
   * @returns {Object} Validation result
   */
  validateForTokenization(text) {
    const errors = []

    if (typeof text !== 'string') {
      errors.push('Text must be a string')
      return { isValid: false, errors }
    }

    if (text.length === 0) {
      errors.push('Text cannot be empty')
      return { isValid: false, errors }
    }

    // Estimate token count (rough heuristic: 4 chars per token)
    const estimatedTokens = Math.ceil(text.length / 4)
    if (estimatedTokens > this.limits.MAX_TOKENS_PER_STRING) {
      errors.push(`Estimated tokens (${estimatedTokens}) exceeds maximum (${this.limits.MAX_TOKENS_PER_STRING})`)
    }

    return {
      isValid: errors.length === 0,
      errors,
      length: text.length,
      estimatedTokens
    }
  }

  /**
   * Sanitize log input (remove extremely long lines or events)
   * @param {string} logInput - Raw log input
   * @returns {string} Sanitized log input
   */
  sanitizeLogInput(logInput) {
    const lines = logInput.split('\n')
    const sanitized = lines
      .filter(line => line.length <= this.limits.MAX_EVENT_LENGTH_CHARS * 2) // Some tolerance
      .slice(0, this.limits.MAX_EVENTS * 10) // Rough limit
      .join('\n')

    return sanitized
  }
}

/**
 * Factory function to create an input validator
 * @param {Object} customLimits - Custom limits to override defaults
 * @returns {InputValidator} Validator instance
 */
export function createInputValidator(customLimits = {}) {
  return new InputValidator(customLimits)
}

/**
 * Global validator instance for convenience
 */
export const globalValidator = createInputValidator()
