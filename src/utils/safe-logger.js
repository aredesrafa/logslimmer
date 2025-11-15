/**
 * SafeLogger - Centralized logging utility
 *
 * Problem: 46 instances of console.log guards (typeof console !== 'undefined') scattered throughout code
 * Solution: Single utility class managing console availability and log levels
 * Impact: Reduced code duplication, easier to enable/disable logging globally
 */

export class SafeLogger {
  constructor(prefix = '', enableDebug = false) {
    this.prefix = prefix
    this.enableDebug = enableDebug
    this.hasConsole = typeof console !== 'undefined'
  }

  /**
   * Log message at info level
   * @param {string} message - Message to log
   * @param {any} data - Optional data to include
   */
  log(message, data = null) {
    if (this.hasConsole) {
      const msg = this.prefix ? `[${this.prefix}] ${message}` : message
      if (data !== null) {
        console.log(msg, data)
      } else {
        console.log(msg)
      }
    }
  }

  /**
   * Log warning message
   * @param {string} message - Message to log
   * @param {any} data - Optional data to include
   */
  warn(message, data = null) {
    if (this.hasConsole) {
      const msg = this.prefix ? `[${this.prefix}] ⚠️ ${message}` : `⚠️ ${message}`
      if (data !== null) {
        console.warn(msg, data)
      } else {
        console.warn(msg)
      }
    }
  }

  /**
   * Log error message
   * @param {string} message - Message to log
   * @param {any} data - Optional data to include
   */
  error(message, data = null) {
    if (this.hasConsole) {
      const msg = this.prefix ? `[${this.prefix}] ❌ ${message}` : `❌ ${message}`
      if (data !== null) {
        console.error(msg, data)
      } else {
        console.error(msg)
      }
    }
  }

  /**
   * Log debug message (only if debugging is enabled)
   * @param {string} message - Message to log
   * @param {any} data - Optional data to include
   */
  debug(message, data = null) {
    if (this.hasConsole && this.enableDebug) {
      const msg = this.prefix ? `[${this.prefix}] 🐛 ${message}` : `🐛 ${message}`
      if (data !== null) {
        console.debug(msg, data)
      } else {
        console.debug(msg)
      }
    }
  }

  /**
   * Create a timer for performance measurement
   * @param {string} label - Timer label
   * @returns {Function} Function to call to end the timer and log elapsed time
   */
  time(label) {
    const startTime = typeof performance !== 'undefined' ? performance.now() : Date.now()
    const prefix = this.prefix

    return () => {
      const endTime = typeof performance !== 'undefined' ? performance.now() : Date.now()
      const elapsed = (endTime - startTime).toFixed(2)
      this.log(`${label} took ${elapsed}ms`)
    }
  }

  /**
   * Conditionally log if condition is true
   * @param {boolean} condition - Condition to check
   * @param {string} message - Message to log if condition is true
   * @param {any} data - Optional data to include
   */
  logIf(condition, message, data = null) {
    if (condition) {
      this.log(message, data)
    }
  }

  /**
   * Set debug mode
   * @param {boolean} enabled - Whether to enable debug logging
   */
  setDebug(enabled) {
    this.enableDebug = enabled
  }
}

/**
 * Factory function to create a SafeLogger instance
 * @param {string} prefix - Optional prefix for all log messages
 * @param {boolean} enableDebug - Whether to enable debug logging (default: false)
 * @returns {SafeLogger} Logger instance
 */
export function createSafeLogger(prefix = '', enableDebug = false) {
  return new SafeLogger(prefix, enableDebug)
}
