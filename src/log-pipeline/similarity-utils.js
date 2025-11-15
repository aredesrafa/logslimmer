export function tokenizeForSimilarity(str) {
  return str
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
}

export function levenshteinDistance(a, b) {
  if (a === b) return 0
  const lenA = a.length
  const lenB = b.length
  if (lenA === 0) return lenB
  if (lenB === 0) return lenA

  const prev = new Array(lenB + 1)
  const curr = new Array(lenB + 1)

  for (let j = 0; j <= lenB; j += 1) {
    prev[j] = j
  }

  for (let i = 1; i <= lenA; i += 1) {
    curr[0] = i
    for (let j = 1; j <= lenB; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      curr[j] = Math.min(
        curr[j - 1] + 1,
        prev[j] + 1,
        prev[j - 1] + cost
      )
    }
    for (let j = 0; j <= lenB; j += 1) {
      prev[j] = curr[j]
    }
  }

  return prev[lenB]
}

export function normalizedLevenshtein(a, b) {
  const maxLen = Math.max(a.length, b.length)
  if (maxLen === 0) return 0
  return levenshteinDistance(a, b) / maxLen
}

export function jaccardSimilarity(tokensA, tokensB) {
  if (!tokensA.length || !tokensB.length) return 0
  const setA = new Set(tokensA)
  const setB = new Set(tokensB)
  let intersection = 0
  for (const token of setA) {
    if (setB.has(token)) {
      intersection += 1
    }
  }
  const union = setA.size + setB.size - intersection
  if (union === 0) return 0
  return intersection / union
}

export function cosineSimilarity(vecA, vecB) {
  if (!vecA || !vecB || vecA.length !== vecB.length) return -Infinity
  let dot = 0
  let normA = 0
  let normB = 0
  for (let i = 0; i < vecA.length; i += 1) {
    const a = vecA[i]
    const b = vecB[i]
    dot += a * b
    normA += a * a
    normB += b * b
  }
  if (normA === 0 || normB === 0) return -Infinity
  return dot / (Math.sqrt(normA) * Math.sqrt(normB))
}
