/**
 * Centralized Clustering Configuration
 *
 * Previously scattered across:
 * - cluster-builder.js (EMBEDDING_BATCH_SIZE, BATCH_SIZE)
 * - cluster-builder-no-embeddings.js (ADAPTIVE_CONFIG, ENHANCED_FEATURES)
 * - hierarchical-clusterer.js (HIERARCHICAL_CONFIG)
 *
 * This single source of truth consolidates all clustering thresholds and parameters
 */

export const CLUSTERING_CONFIG = {
  // Batch processing sizes
  batchSizes: {
    embedding: 10,        // Batch size for embedding API calls
    eventProcessing: 50   // Batch size for event processing
  },

  // Text-based clustering (adaptive thresholds)
  textBased: {
    adaptive: {
      // Base thresholds - require perfect similarity to cluster
      baseDistanceThreshold: 0.01,  // Extremely strict - almost perfect match
      baseDistanceStrict: 0.001,    // Ultra strict - near identical
      baseJaccardThreshold: 0.99,   // Require 99% similarity for clustering

      // Dataset size thresholds
      smallDatasetThreshold: 50,
      mediumDatasetThreshold: 200,

      // Multipliers for different dataset sizes
      smallDatasetMultiplier: 1.2,    // More permissive for small datasets
      largeDatasetMultiplier: 0.4,    // Extremely strict for large datasets (reduced from 0.6)

      // Length-based adjustments
      shortLogThreshold: 20,            // Logs shorter than 20 chars
      shortLogMultiplier: 1.3,          // More permissive for short logs
      longLogMultiplier: 0.7            // More strict for long logs (reduced from 0.9)
    },

    // Sampling configuration
    clusterSampleSize: 200,             // Reduced from 500 to be more conservative
    maxSimilarityChecksPerEvent: 50     // Reduced from 100 to be more conservative
  },

  // Hierarchical clustering levels
  hierarchical: {
    level1: {
      distanceThreshold: 0.15,
      jaccardThreshold: 0.85
    },
    level2: {
      distanceThreshold: 0.25,
      jaccardThreshold: 0.7
    },
    level3: {
      distanceThreshold: 0.4,
      jaccardThreshold: 0.5
    }
  },

  // Embedding-based clustering
  embedding: {
    cosineSimilarityThreshold: 0.88,
    distanceRatio: 0.25
  },

  // Feature flags for enhanced clustering
  features: {
    hierarchicalClustering: false,      // Disabled to preserve distinctions
    structuralAnalysis: false,          // Disabled to preserve distinctions
    adaptiveThresholds: false,          // Disabled to preserve distinctions
    enhancedTokenization: false         // Disabled to preserve distinctions
  },

  // Cache configuration
  caches: {
    tokenization: {
      enabled: true,
      maxSize: 5000
    },
    patternDetection: {
      enabled: true,
      maxSize: 1000
    },
    structural: {
      enabled: true,
      maxSize: 1000
    }
  }
}

/**
 * Get a specific configuration value with nested path support
 * @param {string} path - Dot-separated path (e.g., 'textBased.adaptive.baseDistanceThreshold')
 * @returns {*} Configuration value
 */
export function getConfig(path) {
  if (!path) return CLUSTERING_CONFIG

  const keys = path.split('.')
  let value = CLUSTERING_CONFIG

  for (const key of keys) {
    if (value === null || value === undefined) return undefined
    value = value[key]
  }

  return value
}

/**
 * Get nested configuration object
 * @param {...string} path - Path segments
 * @returns {*} Configuration value
 */
export function getConfigPath(...path) {
  return getConfig(path.join('.'))
}

/**
 * Set a configuration value (for runtime adjustments)
 * @param {string} path - Dot-separated path
 * @param {*} value - Value to set
 */
export function setConfig(path, value) {
  const keys = path.split('.')
  let obj = CLUSTERING_CONFIG

  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i]
    if (!(key in obj)) {
      obj[key] = {}
    }
    obj = obj[key]
  }

  obj[keys[keys.length - 1]] = value
}

/**
 * Get all configuration (for debugging/logging)
 * @returns {Object} Full configuration object
 */
export function getAllConfig() {
  return JSON.parse(JSON.stringify(CLUSTERING_CONFIG))
}
