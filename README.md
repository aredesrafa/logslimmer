# LogSlimmer

Token-first log compression and timeline recaps that keep autonomous agents efficient.

![Svelte](https://img.shields.io/badge/Svelte-4-FF3E00?style=flat-square&logo=svelte)
![Vite](https://img.shields.io/badge/Vite-5-646CFF?style=flat-square&logo=vite)
![License](https://img.shields.io/badge/License-MIT-green?style=flat-squar
[![Demo](https://img.shields.io/badge/Live%20Demo-LogSlimmer-blue)](https://aredesrafa.github.io/logslimmer/)  
**➡️ Want to help shape LogSlimmer?** [Join the discussions](https://github.com/aredesrafa/logslimmer/discussions) and share your feedback.

⭐ If you find it useful, consider giving the repository a star — it really helps.
e)

LogSlimmer ships two instant pipelines:

- **LogSlimmer** — compresses raw console or terminal streams while preserving actionable context.
- **LogRecap** — turns multi-turn agent transcripts into a compact, navigable recap.

Both engines are purpose-built to **save tokens for downstream agents**. Inputs up to **100k tokens process in milliseconds**, so you can keep iterating without throttling your context window.

## Why LogSlimmer & LogRecap?

- **Aggressive token savings**: Typical reductions stay above 90% even on noisy logs.
- **Signal over noise**: Pattern-aware clustering and heuristics surface the actions, errors, and files that matter.
- **Hands-free workflows**: Paste text, drop a file, or run the CLI — the pipelines auto-clean and dedupe for you.
- **Consistent speed**: Browser-friendly workers deliver instantaneous feedback for large pastes.

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

## Pipelines

### LogSlimmer (Token Compression)
- Detects structural patterns, stack traces, diffs, and repetitions automatically.
- Collapses redundant blocks while keeping representative examples.
- Counts tokens so you can compare before/after usage instantly.

### LogRecap (Agent Timeline)
- Parses coding-agent transcripts into a chronological storyline.
- Tracks files, issues, commands, and decisions for quick playback.
- Emits Markdown recaps suitable for pasting back into agent chats or storing alongside artifacts.

## Features

- 📊 **Structural clustering** — groups repetitions, diff chunks, and stack traces automatically.
- 🧠 **Agent-focused recap** — LogRecap rebuilds investigation timelines for long-running sessions.
- 🎯 **Token accounting** — live counters show original vs. compressed usage.
- 📁 **Flexible ingestion** — paste, drag & drop, or call the CLI helpers under `src/cli/`.
- 🌙 **Themable UI** — light/dark modes with persisted preferences.
- ⚡ **Instant feedback** — browser workers keep processing interactive even on six-figure token inputs.

## Project Structure

```
src/
├── App.svelte                 # Main Svelte interface
├── app.css
├── cli/                       # CLI entry points (LogSlimmer & LogRecap)
├── config.js                  # Shared configuration flags
├── log-pipeline/              # LogSlimmer compression pipeline
│   ├── cluster-builder-no-embeddings.js
│   ├── config-clustering.js
│   ├── core/
│   └── …
├── log-recap/                 # LogRecap timeline pipeline
│   └── pipeline.js
├── utils/                     # Tokenizers, caches, shared helpers
├── worker-logslimmer.js       # Worker for LogSlimmer
├── worker-logrecap.js         # Worker for LogRecap
└── main.ts
```

## Usage Example

**Input:** 120,000 token debugging session
**LogSlimmer Output:** 10,500 tokens (~91% reduction)
**LogRecap Output:** Markdown recap listing investigations, fixes, and unresolved issues

Paste your logs and get a clean, compressed version ready for AI agents.

## Performance

| Input Size | LogSlimmer | LogRecap |
|------------|------------|----------|
| < 10k tokens | Instant | Instant |
| 10k–100k tokens | Instant (<100 ms) | Instant (<100 ms) |
| 100k–200k tokens | < 1 s | < 1 s |

## Settings

### LogSlimmer pipeline (scoring/noise/truncation)
- Defaults live in `src/log-pipeline/pipeline-config.js`.
- You can override via env `LOGSLIMMER_CONFIG_JSON='{"latencyBuckets":[{"minMs":800,"weight":2}],"statusWeights":{"5xx":6}}'`.
- Or set `globalThis.LOGSLIMMER_CONFIG = { ... }` before running in-browser.
- Debug scoring reasons: `LOGSLIMMER_DEBUG_SCORE=true`.
- Dump defaults + resolved config: `npm run dump:config`.

Key fields:
- `latencyBuckets`: list of `{ minMs, weight, label }` applied cumulatively.
- `statusWeights`: per-series (`2xx`, `4xx`, `5xx`) and optional per-code (`404`).
- `messageWeights`: regex → weight; keep it short for performance.
- `noisePatterns`: regex list to discard early (health/heartbeat/etc.).
- `maxLineLength`: clamp long lines when rendering.
- `showOtherInSummary`: include/exclude category `Other` in summary.
- `scoreCutoffNonOther` / `scoreCutoffOther`: minimum score to keep events.
- `maxOtherClusters` / `maxClusters`: limits for rendered clusters.
- `miscUniqueLimit`: how many single-occurrence events to show in “Unique Events”.
- `keepFileLinePrefix`: keep `file.ts:37` or `GET /path 500` prefixes intact even when truncating payloads.
- `preserveTimestamps`: avoid normalizing timestamps away.
- `keepHumanNotes`: boost/keep free-text narrative lines.
- `stackFramePreviewHead` / `stackFramePreviewTail`: how many frames to show when collapsing stack traces.

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
