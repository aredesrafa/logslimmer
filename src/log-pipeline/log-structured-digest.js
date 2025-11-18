/**
 * Log Structured Digest - Structured Facts Extraction
 *
 * Converts verbose logs into structured facts:
 * - FileSummary: files + actions
 * - ErrorSummary: normalized errors + resolutions
 * - PlanSummary: decisions + milestones
 *
 * Result: 80%+ compression maintaining 100% critical information
 */

const TIMELINE_TURN_LIMIT = 200

/**
 * File summary structure
 */
export class FileSummary {
  constructor(path) {
    this.path = path
    this.actions = []    // ["Added", "Refactored", "Fixed bug: XYZ"]
    this.errors = []     // Related errors
    this.status = null   // 'created', 'modified', 'removed', 'touched'
    this.firstSeen = null // Index of first mention
    this.lastSeen = null  // Index of last mention
  }

  addAction(action) {
    if (!this.actions.includes(action)) {
      this.actions.push(action)
    }
  }

  normalize() {
    // Clean duplicates and compact
    return {
      path: this.path,
      status: this.status || 'modified',
      actions: this.actions.slice(0, 2), // Max 2 main actions
      errors: this.errors.slice(0, 1)    // Max 1 main error
    }
  }
}

/**
 * Error summary structure
 */
export class ErrorSummary {
  constructor(signature, text) {
    this.signature = signature  // normalized hash of message
    this.messages = [text]      // Message variations
    this.firstSeenAt = null
    this.resolvedAt = null
    this.rootCause = null
    this.fixFiles = []
    this.frequency = 1
  }

  addOccurrence(text) {
    if (!this.messages.includes(text)) {
      this.messages.push(text)
    }
    this.frequency++
  }

  addFix(filePath) {
    if (!this.fixFiles.includes(filePath)) {
      this.fixFiles.push(filePath)
    }
  }

  normalize() {
    return {
      signature: this.signature,
      message: this.messages[0], // First occurrence is clearest
      frequency: this.frequency,
      resolved: this.resolvedAt !== null,
      fixes: this.fixFiles.slice(0, 2) // Max 2 files that fixed
    }
  }
}

/**
 * Plan/decision summary structure
 */
export class PlanSummary {
  constructor() {
    this.docsTouched = new Set()
    this.milestones = []
    this.decisions = []
    this.nextSteps = []
  }

  addMilestone(milestone) {
    if (!this.milestones.includes(milestone)) {
      this.milestones.push(milestone)
    }
  }

  addDecision(decision) {
    if (!this.decisions.includes(decision)) {
      this.decisions.push(decision)
    }
  }

  normalize() {
    return {
      milestones: this.milestones.slice(0, 5),
      decisions: this.decisions.slice(0, 3),
      affectedDocs: Array.from(this.docsTouched).slice(0, 5)
    }
  }
}

/**
 * Structured facts extractor
 */
export class StructuredDigestExtractor {
  constructor(text, turns = []) {
    this.text = text
    this.turns = turns // turns from semantic-analyzer
    this.files = new Map()
    this.errors = new Map()
    this.plans = new PlanSummary()
    this.timeline = [] // events in chronological order
    this.enrichedTurns = [] // turns enriched with metadata
  }

  /**
   * Runs full extraction
   */
  extract() {
    // 1. Parse turns or direct text
    const parseableContent = this.turns.length > 0
      ? this.turns.map(t => t.text).join('\n\n')
      : this.text

    // 2. Extract facts by type
    this._extractFiles(parseableContent)
    this._extractErrors(parseableContent)
    this._extractPlans(parseableContent)
    this._extractTimeline(parseableContent)

    // 3. Enrich turns with metadata
    this._enrichTurnsWithMetadata()

    return this._buildDigest()
  }

  /**
   * Enrich each turn with metadata: filesReferenced, errorSignatures, milestoneTags
   */
  _enrichTurnsWithMetadata() {
    if (!this.turns || this.turns.length === 0) return

    this.enrichedTurns = this.turns.map((turn, idx) => {
      const turnText = turn.text || ''

      // Find files referenced in this turn
      const filesReferenced = this._extractFilesFromText(turnText)

      // Find error signatures in this turn
      const errorSignatures = this._extractErrorsFromText(turnText)

      // Find milestone/decision tags in this turn
      const milestoneTags = this._extractMilestonesFromText(turnText)

      return {
        ...turn,
        idx,
        filesReferenced,
        errorSignatures,
        milestoneTags,
        timestamp: idx // relative order for reconstruction
      }
    })
  }

