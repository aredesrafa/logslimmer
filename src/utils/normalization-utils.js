/**
 * Utilities for fuzzy normalization of log values.
 * Focuses on preserving magnitude and semantic meaning while stripping specific noise.
 */

/**
 * Normalizes duration strings into semantic buckets.
 * Used to prevent high-latency events from being clustered with fast ones.
 * 
 * @param {string} match - The full matched string (e.g., "in 234ms")
 * @param {string} msStr - The captured milliseconds string (e.g., "234")
 * @returns {string} Normalized string (e.g., "in (fast)" or "in (CRITICAL >20s)")
 */
export function normalizeFuzzyLatency(match, msStr) {
  const ms = parseInt(msStr, 10)
  
  if (Number.isNaN(ms)) return match

  if (ms < 1000) return ' in (fast)'
  if (ms < 5000) return ' in (~sec)'
  if (ms < 10000) return ' in (SLOW)'
  if (ms < 20000) return ' in (VERY SLOW >10s)'
  
  // For extreme latencies, preserve the seconds magnitude
  const seconds = Math.floor(ms / 1000)
  return ` in (CRITICAL >${seconds}s)`
}
