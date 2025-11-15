/**
 * Enhanced tokenization for improved log similarity analysis
 * Implements stop words removal, n-grams, and technical token weighting
 */

// Stop words that should be filtered out as they don't contribute to meaning
const STOP_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by',
  'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does',
  'did', 'will', 'would', 'could', 'should', 'may', 'might', 'must', 'can', 'shall',
  'this', 'that', 'these', 'those', 'i', 'you', 'he', 'she', 'it', 'we', 'they', 'me',
  'him', 'her', 'us', 'them', 'my', 'your', 'his', 'its', 'our', 'their', 'what', 'which',
  'who', 'when', 'where', 'why', 'how', 'all', 'any', 'both', 'each', 'few', 'more',
  'most', 'other', 'some', 'such', 'no', 'nor', 'not', 'only', 'own', 'same', 'so',
  'than', 'too', 'very', 'just', 'also', 'then', 'now', 'here', 'there', 'up', 'down',
  'left', 'right', 'back', 'front', 'side', 'top', 'bottom', 'inside', 'outside',
  'before', 'after', 'above', 'below', 'between', 'among', 'through', 'across',
  'into', 'onto', 'from', 'until', 'while', 'during', 'since', 'because', 'although',
  'unless', 'even', 'though', 'whether', 'either', 'neither', 'else', 'instead',
  'rather', 'still', 'yet', 'again', 'further', 'moreover', 'therefore', 'however',
  'otherwise', 'besides', 'anyway', 'meanwhile', 'accordingly', 'consequently',
  'finally', 'furthermore', 'hence', 'likewise', 'next', 'nonetheless', 'similarly',
  'subsequently', 'thus', 'according', 'along', 'amid', 'amidst', 'amongst',
  'around', 'as', 'aside', 'astride', 'away', 'barring', 'behind', 'beneath',
  'beside', 'beyond', 'circa', 'concerning', 'considering', 'despite', 'due',
  'during', 'except', 'excluding', 'failing', 'following', 'for', 'forth',
  'given', 'gone', 'including', 'inside', 'like', 'minus', 'near', 'nearby',
  'next', 'notwithstanding', 'off', 'onto', 'opposite', 'out', 'outside',
  'over', 'owing', 'past', 'pending', 'per', 'plus', 'pro', 'qua', 'regarding',
  'respecting', 'round', 'save', 'saving', 'short', 'subsequent', 'such',
  'thanks', 'than', 'that', 'the', 'then', 'thence', 'there', 'therefore',
  'these', 'this', 'those', 'though', 'through', 'throughout', 'thru', 'till',
  'to', 'toward', 'towards', 'under', 'underneath', 'unlike', 'until', 'unto',
  'up', 'upon', 'versus', 'via', 'vice', 'vis', 'with', 'within', 'without',
  'worth', 'yes', 'no', 'ok', 'okay', 'true', 'false', 'null', 'undefined'
])

// Technical patterns that should get higher weight
const TECHNICAL_PATTERNS = [
  // HTTP methods
  /^(get|post|put|delete|patch|head|options|connect|trace)$/i,
  // HTTP status codes
  /^\d{3}$/,
  // Error keywords
  /^(error|exception|failed|failure|timeout|abort|cancel|reject)$/i,
  // UUID pattern (simplified)
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i,
  // File extensions
  /\.(js|ts|jsx|tsx|py|java|c|cpp|h|php|rb|go|rs|html|css|json|xml|yaml|yml|md|txt|log)$/i,
  // Function/method patterns
  /^[a-zA-Z_][a-zA-Z0-9_]*\([^)]*\)$/i,
  // API endpoints
  /^(\/[a-zA-Z0-9/_-]*)+$/,
  // Database keywords
  /^(select|insert|update|delete|create|drop|alter|table|index|where|join|from|into)$/i
]

/**
 * Check if a token is technically significant
 */
function isTechnicalToken(token) {
  return TECHNICAL_PATTERNS.some(pattern => pattern.test(token))
}

/**
 * Generate n-grams from an array of tokens
 * Generates n-gram strings only when needed (lazy evaluation)
 */
