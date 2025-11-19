import { splitIntoEvents } from './log-pipeline/log-processor.js'
import { buildClustersNoEmbeddings } from './log-pipeline/cluster-builder-no-embeddings.js'
import { buildErrorSummary, formatCluster, formatUniqueEvents } from './log-pipeline/output-formatter.js'
import { logPipelineConfig } from './log-pipeline/pipeline-config.js'
import { setupWorker } from './utils/worker-setup.js'
import { WorkerPool } from './utils/worker-pool.js'

// Initialize worker pool for parallel processing
// Vite handles the URL resolution correctly during build
const similarityWorkerPool = new WorkerPool(new URL('./worker-similarity.js', import.meta.url))

async function compressLog(inputText = '') {

  if (typeof console !== 'undefined') {
    console.log('[worker] Starting compression, input length:', inputText.length)
  }

  if (!inputText.trim()) {
    return 'No log provided.'
  }

  const events = splitIntoEvents(inputText)
  if (typeof console !== 'undefined') {
    console.log('[worker] Events parsed:', events.length)
  }

  const relevantEvents = events.filter(
    (event) =>
      event &&
      (
        event.primaryCategory && event.primaryCategory !== 'Other'
          ? event.score > logPipelineConfig.scoreCutoffNonOther
          : event.score > logPipelineConfig.scoreCutoffOther
      )
  )

  // Extract Story markers
  const storyMarkerEvents = relevantEvents.filter(e => e.primaryCategory === 'Story')
  const clusterableEvents = relevantEvents.filter(e => e.primaryCategory !== 'Story')

  if (typeof console !== 'undefined') {
    console.log('[worker] Relevant events:', relevantEvents.length)
    console.log('[worker] Story markers:', storyMarkerEvents.length)
  }

  if (typeof console !== 'undefined') {
    console.log('[worker] Starting cluster building...')
  }

  const clusters = await buildClustersNoEmbeddings(clusterableEvents, similarityWorkerPool)

  if (typeof console !== 'undefined') {
    console.log('[worker] Clusters built:', clusters.length)
  }

  const nonOtherClusters = clusters.filter((cluster) => cluster.primaryCategory !== 'Other')
  const otherClusters = clusters.filter((cluster) => cluster.primaryCategory === 'Other')
  const limitedOther = otherClusters.slice(0, logPipelineConfig.maxOtherClusters)
  const filteredClusters = [...nonOtherClusters, ...limitedOther]

  if (typeof console !== 'undefined' && otherClusters.length > limitedOther.length) {
    console.log('[worker] Other clusters trimmed:', {
      kept: limitedOther.length,
      dropped: otherClusters.length - limitedOther.length
    })
  }

  const summary = buildErrorSummary(filteredClusters)
  if (typeof console !== 'undefined') {
    console.log('[worker] Summary built, length:', summary.length)
  }

  // Build Scenario Reconstruction
  let storySection = ''
  if (storyMarkerEvents.length > 0) {
    storySection = '## Scenario Reconstruction\n' + storyMarkerEvents
      .sort((a, b) => a.order - b.order)
      .map(e => e.processedLines.join('\n'))
      .join('\n\n')
  }

  const clustersToRender = filteredClusters.slice(0, logPipelineConfig.maxClusters)
  const clusterBlocks = clustersToRender.map(formatCluster)
  if (filteredClusters.length > logPipelineConfig.maxClusters) {
    clusterBlocks.push(`… (${filteredClusters.length - logPipelineConfig.maxClusters} additional clusters omitted)\n`)
  }
  const clustersSection = clusterBlocks.join('\n\n')

  const isRelevantUnique = (event) => {
    const text = (event.processedLines || []).join(' ')
    const hasErrorish = /(error|exception|aborted|timeout|denied|reset|not found|unauthorized|forbidden|syntaxerror)/i.test(text)
    const statusMatch = text.match(/\b([1-5]\d{2})\b/)
    const status = statusMatch ? Number(statusMatch[1]) : null
    const latencyMatch = text.match(/\b(\d{4,})ms\b/i)
    const latencyMs = latencyMatch ? Number(latencyMatch[1]) : 0
    return (
      hasErrorish ||
      (status !== null && status >= 400) ||
      latencyMs >= 5000
    )
  }

  const uniqueEvents = filteredClusters
    .filter((cluster) => cluster.events.length === 1)
    .map((cluster) => cluster.events[0])
    .filter(isRelevantUnique)

  const uniqueSection = formatUniqueEvents(uniqueEvents, logPipelineConfig.miscUniqueLimit)

  const result = [storySection, summary, '## Event Clusters', clustersSection, uniqueSection]
    .filter(Boolean)
    .join('\n\n')

  if (typeof console !== 'undefined') {
    console.log('[worker] Compression completed, result length:', result.length)
  }

  return result
}

export async function runLogSlimmerPipeline(inputText = '') {
  return compressLog(inputText)
}

setupWorker({
  'compress': compressLog
}, {
  workerName: 'worker-logslimmer',
  timeoutMs: 90000
})
