#!/usr/bin/env node

/**
 * AGGRESSIVE DIGEST COMPRESSION
 *
 * Objetivo: 80%+ compressão mantendo 100% de informação crítica
 *
 * Abordagem: Structured Digest
 * 1. Segmenta log em turnos
 * 2. Extrai fatos estruturados (arquivos, erros, decisões)
 * 3. Collapsa eventos: transforma turns verbosas em 1-2 linhas
 * 4. Output: Recap técnico muito mais curto
 *
 * Resultado esperado: 50k tokens → 10k tokens bem estruturados
 */

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { segmentIntoTurns } from '../log-pipeline/semantic-analyzer.js'
import {
  StructuredDigestExtractor,
  formatDigestAsMarkdown
} from '../log-pipeline/log-structured-digest.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(__dirname, '..')

/**
 * Compressão agressiva com digest estruturado
 */
async function compressLogAggressive(text) {
  console.log('⏱️  Iniciando compressão agressiva (structured digest)...')
  const startTime = Date.now()

  // Estatísticas iniciais
  const originalLength = text.length
  const originalLines = text.split('\n').length

  // 1. Segmentar em turnos
  console.log('   1. Segmentando log em turnos semânticos...')
  const turns = segmentIntoTurns(text)
  console.log(`      ✓ ${turns.length} turnos identificados`)

  // 2. Extrair digest estruturado
  console.log('   2. Extraindo fatos estruturados...')
  const extractor = new StructuredDigestExtractor(text, turns)
  const digest = extractor.extract()

  console.log(`      ✓ ${digest.stats.filesFound} arquivos`)
  console.log(`      ✓ ${digest.stats.errorsFound} erros únicos`)
  console.log(`      ✓ ${digest.plans.milestones?.length || 0} milestones`)

  // 3. Compressão agressiva: juntar com estrutura de fatos
  console.log('   3. Comprimindo com estrutura agressiva...')
  const compressed = buildCompressedOutput('', digest, turns) // Placeholder inicial

  // 4. Calcular redução real
  const sizeReduction = Math.round((1 - compressed.length / originalLength) * 100)

  // 5. Gerar output formatado com redução real (markdown)
  console.log('   4. Gerando recap técnico com estatísticas reais...')
  const recap = formatDigestAsMarkdown(digest, {
    originalLength,
    originalLines,
    originalTurns: turns.length,
    keptTurns: Math.ceil(turns.length * 0.2), // Estimativa: 20% dos turnos
    sizeReduction
  })

  // Recompor com recap real
  const compressedFinal = buildCompressedOutput(recap, digest, turns)

  const elapsed = Date.now() - startTime

  return {
    compressed: compressedFinal,
    digest,
    stats: {
      originalLength,
      originalLines,
      originalTurns: turns.length,
      originalSize: (originalLength / 1024).toFixed(2), // KB
      compressedSize: (compressedFinal.length / 1024).toFixed(2),
      sizeReduction: Math.round((1 - compressedFinal.length / originalLength) * 100),
      filesExtracted: digest.stats.filesFound,
      errorsExtracted: digest.stats.errorsFound,
      eventsInTimeline: digest.stats.eventsTimeline,
      processingTimeMs: elapsed
    }
  }
}

/**
 * Constrói output comprimido final
 * Combina recap em markdown + dados estruturados
 */
function buildCompressedOutput(recap, digest, turns) {
  const parts = [recap]

  // Adicionar timeline em formato compacto se houver
  if (digest.timeline && digest.timeline.length > 0) {
    parts.push('\n\n---\n\n### 📊 Eventos Detalhados\n')
    digest.timeline.forEach(event => {
      parts.push(`[${event.idx}] ${event.type}: ${event.text}`)
    })
  }

  // Footer com metadados
  parts.push('\n\n---\n')
  parts.push(`\n_Resumo gerado automaticamente com Structured Digest Compression_`)
  parts.push(`\n_Tipos de arquivos: ${digest.stats.filesFound} | Erros únicos: ${digest.stats.errorsFound}_`)
  parts.push(`\n_Turnos originais: ${turns.length}_`)

  return parts.join('\n')
}

