#!/usr/bin/env node

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { runLogSlimmerPipeline } from './src/worker-logslimmer.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

async function main() {
  const inputPath = path.join(__dirname, 'tests/experiment-input01.txt')
  const outputPath = path.join(__dirname, 'tests/experiment-output01-new.txt')

  if (!fs.existsSync(inputPath)) {
    console.error(`❌ Input file not found: ${inputPath}`)
    process.exit(1)
  }

  console.log('🔄 Reprocessing experiment input with current log slimmer...')

  const inputText = fs.readFileSync(inputPath, 'utf-8')
  console.log(`📄 Input size: ${(inputText.length / 1024).toFixed(2)} KB`)

  const startTime = Date.now()
  const result = await runLogSlimmerPipeline(inputText)
  const duration = Date.now() - startTime

  console.log(`✅ Processing complete in ${(duration / 1000).toFixed(2)}s`)
  console.log(`📄 Output size: ${(result.length / 1024).toFixed(2)} KB`)

  fs.writeFileSync(outputPath, result, 'utf-8')
  console.log(`💾 Saved new output to: ${outputPath}`)
}

main().catch(error => {
  console.error('❌ Error:', error)
  process.exit(1)
})