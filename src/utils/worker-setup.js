
/**
 * Standardized Worker Setup
 *
 * Handles boilerplate for Web Workers:
 * - Message listeners
 * - Error handling (global + message specific)
 * - Timeout protection
 * - Status reporting
 */
export function setupWorker(handlers, config = {}) {
  const {
    workerName = 'worker',
    timeoutMs = 90000
  } = config

  if (typeof console !== 'undefined') {
    console.log(`[${workerName}] Worker script evaluating...`)
  }

  if (typeof self !== 'undefined') {
    // Notify that script has loaded
    try {
      self.postMessage({ type: 'log', data: `[${workerName}] script loaded` })
    } catch (postError) {
      if (typeof console !== 'undefined') {
        console.warn(`[${workerName}] Failed to post initial status:`, postError)
      }
    }

    // Global Error Handler
    self.addEventListener('error', (event) => {
      if (typeof console !== 'undefined') {
        console.error(`[${workerName}] Global error event:`, event.message, event.error)
      }
      try {
        self.postMessage({
          type: 'error',
          data: event.message || event.error?.message || 'Worker script error'
        })
      } catch (postError) {
        if (typeof console !== 'undefined') {
          console.error(`[${workerName}] Failed to post error message:`, postError)
        }
      }
    })

    // Unhandled Rejection Handler
    self.addEventListener('unhandledrejection', (event) => {
      if (typeof console !== 'undefined') {
        console.error(`[${workerName}] Unhandled rejection:`, event.reason)
      }
      try {
        self.postMessage({
          type: 'error',
          data: event.reason instanceof Error ? event.reason.message : String(event.reason ?? 'Unhandled rejection')
        })
      } catch (postError) {
        if (typeof console !== 'undefined') {
          console.error(`[${workerName}] Failed to post rejection message:`, postError)
        }
      }
    })

    // Message Handler
    self.onmessage = async function (e) {
      const { type, data, options } = e.data
      const handler = handlers[type]

      if (handler) {
        try {
          const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => reject(new Error(`Processing timeout after ${Math.round(timeoutMs / 1000)} seconds`)), timeoutMs)
          })

          const result = await Promise.race([
            handler(data, options),
            timeoutPromise
          ])

          self.postMessage({ type: 'result', data: result })
        } catch (error) {
          if (typeof console !== 'undefined') {
            console.error(`[${workerName}] Processing failed:`, error)
          }
          self.postMessage({ type: 'error', data: error instanceof Error ? error.message : String(error) })
        }
      } else {
         if (typeof console !== 'undefined') {
            console.warn(`[${workerName}] Unknown message type: ${type}`)
         }
      }
    }
  }
}
