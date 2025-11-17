/**
 * LogSlimmer Configuration
 * Allows enabling/disabling specific features
 */

export const newlineRegex = /\r?\n/

export const noisePatterns = [
  /heartbeat/i,
  /healthcheck/i,
  /debug/i
]

export const placeholderRules = [
  {
    placeholder: '{ID}',
    regex: () => /id=[0-9a-f-]+/gi,
    capture: (match) => match.split('=')[1]
  }
]

export const timestampRegex = /\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?/
export const uuidRegex = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i
export const ipRegex = /\b(?:\d{1,3}\.){3}\d{1,3}\b/
export const longHexRegex = /\b[0-9a-f]{16,}\b/gi
export const pidRegex = /(pid|processId|process_id)=([0-9]+)/i
export const jwtRegex = /eyJ[\w-]+\.[\w-]+\.[\w-]+/g
export const emailRegex = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi

export const config = {
  /**
   * Default compression mode
   * 'semantic': Uses semantic analysis (agnostic)
   * 'regex': Uses hardcoded patterns (fast but specific)
   */
  compressionMode: 'semantic',

  /**
   * Enabled features
   */
  features: {
    // Semantic compression based on TF-IDF and density
    semanticCompression: true,

    // Automatic log type detection
    autoDetection: true,

    // Specific handler for agent-user conversation logs
    // Can be disabled to keep solution simple
    conversationLogHandler: true,

    // Shows detailed metrics (useful for debug)
    detailedMetrics: false
  },

  /**
   * Compression options
   */
  compression: {
    // Target reduction percentage
    targetReductionPercent: 75,

    // Preserves previous turn context
    preserveContext: true,

    // Includes detailed metrics in result
    includeMetrics: false,

    // Minimum information density to preserve turn
    minDensityThreshold: 0.3
  },

  /**
   * Type weights for turn selection
   * Higher weight means more likely to be kept
   */
  typeWeights: {
    'action': 1.0,      // Actions (Added, Edited, etc) - always keep
    'error': 0.95,      // Errors - almost always keep
    'decision': 0.9,    // Final decisions - keep
    'analysis': 0.5,    // Analysis - partially
    'result': 0.6,      // Results - keep some
    'thought': 0.3,     // Vague thoughts - remove most
    'unknown': 0.4      // Unknown - keep some
  },

  /**
   * Patterns for log type detection
   * Used only if conversationLogHandler is enabled
   */
  conversationPatterns: {
    'thinking': /^• I'm (?:thinking|wondering|planning|considering)/i,
    'action': /^• (?:Added|Edited|Deleted|Updated|Created|Ran)/i,
    'explored': /^• Explored/i,
    'decision': /(?:will|should|must|plan|going|implement)/i,
    'error': /(?:Error|error|failed|Failed|blocker)/i,
    'nextSteps': /^(?:Next steps|TODO)/i
  }
}

export const CATEGORY_RULES = [
  {
    name: 'Authentication',
    priority: 5,
    test: /(auth|oauth|token|login|unauthorized|forbidden|credential)/i
  },
  {
    name: 'Network',
    priority: 10,
    test: /(timeout|network|ECONN|fetch failed|DNS|socket|connection)/i
  },
  {
    name: 'Performance',
    priority: 12,
    test: /(Violation|took \d+ms|performance|slow script|long task)/i
  },
  {
    name: 'Database',
    priority: 15,
    test: /(database|postgres|mongo|sql|prisma|query failed)/i
  },
  {
    name: 'Rate Limit',
    priority: 20,
    test: /(rate limit|too many requests|429)/i
  },
  {
    name: 'Error',
    priority: 90,
    test: /(error|exception|failed|unhandled rejection)/i
  }
]

export const MAX_SIMILARITY_CANDIDATES = 500

/**
 * Returns config merged with overrides
 */
export function getConfig(overrides = {}) {
  return {
    ...config,
    features: { ...config.features, ...overrides.features },
    compression: { ...config.compression, ...overrides.compression },
    typeWeights: { ...config.typeWeights, ...overrides.typeWeights }
  }
}

/**
 * Validates if a feature is enabled
 */
export function isFeatureEnabled(feature) {
  return config.features[feature] === true
}

/**
 * Returns compression mode to be used
 */
export function getCompressionMode() {
  return config.compressionMode
}
