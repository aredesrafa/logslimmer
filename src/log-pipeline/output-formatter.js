// Import needed for normalizeLine and config
import { normalizeLine } from './log-processor.js'
import { logPipelineConfig } from './pipeline-config.js'

function extractEssentialPrefix(line) {
  if (!line) return null
  const httpMatch = line.match(/^\s*(GET|POST|PUT|DELETE|PATCH|OPTIONS|HEAD)\s+(\S+)\s+(\d{3}\b.*?)(?=\s|$)/i)
  if (httpMatch) {
    return `${httpMatch[1]} ${httpMatch[2]} ${httpMatch[3]}`.trim()
  }

  const fileLineMatch = line.match(/([A-Za-z0-9_.\-\/]+:\d+)/)
  if (fileLineMatch) {
    return fileLineMatch[1]
  }

  const errorMatch = line.match(/(ERROR:|Error:|Exception:)/)
  if (errorMatch) {
    return line.slice(0, Math.min(errorMatch.index + errorMatch[0].length + 20, logPipelineConfig.maxLineLength))
  }

  return null
}

// Clamp overly long lines while keeping start/end context
export function truncateLine(line, maxLength = logPipelineConfig.maxLineLength) {
  if (!line || line.length <= maxLength) return line

  const essential = extractEssentialPrefix(line)
  if (essential && logPipelineConfig.keepFileLinePrefix) {
    const remaining = maxLength - essential.length - 5
    if (remaining > 0) {
      const suffix = line.slice(-Math.max(10, Math.floor(remaining / 2)))
      const middle = line.length > essential.length + suffix.length ? ' … ' : ' '
      return `${essential}${middle}${suffix}`
    }
  }

  const keep = Math.floor(maxLength / 2)
  return `${line.slice(0, keep)} … ${line.slice(-keep)}`
}

export function formatVariableValues(set) {
  const values = Array.from(set)
  if (values.length === 0) return '(no variables)'
  if (values.length <= 5) return values.join(', ')
  return `${values.slice(0, 5).join(', ')}, … (${values.length} values)`
}

export function limitLines(lines, maxLines = 12) {
  if (lines.length <= maxLines) {
    return lines.join('\n')
  }
  const visible = lines.slice(0, maxLines)
  visible.push(`… (${lines.length - maxLines} lines omitted)`)
  return visible.join('\n')
}

export function formatCategoryList(categoryCounts, maxCategories = 3) {
  if (!categoryCounts.size) return null

  // Optimize: Build sorted list in single pass instead of array.from().sort().slice()
  const sorted = Array.from(categoryCounts.entries())
    .sort((a, b) => b[1] - a[1])

  const formatted = []
  for (let i = 0; i < Math.min(maxCategories, sorted.length); i++) {
    const [category, count] = sorted[i]
    formatted.push(`${category} (${count})`)
  }

  if (sorted.length > maxCategories) {
    formatted.push(`… (${sorted.length - maxCategories} additional categories)`)
  }

  return formatted.join(', ')
}

export function formatVariables(cluster, maxPlaceholders = 5) {
  if (!cluster.variables || !cluster.variables.size) return null
  const entries = Array.from(cluster.variables.entries())
  const limited = entries.slice(0, maxPlaceholders)
  const lines = limited.map(
    ([placeholder, values]) => `- ${placeholder}: ${formatVariableValues(values)}`
  )
  if (entries.length > maxPlaceholders) {
    lines.push(`- … (${entries.length - maxPlaceholders} additional placeholders)`)
  }
  return lines.join('\n')
}

