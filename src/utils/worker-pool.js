/**
 * Worker Pool for parallel processing
 * Manages a pool of Web Workers to distribute CPU-intensive tasks.
 */

export class WorkerPool {
  constructor(workerScriptUrl, size = navigator.hardwareConcurrency || 4) {
    this.workerScriptUrl = workerScriptUrl
    this.size = Math.max(2, size) // At least 2 workers
    this.workers = []
    this.queue = []
    this.activeTaskCounts = new Array(this.size).fill(0)
    this.taskMap = new Map()
    this.taskIdCounter = 0
    
    this.initialize()
  }

  initialize() {
    if (typeof Worker === 'undefined') {
      console.warn('[WorkerPool] Web Workers are not supported in this environment.')
      return
    }

    for (let i = 0; i < this.size; i++) {
      try {
        const worker = new Worker(this.workerScriptUrl, { type: 'module' })
        
        worker.onmessage = (e) => this.handleMessage(i, e)
        worker.onerror = (e) => this.handleError(i, e)
        
        this.workers.push(worker)
      } catch (error) {
        console.warn(`[WorkerPool] Failed to initialize worker ${i}:`, error)
      }
    }
    console.log(`[WorkerPool] Initialized with ${this.workers.length} workers`)
  }

  get isOperational() {
    return this.workers.length > 0
  }

  handleMessage(workerIndex, event) {
    const { type, id, data, error } = event.data
    
    if (this.taskMap.has(id)) {
      const { resolve, reject } = this.taskMap.get(id)
      this.taskMap.delete(id)
      this.activeTaskCounts[workerIndex]--
      
      if (type === 'error' || error) {
        reject(new Error(error || 'Worker error'))
      } else {
        resolve(data)
      }
      
      // Process next task in queue if any
      this.processQueue()
    }
  }

  handleError(workerIndex, event) {
    console.error(`[WorkerPool] Error in worker ${workerIndex}:`, event)
    // Fail all tasks assigned to this worker? 
    // For now, just log. Real robust pools would retry.
  }

  terminate() {
    this.workers.forEach(w => w.terminate())
    this.workers = []
    this.queue = []
    this.taskMap.clear()
  }

  async run(messageType, payload, transferList = []) {
    if (this.workers.length === 0) {
      throw new Error('Worker pool not initialized or empty')
    }

    return new Promise((resolve, reject) => {
      const taskId = ++this.taskIdCounter
      
      const task = {
        id: taskId,
        message: { type: messageType, id: taskId, ...payload },
        transferList,
        resolve,
        reject
      }
      
      this.queue.push(task)
      this.processQueue()
    })
  }

  processQueue() {
    if (this.queue.length === 0) return

    // Find least busy worker
    let bestWorkerIdx = -1
    let minTasks = Infinity

    for (let i = 0; i < this.workers.length; i++) {
      if (this.activeTaskCounts[i] < minTasks) {
        minTasks = this.activeTaskCounts[i]
        bestWorkerIdx = i
      }
    }

    // Simple throttle: don't overload single worker too much
    // But for CPU bound tasks, we usually want 1 task per worker at a time
    // Let's allow a small buffer
    if (bestWorkerIdx !== -1) {
      const task = this.queue.shift()
      if (task) {
        this.activeTaskCounts[bestWorkerIdx]++
        this.taskMap.set(task.id, task)
        this.workers[bestWorkerIdx].postMessage(task.message, task.transferList)
      }
    }
  }
}
