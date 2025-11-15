/**
 * TFIDF Calculation Cache
 *
 * Prevents redundant TFIDF calculations for the same turn sequences
 * Uses a content-based hash to identify identical turn sets
 */

/**
 * Simple hash for a turn sequence to detect duplicates
 * Creates a hash of turn content
 */
function hashTurns(turns) {
  // Use turn texts as the identifier - create a simple hash
  let hash = 0
  for (const turn of turns) {
    const text = turn.text || ''
    for (let i = 0; i < Math.min(50, text.length); i++) {
      hash = ((hash << 5) - hash) + text.charCodeAt(i)
      hash = hash & hash // Convert to 32bit integer
    }
  }
  return `tfidf_${hash.toString(36)}_${turns.length}`
}

/**
 * Create a TFIDF cache with configurable size limit
 */
export function createTFIDFCache(maxSize = 50) {
  const cache = new Map()
  const accessOrder = []
  let hits = 0
  let misses = 0

  return {
    /**
     * Get TFIDF scores for turns, using cache if available
     * @param {Function} calculateFn - Function to calculate TFIDF (calculateTFIDF)
     * @param {Array} turns - The turns to calculate TFIDF for
     * @returns {Array} TFIDF scores
     */
    get(calculateFn, turns) {
      if (!turns || turns.length === 0) {
        return []
      }

      const key = hashTurns(turns)

      // Return from cache if exists
      if (cache.has(key)) {
        // Move to end (most recently used)
        const index = accessOrder.indexOf(key)
        if (index > -1) {
          accessOrder.splice(index, 1)
        }
        accessOrder.push(key)
        hits++
        return cache.get(key)
      }

      // Calculate and cache
      misses++
      const result = calculateFn(turns)
      cache.set(key, result)
      accessOrder.push(key)

      // Evict oldest if over limit
      if (cache.size > maxSize) {
        const oldestKey = accessOrder.shift()
        cache.delete(oldestKey)
      }

      return result
    },

    /**
     * Get cache statistics
     */
    getStats() {
      return {
        size: cache.size,
        maxSize,
        hits,
        misses,
        hitRate: hits + misses > 0 ? (hits / (hits + misses) * 100).toFixed(1) + '%' : 'N/A'
      }
    },

    /**
     * Clear the cache
     */
    clear() {
      cache.clear()
      accessOrder.length = 0
      hits = 0
      misses = 0
    }
  }
}