export function formatCluster(cluster, index) {
  const occurrences = cluster.events.length
  const header = `### Cluster ${index + 1} (${occurrences} occurrence${occurrences > 1 ? 's' : ''})`
  const representative = truncateLine(cluster.templateLines[0] || '(no template)')
  const templatePreview = cluster.templateLines.slice(0, 3)
    .map((line) => `- ${truncateLine(line)}`)
    .join('\n') || '- (no template)'
  const variablesSection = formatVariables(cluster)
  const categories = formatCategoryList(cluster.categoryCounts)
  const annotatedSample = annotateRepetitions(cluster.firstEvent.processedLines)
  const sampleSection = limitLines(annotatedSample, 10)

  const parts = [
    header,
    `Representative: ${representative}`,
    `Template (preview):\n${templatePreview}`,
  ]

  if (variablesSection) {
    parts.push(`Variables:\n${variablesSection}`)
  }

  if (categories) {
    parts.push(`Related categories: ${categories}`)
  }

  parts.push('Sample:', sampleSection)

  return parts.join('\n')
}

export function annotateRepetitions(lines) {
  const normalized = lines.map((line) => normalizeLine(line))
  const result = []
  let index = 0

  while (index < lines.length) {
    let count = 1
    while (
      index + count < lines.length &&
      normalized[index + count] === normalized[index]
    ) {
      count += 1
    }

    const truncated = truncateLine(lines[index])
    result.push(truncated)

    if (count > 1) {
      result.push(
        `/* Pattern repeated ${count}×\n   First occurrence:\n   ${lines[index]}\n*/`
      )
    }

    index += count
  }

  return result
}

export function formatUniqueEvents(uniqueEvents, limit = logPipelineConfig.miscUniqueLimit) {
  if (!uniqueEvents?.length) return ''
  const selected = uniqueEvents
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .slice(0, limit)

  const lines = ['## Unique Events']
  for (const event of selected) {
    const sample = annotateRepetitions(event.processedLines || [])
    const rendered = limitLines(sample, 8)
    lines.push(`- Order ${event.order ?? '?'} | Score ${event.score ?? 0}\n${rendered}`)
  }
  if (uniqueEvents.length > limit) {
    lines.push(`- … (${uniqueEvents.length - limit} additional unique events omitted)`)
  }
  return lines.join('\n')
}

export function buildErrorSummary(clusters) {
  const summary = new Map()

  for (const cluster of clusters) {
    for (const [category, count] of cluster.categoryCounts.entries()) {
      if (!summary.has(category)) {
        summary.set(category, [])
      }
      summary.get(category).push({
        count,
        template: cluster.templateLines[0] || '(no title)',
        example: cluster.firstEvent.processedLines[0] || '(no example)'
      })
    }
  }

  if (summary.size === 0) return ''

  const sections = ['## Error Summary']

  for (const [category, entries] of summary.entries()) {
    if (category === 'Other' && !logPipelineConfig.showOtherInSummary) continue
    const aggregated = new Map()
    for (const entry of entries) {
      const key = entry.template
      if (!aggregated.has(key)) {
        aggregated.set(key, { ...entry })
      } else {
        const existing = aggregated.get(key)
        existing.count += entry.count
        if (!existing.example && entry.example) {
          existing.example = entry.example
        }
      }
    }
    const aggregatedEntries = Array.from(aggregated.values())
    const total = aggregatedEntries.reduce((sum, entry) => sum + entry.count, 0)
    sections.push(`### ${category} (${total} occurrence${total > 1 ? 's' : ''})`)
    const topEntries = aggregatedEntries.sort((a, b) => b.count - a.count)
    const maxEntries = 5
    for (const entry of topEntries.slice(0, maxEntries)) {
      const templatePreview = entry.template.length > 160
        ? `${entry.template.slice(0, 160)}…`
        : entry.template
      const examplePreview = entry.example.length > 160
        ? `${entry.example.slice(0, 160)}…`
        : entry.example
      sections.push(`- "${templatePreview}" (${entry.count}×) — example: ${examplePreview}`)
    }
    if (topEntries.length > maxEntries) {
      sections.push(`- … (${topEntries.length - maxEntries} additional patterns)`)
    }
  }

  return sections.join('\n')
}