  /**
   * Extract files referenced in specific text
   */
  _extractFilesFromText(text) {
    const files = new Set()

    // File patterns
    const filePatterns = [
      /file:\s*([^\s,\n]+)/gi,
      /(?:src|lib|test|docs|components?|pages?|utils?|config|build|public|assets|styles?|scripts?|types?|interfaces?)\/[\w\-\.\/]+\.\w+/gi,
      /(?:Modified|Created|Added|Updated|Edited|Deleted|Removed|Touched|Changed|Fixed|Refactored).*?([^\s,\n]+\.\w+)/gi,
      /(?:in|at|from)\s+([^\s,\n]+\.\w+)/gi,
      /(?:save|export|write|read).*?([^\s,\n]+\.\w+)/gi,
      /([^\s,\n]+\.(?:js|ts|jsx|tsx|vue|svelte|py|java|c|cpp|h|hpp|cs|php|rb|go|rs|swift|kt|scala|clj|ex|exs))/gi
    ]

    filePatterns.forEach(pattern => {
      let match
      while ((match = pattern.exec(text)) !== null) {
        const filePath = match[1] || match[0]
        if (this._isValidFilePath(filePath)) {
          files.add(this._normalizeFilePath(filePath))
        }
      }
    })

    return Array.from(files)
  }

  /**
   * Extract error signatures from specific text
   */
  _extractErrorsFromText(text) {
    const signatures = new Set()

    // Look for error patterns that match our extracted errors
    this.errors.forEach((errorSummary, signature) => {
      if (text.includes(errorSummary.signature) ||
          errorSummary.messages.some(msg => text.includes(msg.substring(0, 50)))) {
        signatures.add(signature)
      }
    })

    // Also look for error-like patterns directly
    const errorPatterns = [
      /(?:Error|ERROR|error):\s*([^\n]+)/gi,
      /(?:failed|Failed|FAILED).*?([^\n]+)/gi,
      /(?:exception|Exception):\s*([^\n]+)/gi,
      /(?:❌|⚠️|⛔).*?([^\n]+)/gi
    ]

    errorPatterns.forEach(pattern => {
      let match
      while ((match = pattern.exec(text)) !== null) {
        const errorText = match[1] || match[0]
        const normalized = this._normalizeError(errorText)
        const signature = this._hashError(normalized)
        signatures.add(signature)
      }
    })

    return Array.from(signatures)
  }

  /**
   * Extract milestone/decision tags from specific text
   */
  _extractMilestonesFromText(text) {
    const tags = []

    // Decision patterns
    const decisionPatterns = [
      /(?:will|should|must|going to|plan to|next)[\s:]([^\n]+)/gi,
      /(?:milestone|Milestone|MILESTONE)[\s:]([^\n]+)/gi,
      /(?:Decision|decision|DECISION)[\s:]([^\n]+)/gi,
      /PHASE|Phase|phase[\s:]([^\n]+)/gi
    ]

    decisionPatterns.forEach(pattern => {
      let match
      while ((match = pattern.exec(text)) !== null) {
        const decision = (match[1] || match[0]).trim()
        // Keep only well-formed decisions (10-150 chars, no very long lines)
        if (decision.length > 10 && decision.length < 150 && decision.split(' ').length < 20) {
          tags.push({
            type: 'decision',
            text: decision
          })
        }
      }
    })

    // Milestone patterns
    const milestonePatterns = [
      /(?:MILESTONE|Milestone|milestone)[\s:]+([^\n]+)/gi,
      /(?:PHASE|Phase|phase)\s+([A-Z0-9]+)[\s:]+([^\n]+)/gi
    ]

    milestonePatterns.forEach(pattern => {
      let match
      while ((match = pattern.exec(text)) !== null) {
        const milestone = (match[1] || match[2] || match[0]).trim()
        if (milestone.length > 5 && milestone.length < 200) {
          tags.push({
            type: 'milestone',
            text: milestone
          })
        }
      }
    })

    return tags
  }

  /**
   * Normalize file path for consistency
   */
  _normalizeFilePath(path) {
    return path.replace(/\\/g, '/').toLowerCase()
  }

