/**
 * Hierarchical clustering for enhanced log grouping without embeddings
 * Implements multi-level similarity clustering for better grouping quality
 */

import {
  tokenizeForSimilarity,
  normalizedLevenshtein,
  jaccardSimilarity,
  MinHash,
  LSHIndex
} from './similarity-utils.js'
import {
  calculateStructuralSimilarity,
  shouldClusterByStructure,
  extractStructuralSignature
} from './structural-patterns.js'
import { MAX_SIMILARITY_CANDIDATES } from '../config.js'

// Hierarchical clustering configuration
const HIERARCHICAL_CONFIG = {
  // Level 1: High similarity (near identical logs)
  LEVEL1_DISTANCE_THRESHOLD: 0.15,    // Very strict
  LEVEL1_JACCARD_THRESHOLD: 0.85,

  // Level 2: Medium similarity (same type/structure)
  LEVEL2_DISTANCE_THRESHOLD: 0.25,    // Moderate
  LEVEL2_JACCARD_THRESHOLD: 0.7,

  // Level 3: Low similarity (same category/context)
  LEVEL3_DISTANCE_THRESHOLD: 0.4,     // Permissive
  LEVEL3_JACCARD_THRESHOLD: 0.5,

  // Structural similarity bonuses
  STRUCTURAL_BONUS_HIGH: 0.9,         // For high structural similarity
  STRUCTURAL_BONUS_MEDIUM: 0.7,       // For medium structural similarity
}

/**
 * Represents a cluster in the hierarchical clustering process
 * Uses copy-on-write pattern: only copies data when actually modified
 */
class HierarchicalCluster {
  constructor(initialEvent) {
    this.events = [initialEvent]
    this.signature = initialEvent.signature
    this.primaryCategory = initialEvent.primaryCategory

    // Copy-on-write: reference original data, copy only if modified
    this._templateLines = initialEvent.templateLines
    this._variables = initialEvent.variables
    this._templateLinesCopied = false
    this._variablesCopied = false

    this.similarityLevel = 1 // Level at which this cluster was formed
  }

  /**
   * Get templateLines (read-only reference unless modified)
   */
  get templateLines() {
    return this._templateLines
  }

  /**
   * Get variables (read-only reference unless modified)
   */
  get variables() {
    return this._variables
  }

  /**
   * Ensure we have a copy of templateLines before modifying
   */
  _ensureTemplateLinesCopy() {
    if (!this._templateLinesCopied && this._templateLines) {
      this._templateLines = [...this._templateLines]
      this._templateLinesCopied = true
    }
  }

  /**
   * Ensure we have a copy of variables before modifying
   */
  _ensureVariablesCopy() {
    if (!this._variablesCopied && this._variables) {
      this._variables = new Map(this._variables)
      this._variablesCopied = true
    }
  }

  /**
   * Add an event to this cluster
   */
  addEvent(event, similarityLevel) {
    this.events.push(event)

    // Update cluster metadata
    if (similarityLevel > this.similarityLevel) {
      this.similarityLevel = similarityLevel
    }

    // Merge variables - ensure we have a copy before modifying
    const eventVars = event.variables || new Map()
    if (eventVars && eventVars.entries) {
      this._ensureVariablesCopy()
      for (const [key, values] of eventVars.entries()) {
        if (!this._variables.has(key)) {
          this._variables.set(key, new Set())
        }
        for (const value of values) {
          this._variables.get(key).add(value)
        }
      }
    }
  }

  /**
   * Check if an event should be added to this cluster at the given similarity level
   */
  shouldAccept(event, similarityLevel, adaptiveThresholds) {
    // Always accept at higher similarity levels
    if (similarityLevel < this.similarityLevel) {
      return false
    }

    const similarity = this.calculateSimilarity(event, adaptiveThresholds)
    return similarity >= this.getSimilarityThreshold(similarityLevel)
  }

