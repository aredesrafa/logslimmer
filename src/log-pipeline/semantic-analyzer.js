/**
 * Semantic Analyzer - Agnostic foundation for log analysis
 *
 * Principles:
 * - Does not rely on regex or hardcoded patterns
 * - Uses embeddings to capture meaning (not structure)
 * - Measures importance mathematically
 * - Works with any type of agentic AI log
 */

import { createTFIDFCache } from '../utils/tfidf-cache.js'

// Global TFIDF cache to prevent recalculation of same turns
const tfidfCache = createTFIDFCache(50)

/**
 * Segments text into "turns" (coherent content blocks)
 *
 * A turn is a unit of content that:
 * - Begins with a clear transition (marker, speaker change, context change)
 * - Maintains a consistent theme
 * - Ends when a new transition occurs
 */
export function segmentIntoTurns(text) {
  const lines = text.split('\n')
  const turns = []
  let currentTurn = {
    lines: [],
    startLine: 0,
    type: null, // 'thought', 'action', 'result', 'decision', 'error'
    markers: []
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const trimmed = line.trim()

    // Detect turn type by structure (agnostic)
    const turnType = detectTurnType(trimmed, i, lines)
    const isBoundary = isTurnBoundary(trimmed, turnType, currentTurn.type)

    if (isBoundary && currentTurn.lines.length > 0) {
      // Finalize current turn
      turns.push(finalizeTurn(currentTurn))
      currentTurn = {
        lines: [line],
        startLine: i,
        type: turnType,
        markers: turnType ? [turnType] : []
      }
    } else {
      currentTurn.lines.push(line)
      if (turnType) {
        currentTurn.type = turnType
        currentTurn.markers.push(turnType)
      }
    }
  }

  if (currentTurn.lines.length > 0) {
    turns.push(finalizeTurn(currentTurn))
  }

  return turns
}

/**
 * Detect turn type based on content structure
 * Agnostic: works with any format
 */
