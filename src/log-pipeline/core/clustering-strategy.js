/**
 * Clustering Strategy Pattern - Abstract base for clustering implementations
 *
 * This eliminates ~70% code duplication between:
 * - cluster-builder.js (embedding-based)
 * - cluster-builder-no-embeddings.js (text-based)
 * - hierarchical-clusterer.js (hierarchical)
 */

/**
 * Abstract base class for clustering strategies
 * Implementations must provide the similarity matching logic
 */
export class ClusteringStrategy {
  /**
   * Find or create a cluster key for a given event
   * @param {Map} clusters - Existing clusters map
   * @param {Object} event - Event to cluster
   * @returns {Promise<string>} Cluster key (signature)
   */
  async findOrCreateClusterKey(clusters, event) {
    throw new Error('Must implement findOrCreateClusterKey()')
  }

  /**
   * Update cluster with additional data (embeddings, etc)
   * @param {Object} cluster - Cluster object
   * @param {Object} event - Event being added to cluster
   */
  updateClusterMetadata(cluster, event) {
    // Optional: override in subclasses to add strategy-specific metadata
  }

  /**
   * Initialize strategy with configuration
   * @param {Object} config - Configuration object
   */
  initialize(config = {}) {
    this.config = config
  }

  /**
   * Cleanup resources used by strategy
   */
  cleanup() {
    // Optional: override in subclasses
  }
}

/**
 * Helper function to get event key (signature)
 * @param {Object} event - Event object
 * @returns {string} Event key
 */
export function getEventKey(event) {
  if (!event) return ''
  return event.signature || (Array.isArray(event.templateLines) ? event.templateLines.join('\n') : '')
}

/**
 * Helper function to get event category
 * @param {Object} event - Event object
 * @returns {string} Primary category
 */
export function getEventCategory(event) {
  return event?.primaryCategory || 'Other'
}

/**
 * Helper function to merge variables from event into cluster
 * @param {Map} clusterVariables - Cluster variables map
 * @param {Map} eventVariables - Event variables map
 */
export function mergeEventVariables(clusterVariables, eventVariables) {
  if (!eventVariables) return

  for (const [placeholder, values] of eventVariables.entries()) {
    if (!clusterVariables.has(placeholder)) {
      clusterVariables.set(placeholder, new Set())
    }
    const targetSet = clusterVariables.get(placeholder)
    for (const value of values) {
      targetSet.add(value)
    }
  }
}

/**
 * Helper function to update category counts
 * @param {Map} categoryCounts - Category counts map
 * @param {string} category - Category name
 * @param {string} primaryCategory - Primary category (for comparison)
 * @returns {string} New primary category if changed
 */
export function updateCategoryCounts(categoryCounts, category, currentPrimary) {
  const catName = category || 'Other'
  categoryCounts.set(catName, (categoryCounts.get(catName) || 0) + 1)

  const currentCount = categoryCounts.get(currentPrimary) || 0
  const newCount = categoryCounts.get(catName) || 0

  return newCount > currentCount ? catName : currentPrimary
}

/**
 * Helper function to create a new cluster
 * @param {string} key - Cluster key
 * @param {Object} event - Initial event
 * @returns {Object} New cluster object
 */
export function createNewCluster(key, event) {
  return {
    signature: key,
    templateLines: event.templateLines || [],
    events: [],
    variables: new Map(),
    categoryCounts: new Map(),
    firstEvent: event,
    primaryCategory: getEventCategory(event)
  }
}
