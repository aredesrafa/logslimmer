/**
 * Array Sampling with Generators
 *
 * Provides efficient sampling of large collections without allocating full arrays.
 * Uses generators to avoid O(n) memory allocations for sampling operations.
 */

/**
 * Generator that yields last N items from a Map without allocating arrays
 * Useful for sampling the most recent cluster keys
 *
 * @param {Map} map - The map to sample from
 * @param {number} maxSample - Maximum number of items to yield
 * @yields {*} Map keys
 */
export function* getLastNKeys(map, maxSample) {
  if (map.size <= maxSample) {
    // If collection is smaller than sample size, just yield all
    yield* map.keys()
  } else {
    // Otherwise, skip to start position and yield remaining
    let count = 0
    const startIndex = map.size - maxSample
    for (const key of map.keys()) {
      if (count >= startIndex) {
        yield key
      }
      count++
    }
  }
}

/**
 * Generator that yields every Nth item from a collection
 * Useful for uniform sampling of large collections
 *
 * @param {Map|Iterable} collection - Collection to sample from
 * @param {number} step - Sample every Nth item (step=2 = every other item)
 * @yields {*} Sampled items
 */
export function* getStridedItems(collection, step = 2) {
  let count = 0
  const iterable = collection instanceof Map ? collection.keys() : collection
  for (const item of iterable) {
    if (count % step === 0) {
      yield item
    }
    count++
  }
}

/**
 * Generator that yields random sample of items from collection
 * Uses reservoir sampling algorithm for uniform probability
 *
 * @param {Map|Iterable} collection - Collection to sample from
 * @param {number} sampleSize - Number of items to yield
 * @yields {*} Randomly sampled items
 */
export function* getRandomSample(collection, sampleSize) {
  const reservoir = []
  let count = 0
  const iterable = collection instanceof Map ? collection.keys() : collection

  for (const item of iterable) {
    if (count < sampleSize) {
      // Fill reservoir
      reservoir.push(item)
    } else {
      // Randomly replace items in reservoir
      const randIndex = Math.floor(Math.random() * (count + 1))
      if (randIndex < sampleSize) {
        reservoir[randIndex] = item
      }
    }
    count++
  }

  yield* reservoir
}

/**
 * Convert generator result to array only when necessary
 * Useful for debugging or when an actual array is required
 *
 * @param {Generator} gen - Generator function result
 * @returns {Array} Array of yielded values
 */
export function generatorToArray(gen) {
  return Array.from(gen)
}

/**
 * Count items from a generator without consuming memory
 *
 * @param {Generator} gen - Generator function result
 * @returns {number} Count of yielded items
 */
export function countFromGenerator(gen) {
  let count = 0
  for (const _ of gen) {
    count++
  }
  return count
}

/**
 * Get first N items from a generator
 *
 * @param {Generator} gen - Generator function result
 * @param {number} n - Number of items to take
 * @returns {Array} First N items
 */
export function* takeFromGenerator(gen, n) {
  let count = 0
  for (const item of gen) {
    if (count >= n) break
    yield item
    count++
  }
}