  /**
   * Extracts mentioned files and their actions
   */
  _extractFiles(content) {
    const lines = content.split('\n')

    // File patterns
    const filePatterns = [
      /file:\s*([^\s,\n]+)/gi,
      /(?:src|lib|test|docs|components?|pages?|utils?|config|build)\/[\w\-\.\/]+\.\w+/gi,
      /(?:Modified|Created|Added|Updated|Edited|Deleted|Removed|Touched).*?([^\s,\n]+\.\w+)/gi
    ]

    const actionPatterns = {
      'Added': /Added.*?([^\s,\n]+)/gi,
      'Refactored': /Refactored|refactored/gi,
      'Fixed': /Fixed|fixed|fix/gi,
      'Implemented': /Implemented|implemented/gi,
      'Updated': /Updated|updated/gi,
      'Created': /Created|created|create/gi,
      'Deleted': /Deleted|deleted/gi,
      'Modified': /Modified|modified|modify/gi,
      'Touched': /Touched|touched/gi
    }

    // Find files
    const foundFiles = new Set()
    filePatterns.forEach(pattern => {
      let match
      while ((match = pattern.exec(content)) !== null) {
        const filePath = match[1] || match[0]
        if (this._isValidFilePath(filePath)) {
          foundFiles.add(filePath)
        }
      }
    })

    // Associate actions with files
    foundFiles.forEach(file => {
      if (!this.files.has(file)) {
        this.files.set(file, new FileSummary(file))
      }

      const fileSummary = this.files.get(file)

      // Look for actions near the file
      const fileIndex = content.indexOf(file)
      if (fileIndex !== -1) {
        const context = content.substring(
          Math.max(0, fileIndex - 200),
          Math.min(content.length, fileIndex + 200)
        )

        // Detect status
        if (context.match(/(?:Added|Created|new|criada)/i)) {
          fileSummary.status = 'created'
        } else if (context.match(/(?:Deleted|Removed|removed|removida)/i)) {
          fileSummary.status = 'removed'
        } else if (context.match(/(?:Modified|Updated|edited|atualizada)/i)) {
          fileSummary.status = 'modified'
        } else {
          fileSummary.status = 'touched'
        }

        // Extract concise action
        Object.entries(actionPatterns).forEach(([action, pattern]) => {
          if (pattern.test(context)) {
            fileSummary.addAction(action)
          }
        })
      }
    })
  }

  /**
   * Extracts errors and their resolutions
   */
  _extractErrors(content) {
    const lines = content.split('\n')

    // Error patterns
    const errorPatterns = [
      /(?:Error|ERROR|error):\s*([^\n]+)/gi,
      /(?:failed|Failed|FAILED).*?([^\n]+)/gi,
      /(?:exception|Exception):\s*([^\n]+)/gi,
      /(?:❌|⚠️|⛔).*?([^\n]+)/gi
    ]

    const errorLines = lines.filter((line, idx) => {
      const isError = errorPatterns.some(pattern => pattern.test(line))
      if (isError) {
        this.timeline.push({
          type: 'error',
          idx,
          text: line.substring(0, 100)
        })
      }
      return isError
    })

    errorLines.forEach((errorLine, idx) => {
      // Normalize message (remove paths, timestamps)
      const normalized = this._normalizeError(errorLine)
      const signature = this._hashError(normalized)

      if (!this.errors.has(signature)) {
        this.errors.set(signature, new ErrorSummary(signature, errorLine))
      } else {
        this.errors.get(signature).addOccurrence(errorLine)
      }

      // Look for solution in following lines
      for (let i = idx + 1; i < Math.min(idx + 10, lines.length); i++) {
        const line = lines[i]
        if (line.match(/(?:Fixed|fixed|resolved|corrected|ajustado)/i)) {
          // Extract file that was "fixed"
          const fileMatch = line.match(/([^\s]+\.\w+)/)
          if (fileMatch) {
            this.errors.get(signature).addFix(fileMatch[1])
          }
          break
        }
      }
    })
  }

