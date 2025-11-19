import { tokenizeForSimilarity, MinHash } from './log-pipeline/similarity-utils.js'
import { setupWorker } from './utils/worker-setup.js'

/**
 * Similarity Worker
 * Handles CPU-intensive tasks like tokenization and MinHash signature generation
 * in parallel to avoid blocking the main thread or the main worker.
 */

const minHash = new MinHash(100) // Keep in sync with hierarchical-clusterer.js

setupWorker({
  computeSignatures: async (data) => {
    const { events } = data
    const results = []

    for (const eventItem of events) {
      // eventItem can be just the signature text to save bandwidth
      const text = typeof eventItem === 'string' ? eventItem : eventItem.signature
      
      if (!text) {
        results.push({ signature: [], tokens: [] })
        continue
      }

      const tokens = tokenizeForSimilarity(text)
      const signature = minHash.computeSignature(tokens)

      results.push({
        // We return standard arrays for transfer
        signature,
        tokens
      })
    }

    return { results }
  }
}, {
  workerName: 'worker-similarity'
})