/**
 * Alternativa: output em JSON para integração
 */
function buildCompressedOutputJSON(digest, stats) {
  return JSON.stringify({
    metadata: {
      timestamp: new Date().toISOString(),
      compression: `${stats.sizeReduction}%`,
      originalSize: `${stats.originalSize} KB`,
      compressedSize: `${stats.compressedSize} KB`,
      processingTimeMs: stats.processingTimeMs
    },
    digest: {
      files: digest.files.slice(0, 10),
      errors: digest.errors.slice(0, 5),
      plans: digest.plans,
      timeline: digest.timeline.slice(0, 15)
    }
  }, null, 2)
}

/**
 * Main
 */
async function main() {
  const inputFile = process.argv[2] || 'inputlmchat.txt'
  const outputFormat = process.argv[3] || 'markdown' // markdown ou json

  const inputPath = path.resolve(projectRoot, inputFile)

  if (!fs.existsSync(inputPath)) {
    console.error(`❌ Arquivo não encontrado: ${inputPath}`)
    process.exit(1)
  }

  console.log('\n' + '='.repeat(90))
  console.log('🚀 AGGRESSIVE DIGEST COMPRESSION - Structured Extraction')
  console.log('='.repeat(90) + '\n')

  const inputText = fs.readFileSync(inputPath, 'utf-8')

  console.log('📄 Input:')
  console.log(`   Arquivo: ${inputFile}`)
  console.log(`   Tamanho: ${(inputText.length / 1024 / 1024).toFixed(2)} MB`)
  console.log(`   Linhas: ${inputText.split('\n').length.toLocaleString()}`)
  console.log(`   Formato saída: ${outputFormat}`)
  console.log('')

  try {
    const result = await compressLogAggressive(inputText)

    console.log('')
    console.log('✅ Compressão concluída!\n')

    console.log('📊 Resultados:')
    console.log(`   Tamanho original: ${result.stats.originalSize} KB`)
    console.log(`   Tamanho final: ${result.stats.compressedSize} KB`)
    console.log(`   Redução: ${result.stats.sizeReduction}%`)
    console.log(`   Tempo: ${(result.stats.processingTimeMs / 1000).toFixed(2)}s`)
    console.log('')

    console.log('📋 Extraction:')
    console.log(`   Arquivos: ${result.stats.filesExtracted}`)
    console.log(`   Erros únicos: ${result.stats.errorsExtracted}`)
    console.log(`   Eventos: ${result.stats.eventsInTimeline}`)
    console.log('')

    // Salvar output
    const baseName = path.basename(inputFile, path.extname(inputFile))
    let outputPath
    let contentToWrite

    if (outputFormat === 'json') {
      outputPath = path.join(projectRoot, `DIGEST_AGGRESSIVE_${baseName}.json`)
      contentToWrite = buildCompressedOutputJSON(result.digest, result.stats)
    } else {
      outputPath = path.join(projectRoot, `DIGEST_AGGRESSIVE_${baseName}.md`)
      contentToWrite = result.compressed
    }

    fs.writeFileSync(outputPath, contentToWrite, 'utf-8')

    console.log('💾 Salvo:')
    console.log(`   ${path.basename(outputPath)}`)
    console.log(`   Tamanho: ${(contentToWrite.length / 1024).toFixed(2)} KB`)
    console.log('')

    console.log('='.repeat(90))
    console.log('✨ SUCESSO!')
    console.log('='.repeat(90) + '\n')

    // Exibir preview dos primeiros arquivos
    if (result.digest.files.length > 0) {
      console.log('📌 Preview - Primeiros arquivos extraídos:')
      result.digest.files.slice(0, 3).forEach(f => {
        console.log(`   • ${f.path} [${f.status}]`)
      })
      console.log('')
    }

  } catch (error) {
    console.error(`\n❌ Erro: ${error.message}`)
    console.error(error.stack)
    process.exit(1)
  }
}

main().catch(error => {
  console.error(`\n❌ Erro fatal: ${error.message}`)
  process.exit(1)
})
