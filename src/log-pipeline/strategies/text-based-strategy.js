/**
 * Text-Based Clustering Strategy
 *
 * Consolidates clustering logic from cluster-builder-no-embeddings.js
 * Uses adaptive thresholds and tokenization for similarity matching
 */

import {
  ClusteringStrategy,
  getEventKey,
  getEventCategory
} from '../core/clustering-strategy.js'
import {
  tokenizeForSimilarity,
  normalizedLevenshtein,
  jaccardSimilarity
} from '../similarity-utils.js'
import {
  tokenizeEnhanced,
  weightedJaccardSimilarity
} from '../enhanced-tokenizer.js'
import { shouldClusterByStructure } from '../structural-patterns.js'
import { createTokenizationCache } from '../../utils/tokenization-cache.js'
import { createPatternDetectionCache } from '../../utils/pattern-detection-cache.js'
import { createSafeLogger } from '../../utils/safe-logger.js'
import { getLastNKeys } from '../../utils/array-sampling.js'

const logger = createSafeLogger('text-based-strategy')

export class TextBasedStrategy extends ClusteringStrategy {
  constructor(adaptiveThresholds) {
    super()
    this.adaptiveThresholds = adaptiveThresholds
    this.tokenizationCache = null
    this.patternCache = null
  }

  initialize(config = {}) {
    super.initialize(config)

    // Create caches
    const useEnhancedTokenization = config.enhancedTokenization !== false
    const tokenizeFunc = useEnhancedTokenization ? tokenizeEnhanced : tokenizeForSimilarity
    const jaccardFunc = useEnhancedTokenization ? weightedJaccardSimilarity : jaccardSimilarity

    this.tokenizationCache = createTokenizationCache(tokenizeFunc, 5000)
    this.patternCache = createPatternDetectionCache(shouldClusterByStructure, 1000)
    this.tokenizeFunc = tokenizeFunc
    this.jaccardFunc = jaccardFunc
    this.useEnhancedTokenization = useEnhancedTokenization
  }

  findSimilarClusterKey(existingClusters, candidateKey, primaryCategory) {
    if (!candidateKey || existingClusters.size === 0) return null

    const candidateTokens = this.tokenizationCache
      ? this.tokenizationCache.getTokens(candidateKey)
      : this.tokenizeFunc(candidateKey)

    let bestKey = null
    let bestScore = Infinity
    let bestJaccard = 0
    let checked = 0

    // Use generator to sample clusters without allocating full array
    const clusterSampleSize = 500
    const clustersToCheck = getLastNKeys(existingClusters, clusterSampleSize)

    for (const key of clustersToCheck) {
      checked++
      if (checked > 100) break // Max comparisons per event

      const cluster = existingClusters.get(key)
      if (primaryCategory && cluster?.primaryCategory !== primaryCategory) {
        continue
      }

      // Check structural similarity first
      const shouldCluster = this.patternCache
        ? this.patternCache.shouldCluster(candidateKey, key)
        : shouldClusterByStructure(candidateKey, key)

      if (shouldCluster) {
        return key // Immediate match
      }

      const distanceRatio = normalizedLevenshtein(key, candidateKey)
      if (distanceRatio > this.adaptiveThresholds.distanceThreshold) continue

      const keyTokens = this.tokenizationCache
        ? this.tokenizationCache.getTokens(key)
        : this.tokenizeFunc(key)

      const jaccard = this.jaccardFunc(candidateTokens, keyTokens)

      if (distanceRatio <= this.adaptiveThresholds.distanceStrict ||
          jaccard >= this.adaptiveThresholds.jaccardThreshold) {
        if (
          bestKey === null ||
          distanceRatio < bestScore ||
          (distanceRatio === bestScore && jaccard > bestJaccard)
        ) {
          bestKey = key
          bestScore = distanceRatio
          bestJaccard = jaccard
        }
      }
    }

    return bestKey
  }

  async findOrCreateClusterKey(clusters, event) {
    const primaryKey = getEventKey(event)
    let clusterKey = primaryKey

    if (!clusters.has(clusterKey)) {
      const similarKey = this.findSimilarClusterKey(
        clusters,
        clusterKey,
        getEventCategory(event)
      )
      if (similarKey) {
        clusterKey = similarKey
      }
    }

    return clusterKey
  }

  getStats() {
    const stats = {}

    if (this.tokenizationCache) {
      stats.tokenization = this.tokenizationCache.getStats()
    }

    if (this.patternCache) {
      stats.patternDetection = this.patternCache.getStats()
    }

    return stats
  }

  cleanup() {
    if (this.tokenizationCache) {
      this.tokenizationCache.clear()
    }

    if (this.patternCache) {
      this.patternCache.clear()
    }
  }
}
