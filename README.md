# LogSlimmer

Compress console and terminal logs for AI agents with 90% reduction while preserving relevant information.

![Svelte](https://img.shields.io/badge/Svelte-4-FF3E00?style=flat-square&logo=svelte)
![Vite](https://img.shields.io/badge/Vite-5-646CFF?style=flat-square&logo=vite)
![License](https://img.shields.io/badge/License-MIT-green?style=flat-square)

## Why LogSlimmer?

When developing with AI agents, you need to share logs efficiently:

- **Save tokens**: Reduce logs by ~90% on complex outputs (100k+ tokens)
- **Focus on what matters**: Intelligent clustering keeps only relevant information
- **No manual filtering**: AI agents get clean, compressed logs automatically
- **Fast processing**: Works with browser console and terminal logs instantly

## Quick Start

### Installation

```bash
pnpm install
pnpm dev
```

Open `http://localhost:3000` and paste your logs.

### Build

```bash
pnpm build
pnpm preview
```

## How It Works

**Two pipelines:**

1. **Log Mode** – Fast, pattern-based clustering
   - Detects log structures automatically
   - Groups similar logs by patterns, tokens, and hierarchy
   - Perfect for quick processing and lightweight diff reviews

2. **Recap Mode** – Agent log recap
   - Purpose-built for coding agent transcripts
   - Builds a timeline of investigations, fixes, and issues
   - Emits a Markdown recap compatible with LogSlimmer’s CLI and UI

## Features

- 📊 **Intelligent clustering** - Groups similar logs automatically
- 🎯 **Token counting** - See exactly how much you save
- 📁 **File upload** - Drag & drop or select files
- 🌙 **Dark/Light theme** - Persisted preferences
- ⚡ **Real-time processing** - Instant feedback while typing
- 📋 **One-click copy** - Copy results with visual feedback

## Project Structure

```
src/
├── App.svelte                          # Main application
├── log-processor.js                    # Parse and normalize logs
├── cluster-builder-no-embeddings.js    # Pattern-based clustering
├── hierarchical-clusterer.js           # Multi-level grouping
├── structural-patterns.js              # Regex pattern detection
├── enhanced-tokenizer.js               # Intelligent tokenization
├── similarity-utils.js                 # Similarity calculations
├── output-formatter.js                 # Format results
└── config.js                           # Global configuration
```

## Usage Example

**Input:** 150,000 token complex error logs
**Log Mode Output:** 15,000 tokens (~90% reduction)
**Recap Mode Output:** Timeline digest for coding agent conversations

Paste your logs and get a clean, compressed version ready for AI agents.

## Performance

| Size | Log Mode |
|------|----------|
| < 10k tokens | Instant |
| 10-100k tokens | < 500ms |
| 100k+ tokens | < 2s |

## Settings

All configurations in `src/config.js`:

```javascript
{
  clustering: {
    useHierarchical: true,
    useEnhancedTokenizer: true,
    usePatternDetection: true
  },
  processing: {
    maxLogs: 50000,
    debounceDelay: 500
  }
}
```

## Dependencies

- **js-tiktoken** - Token counting
- **Svelte** - UI framework
- **Vite** - Build tool
- **Tailwind CSS** - Styling

## License

MIT - See LICENSE file

## Support

Found an issue? Open a [GitHub issue](../../issues)

---

**LogSlimmer** - Stop wasting tokens on redundant logs. Share smart summaries with your AI agents. 🚀
