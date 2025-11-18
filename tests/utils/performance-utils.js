import { encodingForModel } from 'js-tiktoken'

let encoder = null

export function countTokens(text) {
  if (!text) return 0
  if (!encoder) {
    encoder = encodingForModel('gpt-3.5-turbo')
  }
  return encoder.encode(text).length
}

export function cleanupEncoder() {
  if (encoder?.free) {
    encoder.free()
    encoder = null
  }
}

if (typeof process !== 'undefined') {
  process.on('exit', cleanupEncoder)
}
