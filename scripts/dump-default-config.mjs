#!/usr/bin/env node

import { dumpLogPipelineDefaults, getLogPipelineConfig } from '../src/log-pipeline/pipeline-config.js'

function main() {
  const defaults = dumpLogPipelineDefaults()
  const resolved = getLogPipelineConfig()

  const payload = {
    defaults,
    resolved
  }

  console.log(JSON.stringify(payload, null, 2))
}

main()
