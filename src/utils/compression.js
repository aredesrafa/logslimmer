/**
 * Lightweight LZ-based string compression for memory optimization
 * Optimized for log lines which often contain repetitive patterns
 */

export const Compression = {
  // Simple LZW-style compression
  compress(uncompressed) {
    if (!uncompressed || uncompressed.length === 0) return ''
    if (uncompressed.length < 50) return uncompressed // Don't compress tiny strings
    
    let i,
      dictionary = {},
      c,
      wc,
      w = "",
      result = [],
      dictSize = 256
    
    for (i = 0; i < 256; i += 1) {
      dictionary[String.fromCharCode(i)] = i
    }
    
    for (i = 0; i < uncompressed.length; i += 1) {
      c = uncompressed.charAt(i)
      wc = w + c
      if (dictionary.hasOwnProperty(wc)) {
        w = wc
      } else {
        result.push(dictionary[w])
        // Add wc to the dictionary.
        dictionary[wc] = dictSize++
        w = String(c)
      }
    }
    
    if (w !== "") {
      result.push(dictionary[w])
    }
    
    // Convert array of codes to UTF-16 string
    return String.fromCharCode(...result)
  },

  decompress(compressed) {
    if (!compressed || compressed.length === 0) return ''
    // Heuristic check: if it looks like normal text (mostly < 256 chars) and is short, maybe it wasn't compressed
    // But our compress function returns UTF-16 chars which might look like "normal" text if we aren't careful.
    // For this simple impl, we rely on the caller knowing if they compressed it,
    // OR we add a marker. Let's just assume inputs to decompress ARE compressed.
    // However, our compress returns raw string if < 50 chars.
    if (compressed.length < 50 && !/[\u0100-\uFFFF]/.test(compressed)) return compressed

    let i,
      dictionary = [],
      w,
      result,
      k,
      entry = "",
      dictSize = 256
    
    for (i = 0; i < 256; i += 1) {
      dictionary[i] = String.fromCharCode(i)
    }
    
    w = String.fromCharCode(compressed.charCodeAt(0))
    result = w
    
    for (i = 1; i < compressed.length; i += 1) {
      k = compressed.charCodeAt(i)
      
      if (dictionary[k]) {
        entry = dictionary[k]
      } else {
        if (k === dictSize) {
          entry = w + w.charAt(0)
        } else {
          return null // Error
        }
      }
      
      result += entry
      
      // Add w+entry[0] to the dictionary.
      dictionary[dictSize++] = w + entry.charAt(0)
      
      w = entry
    }
    
    return result
  }
}