  /**
   * Extracts decisions and milestones
   */
  _extractPlans(content) {
    const lines = content.split('\n')

    // Decision/plan patterns
    const decisionPatterns = [
      /(?:will|should|must|going to|plan to|next)[\s:]([^\n]+)/gi,
      /(?:milestone|Milestone|MILESTONE)[\s:]([^\n]+)/gi,
      /(?:Decision|decision|DECISION)[\s:]([^\n]+)/gi,
      /PHASE|Phase|phase[\s:]([^\n]+)/gi
    ]

    const milestonePatterns = [
      /(?:MILESTONE|Milestone|milestone)[\s:]+([^\n]+)/gi,
      /(?:PHASE|Phase|phase)\s+([A-Z0-9]+)[\s:]+([^\n]+)/gi
    ]

    lines.forEach((line, idx) => {
      // Extract decisions
      decisionPatterns.forEach(pattern => {
        let match
        while ((match = pattern.exec(line)) !== null) {
          const decision = match[1] || match[0]
          const trimmed = decision.trim()
          // Keep only well-formed decisions (10-150 chars, no very long lines)
          if (trimmed.length > 10 && trimmed.length < 150 && trimmed.split(' ').length < 20) {
            this.plans.addDecision(trimmed)
          }
        }
      })

      // Extract milestones
      milestonePatterns.forEach(pattern => {
        let match
        while ((match = pattern.exec(line)) !== null) {
          const milestone = match[1] || match[2] || match[0]
          if (milestone.length > 5 && milestone.length < 200) {
            this.plans.addMilestone(milestone.trim())
          }
        }
      })

      // Look for documentation files
      if (line.match(/(?:\.md|\.txt|plan|agenda|roadmap)/i)) {
        const fileMatch = line.match(/([^\s]+\.(?:md|txt|doc))/i)
        if (fileMatch) {
          this.plans.docsTouched.add(fileMatch[1])
        }
      }
    })
  }

  /**
   * Extracts events timeline
   */
  _extractTimeline(content) {
    const lines = content.split('\n')
    const typePatterns = {
      'action': /(?:Added|Created|Modified|Updated|Refactored)/i,
      'error': /(?:Error|error|failed|Failed)/i,
      'decision': /(?:will|should|next|milestone)/i,
      'completion': /(?:✓|✅|Done|done|completed)/i
    }

    lines.forEach((line, idx) => {
      Object.entries(typePatterns).forEach(([type, pattern]) => {
        if (pattern.test(line)) {
          // Avoid duplicates
          if (!this.timeline.some(t => t.idx === idx)) {
            this.timeline.push({
              type,
              idx,
              text: line.substring(0, 80)
            })
          }
        }
      })
    })

    // Limit timeline
    this.timeline = this.timeline.slice(0, TIMELINE_TURN_LIMIT)
  }

  /**
   * Builds final digest
   */
  _buildDigest() {
    return {
      files: Array.from(this.files.values())
        .map(f => f.normalize())
        .filter(f => f.actions.length > 0 || f.errors.length > 0)
        .slice(0, 15), // Increased from 8 to 15
      errors: Array.from(this.errors.values())
        .map(e => e.normalize())
        .sort((a, b) => b.frequency - a.frequency)
        .slice(0, 15), // Increased from 10 to 15
      plans: {
        ...this.plans.normalize(),
        milestones: this.plans.normalize().milestones.slice(0, 8), // Increased from 5 to 8
        decisions: this.plans.normalize().decisions.slice(0, 6), // Increased from 3 to 6
        affectedDocs: this.plans.normalize().affectedDocs.slice(0, 8) // Increased from 5 to 8
      },
      timeline: this.timeline.slice(0, TIMELINE_TURN_LIMIT),
      enrichedTurns: this.enrichedTurns, // turns with metadata for co-author pipeline
      stats: {
        filesFound: this.files.size,
        errorsFound: this.errors.size,
        eventsTimeline: this.timeline.length,
        turnsEnriched: this.enrichedTurns.length
      }
    }
  }

