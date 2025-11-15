/**
 * Abstract Clustering Engine
 *
 * Consolidates ~70% duplicated code from:
 * - cluster-builder.js
 * - cluster-builder-no-embeddings.js
 *
 * Single source of truth for clustering workflow
 */

import {
  getEventCategory,
  createNewCluster,
  updateCategoryCounts,
  mergeEventVariables
} from './clustering-strategy.js'
import { createSafeLogger } from '../../utils/safe-logger.js'

const logger = createSafeLogger('abstract-clustering')

/**
 * Build clusters using a clustering strategy
 * @param {Object[]} events - Events to cluster
 * @param {ClusteringStrategy} strategy - Clustering strategy instance
 * @param {Object} options - Options (batchSize, etc)
 * @returns {Promise<Object[]>} Clusters sorted by size
 */
export async function buildClustersAbstract(events, strategy, options = {}) {
  const { batchSize = 50 } = options

  logger.log(`Starting clustering with ${events.length} events using ${strategy.constructor.name}`)

  // Initialize strategy
  strategy.initialize(options)

  const clusters = new Map()

  // Process events in batches to avoid blocking
  for (let i = 0; i < events.length; i += batchSize) {
    const batch = events.slice(i, i + batchSize)
    const batchNum = Math.floor(i / batchSize) + 1
    const totalBatches = Math.ceil(events.length / batchSize)

    logger.log(`Processing batch ${batchNum}/${totalBatches} (${batch.length} events)`)

    for (const event of batch) {
      // Strategy finds or creates cluster key
      const clusterKey = await strategy.findOrCreateClusterKey(clusters, event)

      // Create cluster if it doesn't exist
      if (!clusters.has(clusterKey)) {
        clusters.set(clusterKey, createNewCluster(clusterKey, event))
      }

      const cluster = clusters.get(clusterKey)

      // Add event to cluster
      cluster.events.push(event)

      // Merge variables from event
      mergeEventVariables(cluster.variables, event.variables || new Map())

      // Update category counts
      const categoryName = getEventCategory(event)
      cluster.categoryCounts.set(categoryName, (cluster.categoryCounts.get(categoryName) || 0) + 1)

      // Update primary category if needed
      const currentPrimaryCount = cluster.categoryCounts.get(cluster.primaryCategory) || 0
      const candidateCount = cluster.categoryCounts.get(categoryName) || 0
      if (candidateCount > currentPrimaryCount) {
        cluster.primaryCategory = categoryName
      }

      // Allow strategy to update cluster metadata (embeddings, etc)
      strategy.updateClusterMetadata(cluster, event)
    }

    // Yield control back to main thread periodically
    if (i + batchSize < events.length) {
      await new Promise(resolve => setTimeout(resolve, 0))
    }
  }

  // Sort by cluster size
  const result = Array.from(clusters.values()).sort((a, b) => b.events.length - a.events.length)

  logger.log(`Completed clustering: ${result.length} clusters created`)

  // Log strategy stats if available
  if (typeof strategy.getStats === 'function') {
    const stats = strategy.getStats()
    if (Object.keys(stats).length > 0) {
      logger.log('Strategy stats:', stats)
    }
  }

  // Cleanup strategy resources
  strategy.cleanup()

  return result
}

/**
 * Format clustering result for output
 * @param {Object[]} clusters - Clusters array
 * @returns {Object[]} Formatted clusters
 */
export function formatClusters(clusters) {
  return clusters.map(cluster => ({
    signature: cluster.signature,
    templateLines: cluster.templateLines,
    events: cluster.events,
    variables: cluster.variables,
    categoryCounts: cluster.categoryCounts,
    primaryCategory: cluster.primaryCategory,
    eventCount: cluster.events.length,
    embedding: cluster.embedding, // Optional, may be null for text-based
    embeddingCount: cluster.embeddingCount
  }))
}
