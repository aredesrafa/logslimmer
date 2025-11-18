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

/**
 * MinHash for fast Jaccard similarity estimation
 * Reduces O(n²) pairwise comparisons to O(n log n) with LSH
 */
export class MinHash {
  constructor(numHashes = 100, seed = 0) {
    this.numHashes = numHashes
    this.hashFunctions = []

    // Generate hash functions with different seeds
    for (let i = 0; i < numHashes; i++) {
      this.hashFunctions.push({
        a: (seed + i * 2 + 1) % 4294967291, // Large prime
        b: (seed + i * 2 + 2) % 4294967291,
        p: 4294967291 // Large prime modulus
      })
    }
  }

  /**
   * Compute hash value for a token using a specific hash function
   */
  _hashToken(token, hashFunc) {
    // Simple string hash, then apply linear transformation
    let hash = 0
    for (let i = 0; i < token.length; i++) {
      hash = ((hash << 5) - hash + token.charCodeAt(i)) & 0x7fffffff
    }
    return ((hashFunc.a * hash + hashFunc.b) % hashFunc.p) >>> 0
  }

  /**
   * Compute MinHash signature for a set of tokens
   */
  computeSignature(tokens) {
    const signature = new Array(this.numHashes).fill(Infinity)

    for (const token of tokens) {
      for (let i = 0; i < this.numHashes; i++) {
        const hash = this._hashToken(token, this.hashFunctions[i])
        if (hash < signature[i]) {
          signature[i] = hash
        }
      }
    }

    return signature
  }

  /**
   * Estimate Jaccard similarity from two signatures
   */
  estimateSimilarity(sigA, sigB) {
    if (sigA.length !== sigB.length || sigA.length !== this.numHashes) {
      throw new Error('Signature length mismatch')
    }

    let matches = 0
    for (let i = 0; i < this.numHashes; i++) {
      if (sigA[i] === sigB[i]) {
        matches++
      }
    }

    return matches / this.numHashes
  }
}

/**
 * Compute MinHash signature for tokens (convenience function)
 */
export function computeMinHashSignature(tokens, numHashes = 100, seed = 0) {
  const minHash = new MinHash(numHashes, seed)
  return minHash.computeSignature(tokens)
}

/**
 * Estimate Jaccard similarity using MinHash signatures
 */
export function minHashSimilarity(sigA, sigB, numHashes = 100) {
  const minHash = new MinHash(numHashes)
  return minHash.estimateSimilarity(sigA, sigB)
}

/**
 * Locality Sensitive Hashing (LSH) index for approximate nearest neighbor search
 * Uses banding technique for MinHash signatures
 */
export class LSHIndex {
  constructor(numBands = 20, bandSize = 5, seed = 0) {
    this.numBands = numBands
    this.bandSize = bandSize
    this.bands = Array.from({ length: numBands }, () => new Map())
    this.items = new Map() // itemId -> signature
    this.hashSeed = seed
  }

  /**
   * Add an item with its MinHash signature to the index
   */
  add(itemId, signature) {
    if (signature.length !== this.numBands * this.bandSize) {
      throw new Error(`Signature length ${signature.length} doesn't match expected ${this.numBands * this.bandSize}`)
    }

    this.items.set(itemId, signature)

    // Hash each band
    for (let band = 0; band < this.numBands; band++) {
      const start = band * this.bandSize
      const bandSignature = signature.slice(start, start + this.bandSize)

      // Create a hash for this band
      const bandHash = this._hashBand(bandSignature, band)

      if (!this.bands[band].has(bandHash)) {
        this.bands[band].set(bandHash, [])
      }
      this.bands[band].get(bandHash).push(itemId)
    }
  }

  /**
   * Query for similar items to the given signature
   */
  query(signature, threshold = 0.5) {
    const candidates = new Set()

    // Find candidate buckets
    for (let band = 0; band < this.numBands; band++) {
      const start = band * this.bandSize
      const bandSignature = signature.slice(start, start + this.bandSize)
      const bandHash = this._hashBand(bandSignature, band)

      const bucket = this.bands[band].get(bandHash)
      if (bucket) {
        for (const itemId of bucket) {
          candidates.add(itemId)
        }
      }
    }

    // Filter candidates by actual similarity
    const results = []
    for (const itemId of candidates) {
      const itemSig = this.items.get(itemId)
      const similarity = this._estimateSimilarity(signature, itemSig)
      if (similarity >= threshold) {
        results.push({ itemId, similarity })
      }
    }

    return results.sort((a, b) => b.similarity - a.similarity)
  }

  /**
   * Get all items in the index
   */
  getAllItems() {
    return Array.from(this.items.keys())
  }

  /**
   * Estimate similarity between two signatures
   */
  _estimateSimilarity(sigA, sigB) {
    let matches = 0
    for (let i = 0; i < sigA.length; i++) {
      if (sigA[i] === sigB[i]) {
        matches++
      }
    }
    return matches / sigA.length
  }

  /**
   * Hash a band signature to a bucket
   */
  _hashBand(bandSignature, bandIndex) {
    let hash = this.hashSeed + bandIndex
    for (const value of bandSignature) {
      hash = ((hash << 5) - hash + value) & 0x7fffffff
    }
    return hash >>> 0
  }

  /**
   * Get statistics about the index
   */
  getStats() {
    const bucketSizes = this.bands.map(band => {
      const sizes = Array.from(band.values()).map(bucket => bucket.length)
      return {
        min: Math.min(...sizes),
        max: Math.max(...sizes),
        avg: sizes.reduce((a, b) => a + b, 0) / sizes.length,
        totalBuckets: band.size
      }
    })

    return {
      numItems: this.items.size,
      numBands: this.numBands,
      bandSize: this.bandSize,
      bucketStats: bucketSizes
    }
  }
}