  /**
   * Calculate similarity between cluster representative and event
   */
  calculateSimilarity(event, adaptiveThresholds) {
    // First check structural similarity
    if (shouldClusterByStructure(this.signature, event.signature)) {
      return HIERARCHICAL_CONFIG.STRUCTURAL_BONUS_HIGH
    }

    const structuralSim = calculateStructuralSimilarity(this.signature, event.signature)
    if (structuralSim >= 0.8) {
      return HIERARCHICAL_CONFIG.STRUCTURAL_BONUS_HIGH
    } else if (structuralSim >= 0.6) {
      return HIERARCHICAL_CONFIG.STRUCTURAL_BONUS_MEDIUM
    }

    // Fall back to textual similarity with adaptive thresholds
    const distanceRatio = normalizedLevenshtein(this.signature, event.signature)
    if (distanceRatio > adaptiveThresholds.distanceThreshold) {
      return 0
    }

    const tokens1 = tokenizeForSimilarity(this.signature)
    const tokens2 = tokenizeForSimilarity(event.signature)
    const jaccard = jaccardSimilarity(tokens1, tokens2)

    // Combine distance and jaccard with weights
    const distanceScore = Math.max(0, 1 - distanceRatio)
    const combinedScore = (distanceScore * 0.6) + (jaccard * 0.4)

    return combinedScore
  }

  /**
   * Get the similarity threshold for a given level
   */
  getSimilarityThreshold(level) {
    switch (level) {
      case 1:
        return Math.min(HIERARCHICAL_CONFIG.LEVEL1_DISTANCE_THRESHOLD,
                       HIERARCHICAL_CONFIG.LEVEL1_JACCARD_THRESHOLD)
      case 2:
        return Math.min(HIERARCHICAL_CONFIG.LEVEL2_DISTANCE_THRESHOLD,
                       HIERARCHICAL_CONFIG.LEVEL2_JACCARD_THRESHOLD)
      case 3:
        return Math.min(HIERARCHICAL_CONFIG.LEVEL3_DISTANCE_THRESHOLD,
                       HIERARCHICAL_CONFIG.LEVEL3_JACCARD_THRESHOLD)
      default:
        return 0.8
    }
  }
}

/**
 * Perform hierarchical clustering on log events using LSH for efficiency
 */
export function performHierarchicalClustering(events, adaptiveThresholds) {
  console.log('[hierarchical] Starting optimized hierarchical clustering with', events.length, 'events')

  // Precompute MinHash signatures for all events
  const minHash = new MinHash(100) // 100 hash functions
  const eventSignatures = new Map()

  for (const event of events) {
    const tokens = tokenizeForSimilarity(event.signature)
    const signature = minHash.computeSignature(tokens)
    eventSignatures.set(event, signature)
  }

  // Build LSH index
  const lshIndex = new LSHIndex(20, 5) // 20 bands, 5 rows each
  for (const [event, signature] of eventSignatures) {
    lshIndex.add(event, signature)
  }

  console.log('[hierarchical] LSH index built with', lshIndex.getStats().numItems, 'items')

  const clusters = []
  const processedEvents = new Set()

  // Level 1: High similarity clustering (near identical logs)
  console.log('[hierarchical] Level 1: High similarity clustering')
  const level1Clusters = clusterAtLevelLSH(events, 1, adaptiveThresholds, processedEvents, lshIndex, eventSignatures, minHash)
  clusters.push(...level1Clusters)

  // Level 2: Medium similarity clustering (same type/structure)
  console.log('[hierarchical] Level 2: Medium similarity clustering')
  const remainingEvents = events.filter(event => !processedEvents.has(event))
  const level2Clusters = clusterAtLevelLSH(remainingEvents, 2, adaptiveThresholds, processedEvents, lshIndex, eventSignatures, minHash)
  clusters.push(...level2Clusters)

  // Level 3: Low similarity clustering (same category/context)
  console.log('[hierarchical] Level 3: Low similarity clustering')
  const finalEvents = events.filter(event => !processedEvents.has(event))
  const level3Clusters = clusterAtLevelLSH(finalEvents, 3, adaptiveThresholds, processedEvents, lshIndex, eventSignatures, minHash)
  clusters.push(...level3Clusters)

  console.log('[hierarchical] Completed hierarchical clustering:', clusters.length, 'clusters from', events.length, 'events')
  return clusters
}

