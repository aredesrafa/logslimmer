#!/usr/bin/env node

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { runLogSlimmerPipeline } from '../src/worker-logslimmer.js'
import { splitIntoEvents } from '../src/log-pipeline/log-processor.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

async function runReproStoryTest() {
  const inputPath = path.join(__dirname, 'repro-story.txt')
  if (!fs.existsSync(inputPath)) {
    console.error(`❌ Missing log file: ${inputPath}`)
    process.exit(1)
  }

  const logText = fs.readFileSync(inputPath, 'utf-8')
  const events = splitIntoEvents(logText)
  
  // Verify detection of story markers
  const storyMarkers = events.filter(e => e.primaryCategory === 'Story')
  console.log(`Found ${storyMarkers.length} story markers.`)
  storyMarkers.forEach(m => console.log(` - [${m.score}] ${m.processedLines[0]}'`))

  const output = await runLogSlimmerPipeline(logText)
  
  console.log('\n══════════ OUTPUT PREVIEW ══════════')
  console.log(output)
  
  if (storyMarkers.length === 0) {
    console.error('❌ Failed to detect story markers.')
    process.exit(1)
  }
  
  if (!output.includes('## Scenario Reconstruction')) {
    console.error('❌ Output missing Scenario Reconstruction section.')
    process.exit(1)
  }

  console.log('\n✅ Test Passed')
}

runReproStoryTest().catch(error => {
  console.error('❌ Test failed:', error)
  process.exit(1)
})