function* generateNGrams(tokens, minN = 2, maxN = 3) {
  for (let n = minN; n <= maxN; n++) {
    for (let i = 0; i <= tokens.length - n; i++) {
      yield tokens.slice(i, i + n).join(' ')
    }
  }
}

/**
 * Enhanced tokenization with stop words removal and technical weighting
 */
export function tokenizeEnhanced(str) {
  // First, extract technical tokens from the original string before cleanup
  const technicalTokens = []
  const technicalTokensSet = new Set() // O(1) lookup
  const originalTokens = str.split(/[^a-zA-Z0-9._/\-\(\)]+/).filter(Boolean)

  for (const token of originalTokens) {
    if (isTechnicalToken(token)) {
      const lower = token.toLowerCase()
      technicalTokens.push(lower)
      technicalTokensSet.add(lower)
    }
  }

  // Basic tokenization (similar to original but more robust)
  const basicTokens = str
    .toLowerCase()
    .split(/[^a-z0-9._/-]+/) // Keep dots, underscores, slashes for technical tokens
    .filter(Boolean)
    .filter(token => token.length > 1) // Remove single characters
    .filter(token => !STOP_WORDS.has(token)) // Remove stop words

  // Separate technical and non-technical tokens
  const regularTokens = []

  for (const token of basicTokens) {
    if (!technicalTokensSet.has(token)) {
      regularTokens.push(token)
    }
  }

  // Generate n-grams from regular tokens (technical tokens are usually atomic)
  const ngrams = Array.from(generateNGrams(regularTokens, 2, 3))

  // Combine all tokens with technical tokens getting higher priority (duplicated)
  const allTokens = [
    ...technicalTokens, // Add technical tokens first (higher weight)
    ...technicalTokens, // Duplicate for higher weight
    ...regularTokens,
    ...ngrams
  ]

  return allTokens
}

/**
 * Calculate token weights for similarity scoring
 */
export function calculateTokenWeights(tokens) {
  const weights = new Map()

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]
    const isTechnical = isTechnicalToken(token)
    const isNGram = token.includes(' ') // n-grams contain spaces
    const isStatusCode = /^\d{3}$/.test(token) // Status codes get extra weight

    let weight = 1.0

    // Technical tokens get higher weight
    if (isTechnical) {
      weight *= 3.0
    }

    // Status codes get even higher weight
    if (isStatusCode) {
      weight *= 2.0 // Additional multiplier for status codes
    }

    // N-grams get moderate boost
    if (isNGram) {
      weight *= 1.5
    }

    // Position-based weighting (earlier tokens slightly more important)
    const positionWeight = Math.max(0.5, 1.0 - (i / tokens.length) * 0.5)
    weight *= positionWeight

    weights.set(token, (weights.get(token) || 0) + weight)
  }

  return weights
}

/**
 * Enhanced Jaccard similarity that considers token weights
 */
export function weightedJaccardSimilarity(tokensA, tokensB) {
  if (!tokensA.length || !tokensB.length) return 0

  const weightsA = calculateTokenWeights(tokensA)
  const weightsB = calculateTokenWeights(tokensB)

  // Calculate weighted intersection and union
  let intersection = 0
  let union = 0

  const allTokens = new Set([...weightsA.keys(), ...weightsB.keys()])

  for (const token of allTokens) {
    const weightA = weightsA.get(token) || 0
    const weightB = weightsB.get(token) || 0

    intersection += Math.min(weightA, weightB)
    union += Math.max(weightA, weightB)
  }

  return union === 0 ? 0 : intersection / union
}

/**
 * Get token statistics for analysis
 */
export function getTokenStats(tokens) {
  const stats = {
    total: tokens.length,
    technical: 0,
    ngrams: 0,
    unique: new Set(tokens).size,
    weights: calculateTokenWeights(tokens)
  }

  for (const token of tokens) {
    if (isTechnicalToken(token)) {
      stats.technical++
    }
    if (token.includes(' ')) {
      stats.ngrams++
    }
  }

  return stats
}

/**
 * Backward compatibility function - enhanced version of tokenizeForSimilarity
 */
export function tokenizeForSimilarityEnhanced(str) {
  return tokenizeEnhanced(str)
}
