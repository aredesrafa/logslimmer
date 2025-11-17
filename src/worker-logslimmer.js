import { splitIntoEvents } from './log-pipeline/log-processor.js'
import { buildClustersNoEmbeddings } from './log-pipeline/cluster-builder-no-embeddings.js'
import { buildErrorSummary, formatCluster } from './log-pipeline/output-formatter.js'
import { logPipelineConfig } from './log-pipeline/pipeline-config.js'

console.log('[worker] Worker script evaluating...')

if (typeof self !== 'undefined') {
  try {
    self.postMessage({ type: 'log', data: '[worker] script loaded' })
  } catch (postError) {
    if (typeof console !== 'undefined') {
      console.warn('[worker] Failed to post initial status:', postError)
    }
  }

  self.addEventListener('error', (event) => {
    // Ensure worker-side errors are visible in devtools
    if (typeof console !== 'undefined') {
      console.error('[worker] Global error event:', event.message, event.error)
    }
    try {
      self.postMessage({
        type: 'error',
        data: event.message || event.error?.message || 'Worker script error'
      })
    } catch (postError) {
      if (typeof console !== 'undefined') {
        console.error('[worker] Failed to post error message:', postError)
      }
    }
  })

  self.addEventListener('unhandledrejection', (event) => {
    if (typeof console !== 'undefined') {
      console.error('[worker] Unhandled rejection:', event.reason)
    }
    try {
      self.postMessage({
        type: 'error',
        data: event.reason instanceof Error ? event.reason.message : String(event.reason ?? 'Unhandled rejection')
      })
    } catch (postError) {
      if (typeof console !== 'undefined') {
        console.error('[worker] Failed to post rejection message:', postError)
      }
    }
  })
}

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
  if (typeof console !== 'undefined') {
    console.log('[worker] Relevant events:', relevantEvents.length)
  }

  if (typeof console !== 'undefined') {
    console.log('[worker] Starting cluster building...')
  }

  const clusters = await buildClustersNoEmbeddings(relevantEvents)

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

  const clustersToRender = filteredClusters.slice(0, logPipelineConfig.maxClusters)
  const clusterBlocks = clustersToRender.map(formatCluster)
  if (filteredClusters.length > logPipelineConfig.maxClusters) {
    clusterBlocks.push(`… (${filteredClusters.length - logPipelineConfig.maxClusters} additional clusters omitted)\n`)
  }
  const clustersSection = clusterBlocks.join('\n\n')

  const result = [summary, '## Event Clusters', clustersSection]
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

if (typeof self !== 'undefined') {
  self.onmessage = async function (e) {
    const { type, data } = e.data

    if (type === 'compress') {
      try {
        // Add timeout protection (90 seconds)
        const timeoutPromise = new Promise((_, reject) => {
          setTimeout(() => reject(new Error('Processing timeout after 90 seconds')), 90000)
        })

        const result = await Promise.race([
          compressLog(data),
          timeoutPromise
        ])

        self.postMessage({ type: 'result', data: result })
      } catch (error) {
        self.postMessage({ type: 'error', data: error instanceof Error ? error.message : String(error) })
      }
    }
  }
}
