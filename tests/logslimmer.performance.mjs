#!/usr/bin/env node

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { runLogSlimmerPipeline } from '../src/worker-logslimmer.js'
import { splitIntoEvents } from '../src/log-pipeline/log-processor.js'
import { countTokens } from './utils/performance-utils.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(__dirname, '..')

async function runLogSlimmerTest() {
  const inputPath = path.join(__dirname, 'input-test-logslimmer.txt')
  if (!fs.existsSync(inputPath)) {
    console.error(`❌ Missing log file: ${inputPath}`)
    process.exit(1)
  }

  const logText = fs.readFileSync(inputPath, 'utf-8')
  const events = splitIntoEvents(logText)

  const start = Date.now()
  const summary = await runLogSlimmerPipeline(logText)
  const durationMs = Date.now() - start

  const originalSize = logText.length
  const outputSize = summary.length
  const originalTokens = countTokens(logText)
  const outputTokens = countTokens(summary)
  const reduction = originalSize > 0 ? Math.round((1 - outputSize / originalSize) * 100) : 0

  const metrics = {
    originalChars: originalSize,
    summaryChars: outputSize,
    originalTokens,
    summaryTokens: outputTokens,
    reductionPercent: reduction,
    eventCount: events.length,
    processingMs: durationMs
  }

  console.log('\n══════════ LOG SLIMMER PERFORMANCE ══════════')
  console.log(`Events detected: ${events.length}`)
  console.log(`Input size: ${originalSize} chars (${originalTokens} tokens)`)
  console.log(`Output size: ${outputSize} chars (${outputTokens} tokens)`)
  console.log(`Reduction: ${reduction}%`)
  console.log(`Processing time: ${(durationMs / 1000).toFixed(2)}s`)

  const outputFile = path.join(projectRoot, 'test-logslimmer-results.json')
  fs.writeFileSync(outputFile, JSON.stringify({ metrics, summary }, null, 2))
  console.log(`\n📁 Results saved to: ${path.basename(outputFile)}`)
}

runLogSlimmerTest().catch(error => {
  console.error('❌ Log Slimmer test failed:', error)
  process.exit(1)
})
