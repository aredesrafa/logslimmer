#!/usr/bin/env node

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { runLogRecapPipeline } from '../src/log-recap/pipeline.js'
import { countTokens } from './utils/performance-utils.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(__dirname, '..')

async function runLogRecapTest() {
  const inputPath = path.join(__dirname, 'input-test-logrecap.txt')
  if (!fs.existsSync(inputPath)) {
    console.error(`❌ Missing log file: ${inputPath}`)
    process.exit(1)
  }

  const logText = fs.readFileSync(inputPath, 'utf-8')
  const start = Date.now()
  const result = await runLogRecapPipeline(logText)
  const durationMs = Date.now() - start

  const originalSize = logText.length
  const outputSize = result.compressed.length
  const originalTokens = countTokens(logText)
  const outputTokens = countTokens(result.compressed)
  const reduction = originalSize > 0 ? Math.round((1 - outputSize / originalSize) * 100) : 0
  const metrics = {
    mode: result.stats.mode,
    originalChars: originalSize,
    compressedChars: outputSize,
    originalTokens,
    compressedTokens: outputTokens,
    reductionPercent: reduction,
    originalLines: result.stats.originalLines,
    chunkCount: result.chunkSummaries.length,
    filesTracked: result.digest.files?.length || 0,
    issuesTracked: result.digest.errors?.length || 0,
    processingMs: durationMs
  }

  console.log('\n══════════ LOG RECAP PERFORMANCE ══════════')
  console.log(`Input: ${originalSize} chars (${result.stats.originalLines} lines)`)
  console.log(`Output: ${outputSize} chars`)
  console.log(`Tokens: ${originalTokens} → ${outputTokens}`)
  console.log(`Reduction: ${reduction}%`)
  console.log(`Chunks: ${result.chunkSummaries.length}`)
  console.log(`Files tracked: ${metrics.filesTracked}`)
  console.log(`Issues tracked: ${metrics.issuesTracked}`)
  console.log(`Processing time: ${(durationMs / 1000).toFixed(2)}s`)

  const outputFile = path.join(projectRoot, 'test-logrecap-results.json')
  fs.writeFileSync(outputFile, JSON.stringify({ metrics, summary: result.compressed }, null, 2))
  console.log(`\n📁 Results saved to: ${path.basename(outputFile)}`)
}

runLogRecapTest().catch(error => {
  console.error('❌ Log Recap test failed:', error)
  process.exit(1)
})
