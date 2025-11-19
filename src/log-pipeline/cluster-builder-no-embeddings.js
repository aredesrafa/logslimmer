import { buildClustersAbstract } from './core/abstract-clustering.js'
import { TextBasedStrategy } from './strategies/text-based-strategy.js'
import { buildClustersHierarchical } from './hierarchical-clusterer.js'
import { createSafeLogger } from '../utils/safe-logger.js'
import { createInputValidator } from '../utils/input-validator.js'
import { getConfig } from './config-clustering.js'

const logger = createSafeLogger('cluster-builder-no-embeddings')

/**
 * Enhanced clustering for logs without embeddings
 * Implements adaptive thresholds and structural pattern analysis
 *
 * Now uses the TextBasedStrategy for consolidation with embedding-based clustering
 */

// Load config from centralized configuration
const CLUSTERING_CONFIG = getConfig('textBased')
const ENHANCED_FEATURES = getConfig('features')

/**
 * Calculate adaptive thresholds based on dataset characteristics
 */
export function calculateAdaptiveThresholds(events) {
  const config = CLUSTERING_CONFIG.adaptive
  const totalEvents = events.length
  const avgLength = events.reduce((sum, event) =>
    sum + (event.signature || event.templateLines.join('')).length, 0
  ) / totalEvents

  // Base multipliers
  let distanceMultiplier = 1.0
  let jaccardMultiplier = 1.0

  // Adjust based on dataset size
  if (totalEvents <= config.smallDatasetThreshold) {
    distanceMultiplier *= config.smallDatasetMultiplier
    jaccardMultiplier *= config.smallDatasetMultiplier
  } else if (totalEvents >= config.mediumDatasetThreshold) {
    distanceMultiplier *= config.largeDatasetMultiplier
    jaccardMultiplier *= config.largeDatasetMultiplier
  }

  // Adjust based on average log length
  if (avgLength <= config.shortLogThreshold) {
    distanceMultiplier *= config.shortLogMultiplier
    jaccardMultiplier *= config.shortLogMultiplier
  } else {
    distanceMultiplier *= config.longLogMultiplier
    jaccardMultiplier *= config.longLogMultiplier
  }

  return {
    distanceThreshold: config.baseDistanceThreshold * distanceMultiplier,
    distanceStrict: config.baseDistanceStrict * distanceMultiplier,
    jaccardThreshold: config.baseJaccardThreshold * jaccardMultiplier,
    avgLength,
    totalEvents
  }
}

/**
 * Build clusters using the text-based strategy
 */
export async function buildClustersNoEmbeddings(events, workerPool = null) {
  const validator = createInputValidator()

  // Validate input events
  const validation = validator.validateEvents(events)
  if (!validation.isValid) {
    logger.error('Input validation failed:', validation.errors)
    throw new Error(`Invalid input: ${validation.errors.join(', ')}`)
  }

  logger.log(`Starting enhanced clustering for ${events.length} events`)

  // Calculate adaptive thresholds based on data characteristics
  const adaptiveThresholds = calculateAdaptiveThresholds(events)

  logger.log('Adaptive thresholds:', {
    distanceThreshold: adaptiveThresholds.distanceThreshold.toFixed(3),
    distanceStrict: adaptiveThresholds.distanceStrict.toFixed(3),
    jaccardThreshold: adaptiveThresholds.jaccardThreshold.toFixed(3),
    avgLength: Math.round(adaptiveThresholds.avgLength),
    totalEvents: adaptiveThresholds.totalEvents
  })

  // Use hierarchical clustering if enabled (now optimized with LSH for larger datasets)
  if (ENHANCED_FEATURES.hierarchicalClustering) {
    logger.log('Using optimized hierarchical clustering with LSH')
    return buildClustersHierarchical(events, adaptiveThresholds, workerPool)
  }

  logger.log('Using enhanced adaptive clustering (text-based strategy)')

  // Create strategy with adaptive thresholds
  const strategy = new TextBasedStrategy(adaptiveThresholds)
  strategy.initialize({
    enhancedTokenization: ENHANCED_FEATURES.enhancedTokenization
  })

  // Use abstract clustering engine
  const clusters = await buildClustersAbstract(events, strategy, {
    batchSize: 50
  })

  logger.log(`Completed clustering: ${clusters.length} clusters`)

  // Log strategy stats
  const stats = strategy.getStats()
  if (stats.tokenization) {
    logger.log('Tokenization cache stats:', stats.tokenization)
  }
  if (stats.patternDetection) {
    logger.log('Pattern detection cache stats:', stats.patternDetection)
  }

  return clusters
}