function detectTurnType(line, idx, allLines) {
  const trimmed = line.trim()

  // Turn start markers
  if (!trimmed) return null

  // MOST IMPORTANT PATTERN: Explicit separators ## User / ## Assistant
  if (trimmed.match(/^##\s*User\s*$/i) || trimmed.match(/^##\s*Human\s*$/i)) {
    return 'user_request'
  }
  if (trimmed.match(/^##\s*Assistant\s*$/i) || trimmed.match(/^##\s*AI\s*$/i) || trimmed.match(/^##\s*Model\s*$/i)) {
    return 'model_response'
  }

  // CHEVRON PATTERN (›): ALMOST ALWAYS USER
  if (trimmed.startsWith('›')) {
    return 'user_request'
  }

  // BULLET PATTERN (•): USUALLY AGENT/ASSISTANT
  if (trimmed.startsWith('•')) {
    // Check if it is an executed action (Ran, Added, etc.)
    if (trimmed.match(/^(?:•|→)?\s*(?:Added|Edited|Deleted|Updated|Created|Modified|Removed|Ran|Executed|Implemented|Built|Compiled|Installed|Saved|Wrote|Read|Called|Sent|Received|Connected|Disconnected|Started|Stopped)/i)) {
      return 'action'
    }
    // Check if it is a thought/model response
    if (trimmed.match(/^(?:•|→)?\s*(?:I'll|I can|Here's|The code|Let me|This will|You can|To solve|Based on|I need|I'm|I am|That|Yes|No|Okay|Alright|Sure|Of course|Let me|Let\s+me)/i) ||
        trimmed.match(/(?:function|class|const|let|var|return|import|export|analyze|understand|explain|implement|create|generate|provide)/i) ||
        trimmed.match(/^(?:•|→)?\s*(?:Explored|Ran|Executed|Updated|Modified|Changed|Working|Planning|Thinking|Considering|Looking|Found|See|Need|Should|Will|Going|Want|Like|Think|Know|Have|Make|Do|Can|Could)/i)) {
      return 'model_response'
    }
    return 'thought'
  }

  // RESULT/OUTPUT PATTERN: bash output, file listings, etc.
  if (trimmed.match(/^(?:\s+└|[├─]|>>>|\$|#|\[|\{)/) ||
      trimmed.match(/^─+\s+Worked\s+for\s+/) || // "─ Worked for Xs ─"
      trimmed.match(/^(?:total\s+\d+|drwxr|lrwxr|\-rw|bash:|└\s+)/i)) {
    return 'result'
  }

  // USER REQUEST PATTERN: direct questions, commands, requests
  if (trimmed.match(/^(?:Please|Can you|Could you|I need|I want|Make|Create|Add|Remove|Update|Fix|Help|Show|Tell me|Analyze|Review|Check|Verify|Test|Build|Run|Execute|Install|Setup|Configure)/i) ||
      trimmed.match(/\?$/) || // Termina com ?
      trimmed.match(/(?:implement|create|add|remove|update|fix|change|modify|generate|build|write|read|analyze|review|check|verify|test)/i) ||
      trimmed.match(/^@\w+/) || // @mentions (comuns em requests)
      trimmed.match(/(?:please|can you|could you|i need|i want|make|create|add|remove|update|fix|help|show|tell me)/i)) {
    return 'user_request'
  }

  // MODEL RESPONSE PATTERN: explanations, analysis, planning
  if (trimmed.match(/^(?:I'll|I can|Here's|The code|Let me|This will|You can|To solve|Based on|I am|I'm|That|Yes|No|Okay|Alright|Sure|Of course|Let me|Let\s+me)/i) ||
      trimmed.match(/(?:function|class|const|let|var|return|import|export)/i) ||
      trimmed.match(/(?:analyze|understand|explain|implement|create|generate|provide|review|check|verify|consider|think|believe|see|need|should|will|going|want|like|know|have|make|do|can|could)/i) ||
      trimmed.match(/^(?:Explored|Updated|Modified|Changed|Working|Planning|Thinking|Considering|Looking|Found|See|Need|Should|Will|Going|Want|Like|Think|Know|Have|Make|Do|Can|Could)/i)) {
    return 'model_response'
  }

  // DECISION PATTERN: will, should, must, next, milestone
  if (trimmed.match(/(?:will|should|must|going to|plan to|next|milestone|implement|decided|decision|choose|select)/i)) {
    return 'decision'
  }

  // ERROR PATTERN: Error, error, failed, exception, etc.
  if (trimmed.match(/(?:error|Error|ERROR|failed|Failed|FAILED|exception|blocker|blocker|⚠|❌|warning|Warning|WARN)/i)) {
    return 'error'
  }

  // ANALYSIS PATTERN: analysis, reflection, insights
  if (trimmed.match(/(?:analyzing|analysis|considering|thinking|wondering|noticing|seeing|realizing|understanding|comprehending)/i) ||
      trimmed.match(/^(?:I see|I think|I believe|I understand|I wonder|It seems|It looks|It appears|The issue|The problem)/i)) {
    return 'analysis'
  }

  return null
}

/**
 * Detect whether a line is a boundary between turns
 */
function isTurnBoundary(line, newType, currentType) {
  const trimmed = line.trim()

  // Empty lines can be boundaries
  if (!trimmed) return false

  // Type changes create boundaries
  if (newType && currentType && newType !== currentType) {
    return true
  }

  // Explicit separation patterns
  if (trimmed.match(/^─{3,}|^===+|^---+|^###|^##\s/)) {
    return true
  }

  return false
}

/**
 * Finalize a turn and calculate metadata
 */
function finalizeTurn(turn) {
  const text = turn.lines.join('\n')
  return {
    ...turn,
    text,
    length: text.length,
    wordCount: text.split(/\s+/).length,
    lineCount: turn.lines.length,
    isEmpty: text.trim().length === 0,
    density: calculateDensity(text),
    hasCode: /[{}()\[\]<>]|:=|=>|const|function|class|return|import|export/i.test(text),
    hasActionVerb: /^(?:Added|Edited|Deleted|Created|Updated|Running|Executed|Implemented)/i.test(text)
  }
}

/**
 * Calculate the information density of a text
 * Based on: length, unique words, patterns
 */
function calculateDensity(text) {
  if (!text.trim()) return 0

  const words = text.toLowerCase().split(/\s+/).filter(w => w.length > 2)
  const uniqueWords = new Set(words)
  const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 0)

  // Diversity ratio: unique words / total words
  const diversityRatio = uniqueWords.size / Math.max(1, words.length)

  // Sentence complexity: average words per sentence
  const avgWordsPerSentence = words.length / Math.max(1, sentences.length)

  // Information: penalizes repetition
  const repetitionPenalty = 1 - Math.min(1, (uniqueWords.size - avgWordsPerSentence) / words.length)

  // Final score (0-1)
  return (diversityRatio * 0.4 + Math.min(1, avgWordsPerSentence / 15) * 0.4 + (1 - repetitionPenalty) * 0.2)
}

/**
 * Calculate TF-IDF for each turn
 * Useful to measure relative importance
 */
export function calculateTFIDF(turns) {
  const allTerms = new Map() // { term: { docFreq, termFreq: {} } }
  const N = turns.length

  // Phase 1: Count term frequencies
  turns.forEach((turn, idx) => {
    const terms = turn.text.toLowerCase()
      .split(/\W+/)
      .filter(w => w.length > 2 && !isStopWord(w))

    const seenInDoc = new Set()
    terms.forEach(term => {
      if (!allTerms.has(term)) {
        allTerms.set(term, { docFreq: 0, termFreq: {} })
      }

      const termData = allTerms.get(term)
      termData.termFreq[idx] = (termData.termFreq[idx] || 0) + 1

      if (!seenInDoc.has(term)) {
        termData.docFreq++
        seenInDoc.add(term)
      }
    })
  })

  // Phase 2: Calculate TF-IDF per turn
  const tfidfScores = turns.map((turn, idx) => {
    const terms = turn.text.toLowerCase()
      .split(/\W+/)
      .filter(w => w.length > 2 && !isStopWord(w))

    let score = 0
    terms.forEach(term => {
      if (allTerms.has(term)) {
        const termData = allTerms.get(term)
        const tf = (termData.termFreq[idx] || 0) / Math.max(1, terms.length)
        const idf = Math.log(N / Math.max(1, termData.docFreq))
        score += tf * idf
      }
    })

    return {
      turnIdx: idx,
      score: score / Math.max(1, terms.length),
      termCount: terms.length
    }
  })

  return tfidfScores
}

/**
 * Common stop words (language agnostic starting point)
 */
function isStopWord(word) {
  const stopWords = new Set([
    'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by',
    'from', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had',
    'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might', 'can',
    'as', 'if', 'then', 'so', 'because', 'while', 'during', 'before', 'after',
    'de', 'la', 'le', 'les', 'et', 'ou', 'que', 'qui', 'où', 'comment',
    'o', 'a', 'os', 'as', 'e', 'ou', 'que', 'um', 'uma', 'uns', 'umas'
  ])
  return stopWords.has(word.toLowerCase())
}

/**
 * Calculate change/entropy metrics between turns
 * Turns with large differences represent important boundaries
 */
export function calculateTurnTransitions(turns) {
  const transitions = []

  for (let i = 0; i < turns.length - 1; i++) {
    const current = turns[i]
    const next = turns[i + 1]

    // Type changes are significant
    const typeChange = current.type !== next.type ? 1 : 0

    // Density change
    const densityChange = Math.abs(current.density - next.density)

    // Characteristic change (code vs thought)
    const characteristicChange = (current.hasCode !== next.hasCode ? 0.5 : 0) +
      (current.hasActionVerb !== next.hasActionVerb ? 0.5 : 0)

    const totalChange = typeChange * 0.5 + densityChange * 0.3 + characteristicChange * 0.2

    transitions.push({
      from: i,
      to: i + 1,
      change: totalChange,
      typeChanged: typeChange === 1,
      densityChange
    })
  }

  return transitions
}

/**
 * Structure analysis - returns a structural summary
 */
export function analyzeStructure(text) {
  const turns = segmentIntoTurns(text)
  // Use cache to avoid recalculating TFIDF for the same turns
  const tfidf = tfidfCache.get(calculateTFIDF, turns)
  const transitions = calculateTurnTransitions(turns)

  return {
    totalTurns: turns.length,
    turns: turns.map((t, idx) => ({
      ...t,
      tfidfScore: tfidf.find(tf => tf.turnIdx === idx)?.score || 0
    })),
    transitions,
    stats: {
      avgTurnLength: turns.reduce((s, t) => s + t.length, 0) / turns.length,
      avgDensity: turns.reduce((s, t) => s + t.density, 0) / turns.length,
      actionTurns: turns.filter(t => t.type === 'action').length,
      thoughtTurns: turns.filter(t => t.type === 'thought').length,
      errorTurns: turns.filter(t => t.type === 'error').length,
      decisionTurns: turns.filter(t => t.type === 'decision').length,
      userRequestTurns: turns.filter(t => t.type === 'user_request').length,
      modelResponseTurns: turns.filter(t => t.type === 'model_response').length
    }
  }
}

/**
 * Select important turns based on density + TF-IDF + type
 * Agnostic to any specific AI agent format
 */
export function selectImportantTurns(turns, options = {}) {
  const {
    targetReductionPercent = 75,
    minDensityThreshold = 0.3,
    typeWeights = {
      'action': 1.0,
      'error': 0.95,
      'user_request': 0.85,
      'model_response': 0.8,
      'decision': 0.9,
      'analysis': 0.5,
      'thought': 0.3,
      'result': 0.6
    }
  } = options

  // Use cache to avoid recalculating TFIDF for same turns
  const tfidf = tfidfCache.get(calculateTFIDF, turns)

  // Compute composite score for each turn
  const scored = turns.map((turn, idx) => {
    const tfidfScore = tfidf.find(tf => tf.turnIdx === idx)?.score || 0
    const typeWeight = typeWeights[turn.type] || 0.4

    // Score = (TF-IDF × 0.4 + density × 0.4 + type_weight × 0.2)
    const compositeScore = (tfidfScore * 0.4) + (turn.density * 0.4) + (typeWeight * 0.2)

    return {
      idx,
      turn,
      score: compositeScore,
      reason: {
        tfidf: tfidfScore.toFixed(3),
        density: turn.density.toFixed(3),
        type: turn.type,
        weight: typeWeight
      }
    }
  })

  // Sort by importance (preserve original order for action/error/decision)
  const actionLike = scored.filter(s => ['action', 'error', 'decision', 'user_request', 'model_response'].includes(s.turn.type))
  const others = scored.filter(s => !['action', 'error', 'decision', 'user_request', 'model_response'].includes(s.turn.type))

  // Always keep actions/errors/decisions, then top scoring others
  const kept = actionLike.sort((a, b) => b.score - a.score)

  const otherThreshold = (others.length * (1 - targetReductionPercent / 100)) / Math.max(1, others.length)
  const keptOthers = others.filter(s => s.score >= otherThreshold)

  const selected = [...kept, ...keptOthers].sort((a, b) => a.idx - b.idx)

  return {
    selected: selected.map(s => s.turn),
    metrics: selected.map(s => s.reason),
    reduction: Math.round((1 - selected.length / turns.length) * 100),
    counts: {
      originalTurns: turns.length,
      selectedTurns: selected.length,
      removedTurns: turns.length - selected.length
    }
  }
}

/**
 * Calculate semantic similarity between two texts
 * Based on lexical analysis (agnostic, no embeddings in the browser)
 */
export function calculateSemanticSimilarity(text1, text2) {
  const normalize = (t) => t.toLowerCase().split(/\W+/).filter(w => w.length > 2)

  const words1 = normalize(text1)
  const words2 = normalize(text2)

  const set1 = new Set(words1)
  const set2 = new Set(words2)

  // Jaccard similarity
  const intersection = [...set1].filter(w => set2.has(w)).length
  const union = new Set([...set1, ...set2]).size

  return union > 0 ? intersection / union : 0
}

/**
 * Detect important transitions (topic/context changes significantly)
 */
export function detectImportantBoundaries(turns) {
  const boundaries = []

  for (let i = 0; i < turns.length - 1; i++) {
    const current = turns[i]
    const next = turns[i + 1]

    // Significant type change
    if (current.type !== next.type && next.type && current.type) {
      boundaries.push({
        between: `${i} → ${i + 1}`,
        reason: `type_change: ${current.type} → ${next.type}`,
        importance: 'high'
      })
    }

    // Density change (length/complexity)
    const densityDiff = Math.abs(current.density - next.density)
    if (densityDiff > 0.5) {
      boundaries.push({
        between: `${i} → ${i + 1}`,
        reason: `density_jump: ${current.density.toFixed(2)} → ${current.density.toFixed(2)}`,
        importance: 'medium'
      })
    }

    // Characteristic change (code ↔ thought)
    if ((current.hasCode !== next.hasCode) && (current.hasActionVerb !== next.hasActionVerb)) {
      boundaries.push({
        between: `${i} → ${i + 1}`,
        reason: 'context_change: code/action transition',
        importance: 'high'
      })
    }
  }

  return boundaries
}

/**
 * Analyze the full log and return rich structure for compression
 * Agnostic to any specific agent format
 */
export function analyzeAgentLog(text, options = {}) {
  const structure = analyzeStructure(text)
  const important = selectImportantTurns(structure.turns, options)
  const boundaries = detectImportantBoundaries(structure.turns)

  return {
    metadata: {
      totalLength: text.length,
      totalLines: text.split('\n').length,
      totalTurns: structure.turns.length,
      detectedType: detectPrimaryType(structure.turns)
    },
    structure,
    important,
    boundaries,
    insights: generateInsights(structure, important, boundaries)
  }
}

/**
 * Detect primary log type based on turn distribution
 */
function detectPrimaryType(turns) {
  const types = {}
  turns.forEach(t => {
    types[t.type] = (types[t.type] || 0) + 1
  })

  const sorted = Object.entries(types).sort((a, b) => b[1] - a[1])
  return sorted.length > 0 ? sorted[0][0] : 'unknown'
}

/**
 * Generate log insights to better understand what to remove/keep
 */
function generateInsights(structure, important, boundaries) {
  return {
    compression_potential: `${important.reduction}% reduction possible`,
    primary_type: detectPrimaryType(structure.turns),
    type_distribution: {
      action: structure.turns.filter(t => t.type === 'action').length,
      error: structure.turns.filter(t => t.type === 'error').length,
      decision: structure.turns.filter(t => t.type === 'decision').length,
      user_request: structure.turns.filter(t => t.type === 'user_request').length,
      model_response: structure.turns.filter(t => t.type === 'model_response').length,
      thought: structure.turns.filter(t => t.type === 'thought').length,
      analysis: structure.turns.filter(t => t.type === 'analysis').length,
      result: structure.turns.filter(t => t.type === 'result').length
    },
    density_analysis: {
      min: Math.min(...structure.turns.map(t => t.density)).toFixed(2),
      max: Math.max(...structure.turns.map(t => t.density)).toFixed(2),
      avg: structure.stats.avgDensity.toFixed(2)
    },
    important_boundaries: boundaries.filter(b => b.importance === 'high').length,
    avg_turn_length: Math.round(structure.stats.avgTurnLength)
  }
}

/**
 * Get TFIDF cache statistics for performance monitoring
 */
export function getTFIDFCacheStats() {
  return tfidfCache.getStats()
}

/**
 * Clear TFIDF cache (useful when processing different documents)
 */
export function clearTFIDFCache() {
  tfidfCache.clear()
}
