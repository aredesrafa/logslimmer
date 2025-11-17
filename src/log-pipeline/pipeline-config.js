import {
  noisePatterns as defaultNoisePatterns
} from '../config.js'

const DEFAULT_PIPELINE_CONFIG = {
  latencyBuckets: [
    { minMs: 500, weight: 1, label: 'latency>=500ms' },
    { minMs: 1000, weight: 2, label: 'latency>=1000ms' },
    { minMs: 5000, weight: 3, label: 'latency>=5000ms' }
  ],
  statusWeights: {
    '2xx': -1,
    '4xx': 2,
    '5xx': 4,
    '401': 3,
    '403': 3,
    '404': 3
  },
  messageWeights: [
    { pattern: /(error|fail|exception|timed out|denied)/i, weight: 3, label: 'error-ish' },
    { pattern: /\[.*?ERROR.*?\]/i, weight: 3, label: '[ERROR] block' },
    { pattern: /(warn|deprecated)/i, weight: 1, label: 'warn/deprecated' },
    { pattern: /\b(WORKFLOW_|EditorClient)\b/i, weight: 1, label: 'workflow/editor' },
    { pattern: /(authentication|unauthorized|permission)/i, weight: 1, label: 'auth' },
    { pattern: /access granted/i, weight: -2, label: 'access granted (success)' }
  ],
  noisePatterns: defaultNoisePatterns,
  maxLineLength: 240,
  showOtherInSummary: false,
  scoreCutoffNonOther: -1,
  scoreCutoffOther: 0,
  maxOtherClusters: 5,
  maxClusters: 20,
  debugScore: false
}

function normalizeBool(value, fallback) {
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') {
    const lower = value.toLowerCase()
    if (lower === 'true') return true
    if (lower === 'false') return false
  }
  return fallback
}

function normalizeNumber(value, fallback) {
  const num = Number(value)
  if (Number.isFinite(num)) return num
  return fallback
}

function normalizeLatencyBuckets(buckets = []) {
  if (!Array.isArray(buckets)) return DEFAULT_PIPELINE_CONFIG.latencyBuckets
  const normalized = buckets
    .map((bucket) => ({
      minMs: normalizeNumber(bucket.minMs, NaN),
      weight: normalizeNumber(bucket.weight, 0),
      label: bucket.label
    }))
    .filter((bucket) => Number.isFinite(bucket.minMs) && Number.isFinite(bucket.weight) && bucket.minMs >= 0)
    .sort((a, b) => a.minMs - b.minMs)

  return normalized.length ? normalized : DEFAULT_PIPELINE_CONFIG.latencyBuckets
}

function normalizeStatusWeights(statusWeights = {}) {
  const normalized = {}
  const entries = Object.entries(statusWeights)
  for (const [code, weight] of entries) {
    const numericWeight = normalizeNumber(weight, null)
    if (numericWeight === null) continue
    normalized[code] = numericWeight
  }
  return Object.keys(normalized).length ? normalized : DEFAULT_PIPELINE_CONFIG.statusWeights
}

function normalizeMessageWeights(messageWeights = []) {
  if (!Array.isArray(messageWeights)) return DEFAULT_PIPELINE_CONFIG.messageWeights

  const normalized = messageWeights
    .map((entry) => {
      if (!entry || typeof entry !== 'object') return null
      const weight = normalizeNumber(entry.weight, null)
      if (weight === null) return null
      let regex = entry.pattern
      if (!(regex instanceof RegExp)) {
        if (!regex || typeof regex !== 'string') return null
        try {
          regex = new RegExp(regex, entry.flags || 'i')
        } catch {
          return null
        }
      }
      return { regex, weight, label: entry.label || regex.toString() }
    })
    .filter(Boolean)

  return normalized.length ? normalized : DEFAULT_PIPELINE_CONFIG.messageWeights.map((entry) => ({
    ...entry,
    regex: entry.pattern instanceof RegExp ? entry.pattern : new RegExp(entry.pattern, 'i')
  }))
}

function normalizeNoisePatterns(patterns = []) {
  const array = Array.isArray(patterns) ? patterns : []
  const normalized = array
    .map((pattern) => {
      if (pattern instanceof RegExp) return pattern
      if (typeof pattern === 'string') {
        try {
          return new RegExp(pattern, 'i')
        } catch {
          return null
        }
      }
      return null
    })
    .filter(Boolean)

  if (normalized.length) return normalized
  return DEFAULT_PIPELINE_CONFIG.noisePatterns
}

function resolveGlobalOverrides() {
  if (typeof globalThis !== 'undefined' && globalThis.LOGSLIMMER_CONFIG) {
    const value = globalThis.LOGSLIMMER_CONFIG
    if (value && typeof value === 'object') return value
  }

  if (typeof process !== 'undefined' && process?.env?.LOGSLIMMER_CONFIG_JSON) {
    try {
      return JSON.parse(process.env.LOGSLIMMER_CONFIG_JSON)
    } catch (error) {
      console.warn('[logslimmer] Failed to parse LOGSLIMMER_CONFIG_JSON:', error)
    }
  }

  return {}
}

function normalizeScoreCutoff(value, fallback) {
  const num = normalizeNumber(value, null)
  if (num === null) return fallback
  return num
}

export function getLogPipelineConfig(overrides = {}) {
  const merged = {
    ...DEFAULT_PIPELINE_CONFIG,
    ...resolveGlobalOverrides(),
    ...overrides
  }

  const normalized = {
    latencyBuckets: normalizeLatencyBuckets(merged.latencyBuckets),
    statusWeights: normalizeStatusWeights(merged.statusWeights),
    messageWeights: normalizeMessageWeights(merged.messageWeights),
    noisePatterns: normalizeNoisePatterns(merged.noisePatterns),
    maxLineLength: normalizeNumber(merged.maxLineLength, DEFAULT_PIPELINE_CONFIG.maxLineLength),
    showOtherInSummary: normalizeBool(merged.showOtherInSummary, DEFAULT_PIPELINE_CONFIG.showOtherInSummary),
    scoreCutoffNonOther: normalizeScoreCutoff(merged.scoreCutoffNonOther, DEFAULT_PIPELINE_CONFIG.scoreCutoffNonOther),
    scoreCutoffOther: normalizeScoreCutoff(merged.scoreCutoffOther, DEFAULT_PIPELINE_CONFIG.scoreCutoffOther),
    maxOtherClusters: normalizeNumber(merged.maxOtherClusters, DEFAULT_PIPELINE_CONFIG.maxOtherClusters),
    maxClusters: normalizeNumber(merged.maxClusters, DEFAULT_PIPELINE_CONFIG.maxClusters),
    debugScore: normalizeBool(
      merged.debugScore ?? (typeof process !== 'undefined' ? process.env.LOGSLIMMER_DEBUG_SCORE : undefined),
      DEFAULT_PIPELINE_CONFIG.debugScore
    )
  }

  return normalized
}

export const logPipelineConfig = getLogPipelineConfig()

export function dumpLogPipelineDefaults() {
  return { ...DEFAULT_PIPELINE_CONFIG }
}