/**
 * Perform clustering at a specific similarity level
 */
function clusterAtLevel(events, level, adaptiveThresholds, processedEvents) {
  const clusters = []
  const unassignedEvents = [...events]

  while (unassignedEvents.length > 0) {
    const seedEvent = unassignedEvents.shift()
    const cluster = new HierarchicalCluster(seedEvent)
    processedEvents.add(seedEvent)

    // Find events that should join this cluster at this level
    const candidates = findClusterCandidates(cluster, unassignedEvents, level, adaptiveThresholds)

    for (const candidate of candidates) {
      cluster.addEvent(candidate, level)
      processedEvents.add(candidate)

      // Remove from unassigned
      const index = unassignedEvents.indexOf(candidate)
      if (index > -1) {
        unassignedEvents.splice(index, 1)
      }
    }

    clusters.push(cluster)
  }

  return clusters
}

/**
 * Find candidate events that should join a cluster at the given level
 */
function findClusterCandidates(cluster, unassignedEvents, level, adaptiveThresholds) {
  const candidates = []

  for (const event of unassignedEvents) {
    if (cluster.shouldAccept(event, level, adaptiveThresholds)) {
      candidates.push(event)
    }
  }

  return candidates
}

/**
 * Perform clustering at a specific similarity level using LSH
 */
function clusterAtLevelLSH(events, level, adaptiveThresholds, processedEvents, lshIndex, eventSignatures, minHash) {
  const clusters = []
  const unassignedEvents = [...events]

  while (unassignedEvents.length > 0) {
    const seedEvent = unassignedEvents.shift()
    const cluster = new HierarchicalCluster(seedEvent)
    processedEvents.add(seedEvent)

    // Query LSH for candidate events similar to seed
    const seedSignature = eventSignatures.get(seedEvent)
    const threshold = cluster.getSimilarityThreshold(level)
    const candidates = lshIndex.query(seedSignature, threshold)
      .map(result => result.itemId)
      .filter(event => unassignedEvents.includes(event) && cluster.shouldAccept(event, level, adaptiveThresholds))

    for (const candidate of candidates) {
      cluster.addEvent(candidate, level)
      processedEvents.add(candidate)

      // Remove from unassigned
      const index = unassignedEvents.indexOf(candidate)
      if (index > -1) {
        unassignedEvents.splice(index, 1)
      }
    }

    clusters.push(cluster)
  }

  return clusters
}



export function convertHierarchicalToStandardClusters(hierarchicalClusters) {
  return hierarchicalClusters.map(cluster => {
    // Calculate categoryCounts from events
    const categoryCounts = new Map()
    for (const event of cluster.events) {
      const category = event.primaryCategory || 'Other'
      categoryCounts.set(category, (categoryCounts.get(category) || 0) + 1)
    }

    return {
      signature: cluster.signature,
      templateLines: cluster.templateLines,
      variables: cluster.variables,
      events: cluster.events,
      primaryCategory: cluster.primaryCategory,
      categoryCounts,
      firstEvent: cluster.events[0], // First event in the cluster
      similarityLevel: cluster.similarityLevel
    }
  })
}

/**
 * Enhanced clustering with hierarchical approach
 */
export function buildClustersHierarchical(events, adaptiveThresholds) {
  const hierarchicalClusters = performHierarchicalClustering(events, adaptiveThresholds)
  return convertHierarchicalToStandardClusters(hierarchicalClusters)
}