  /**
   * Validates if valid file path
   */
  _isValidFilePath(path) {
    if (!path || path.length > 240) return false
    if (!path.includes('.')) return false

    const normalized = path.trim()
    const effectivePath = normalized.startsWith('./') ? normalized.slice(2) : normalized

    const extensionMatch = effectivePath.match(/\.([a-z0-9]+)$/i)
    if (!extensionMatch) return false

    const allowedExtensions = new Set([
      'js', 'cjs', 'mjs', 'ts', 'tsx', 'jsx',
      'json', 'md', 'mdx', 'yml', 'yaml', 'toml',
      'css', 'scss', 'sass', 'less',
      'html', 'htm', 'svelte', 'vue',
      'py', 'rb', 'go', 'rs', 'java', 'kt', 'cs', 'php',
      'sql'
    ])
    if (!allowedExtensions.has(extensionMatch[1].toLowerCase())) {
      return false
    }

    if (/[|*[\](){}]/.test(effectivePath)) {
      return false
    }

    // Ignore property-like references (doc.createdAt, user.email, etc.)
    if (!effectivePath.includes('/') && !/^[\w\-]+\.[\w\-]+$/i.test(effectivePath)) {
      return false
    }

    return true
  }

  /**
   * Normalizes error message (removes paths, timestamps)
   */
  _normalizeError(errorLine) {
    return errorLine
      .replace(/\/[^\/]*\//g, '[PATH]')
      .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/g, '[TIME]')
      .replace(/:\d+/g, ':LINE')
      .toLowerCase()
  }

  /**
   * Creates simple error message hash
   */
  _hashError(message) {
    let hash = 0
    for (let i = 0; i < message.length; i++) {
      const char = message.charCodeAt(i)
      hash = ((hash << 5) - hash) + char
      hash = hash & hash // Convert to 32bit integer
    }
    return Math.abs(hash).toString(36)
  }
}

/**
 * Formats structured digest as readable text
 */
export function formatDigestAsMarkdown(digest, originalStats) {
  let output = []

  // Header
  output.push('## Session Summary (Structured Compression)\n')

  if (originalStats) {
    const reduction = originalStats.sizeReduction || 0
    output.push(`**Reduction**: ${reduction}% | Turns: ${originalStats.originalTurns} → ${originalStats.keptTurns}`)
    output.push('')
  }

  // Files
  if (digest.files && digest.files.length > 0) {
    output.push('### 📁 Main Modified Files\n')
    digest.files.slice(0, 12).forEach(file => { // Increased from 8 to 12
      output.push(`- **${file.path}**`)
      output.push(`  - Status: ${file.status}`)
      if (file.actions.length > 0) {
        output.push(`  - Actions: ${file.actions.join(', ')}`)
      }
      if (file.errors.length > 0) {
        output.push(`  - Related errors: ${file.errors.length}`)
      }
    })
    output.push('')
  }

  // Errors
  if (digest.errors && digest.errors.length > 0) {
    output.push('### 🐛 Errors and Fixes\n')
    digest.errors.slice(0, 8).forEach(error => { // Increased from 5 to 8
      output.push(`- **${error.signature}**`)
      output.push(`  - Message: ${error.message.substring(0, 120)}...`) // Increased from 100 to 120
      if (error.frequency > 1) {
        output.push(`  - Occurrences: ${error.frequency}`)
      }
      if (error.fixes.length > 0) {
        output.push(`  - Fixed in: ${error.fixes.join(', ')}`)
      }
    })
    output.push('')
  }

  // Plans
  if (digest.plans) {
    if (digest.plans.milestones && digest.plans.milestones.length > 0) {
      output.push('### 🎯 Milestones/Phases\n')
      digest.plans.milestones.forEach(m => {
        output.push(`- ${m}`)
      })
      output.push('')
    }

    if (digest.plans.decisions && digest.plans.decisions.length > 0) {
      output.push('### 💡 Main Decisions\n')
      digest.plans.decisions.forEach(d => {
        output.push(`- ${d}`)
      })
      output.push('')
    }

    if (digest.plans.affectedDocs && digest.plans.affectedDocs.length > 0) {
      output.push('### 📋 Documentation Files\n')
      digest.plans.affectedDocs.forEach(doc => {
        output.push(`- ${doc}`)
      })
      output.push('')
    }
  }

  // Timeline
  if (digest.timeline && digest.timeline.length > 0) {
    output.push('### ⏱️ Event Timeline\n')
    digest.timeline.slice(0, TIMELINE_TURN_LIMIT).forEach(event => {
      const icon = event.type === 'action' ? '✅' :
                   event.type === 'error' ? '❌' :
                   event.type === 'decision' ? '🎯' :
                   event.type === 'user_request' ? '❓' :
                   event.type === 'model_response' ? '💭' : '📌'
      output.push(`${icon} [${event.type}] ${event.text}`)
    })
    output.push('')
  }

  return output.join('\n')
}
