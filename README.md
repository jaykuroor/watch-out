# 👁️ Watch Out

**Real-time fact-checking for YouTube Shorts.**

Watch Out is a Chrome extension that automatically analyzes claims made in YouTube Shorts, verifies them against trusted web sources, and presents a verdict — right inside the YouTube interface. No extra tabs, no copy-pasting. One tap, full report.

## Why

Short-form video is the fastest-growing source of "facts" online, but there's no built-in way to know if what you just watched is real. Watch Out puts a fact-checking layer where misinformation actually spreads.

## Tech Stack

| Layer | Technology |
|---|---|
| Extension | Chrome Manifest V3, Vanilla JS |
| Backend | Next.js 16 (App Router), TypeScript |
| LLM | Google Gemini API (4 model options) |
| Web Search | Tavily Search API |
| Transcripts | yt-dlp |

## How It Works

```
┌─────────────────────────────────────────────────────────────────┐
│  YouTube Shorts Page                                            │
│                                                                 │
│   ┌──────────────┐     ┌──────────────────────────────────┐     │
│   │  URL / DOM   │───▶│  Content Script (content.js)     │     │
│   │  Detection   │     │  Detects active Short video ID   │     │
│   └──────────────┘     └───────────────┬──────────────────┘     │
│                                         │                       │
│                          chrome.runtime.sendMessage             │
│                                         │                       │
│   ┌─────────────────────────────────────▼──────────────────┐    │
│   │  Service Worker (background.js)                        │    │
│   │  Cache check ─▶ In-memory ─▶ chrome.storage.local     │    │
│   │  Deduplication · Progress messages · Request versioning│    │
│   └─────────────────────────┬──────────────────────────────┘    │
│                              │ fetch (on cache miss)            │
└──────────────────────────────┼──────────────────────────────────┘
                               │
                               ▼
┌──────────────────────────────────────────────────────────────────┐
│  Next.js Backend  (localhost:3000/api/analyze)                   │
│                                                                  │
│   ┌────────────┐   ┌────────────┐   ┌─────────┐   ┌──────────┐   │
│   │  yt-dlp    │─▶│  Gemini    │──▶│ Tavily  │──▶│  Gemini │   │
│   │  Transcript│   │  Extract   │   │ Search  │   │  Verify  │   │
│   │  + Metadata│   │  Claims    │   │ Evidence│   │  Claims  │   │
│   └────────────┘   └────────────┘   └─────────┘   └────┬─────┘   │
│                                                         │       │
│                                              Score + Verdicts   │
└─────────────────────────────────────────────────┬───────────────┘
                                                  │
                                                  ▼
┌──────────────────────────────────────────────────────────────────┐
│  Sidebar UI (sidebar.js)                                         │
│                                                                  │
│   ┌──────────────┐  ┌──────────────┐  ┌───────────────────────┐  │
│   │ Accuracy Ring│  │ Claim Cards  │  │ Sources & Citations   │  │
│   │ (animated %) │  │ (expandable) │  │ (linked to evidence)  │  │
│   └──────────────┘  └──────────────┘  └───────────────────────┘  │
└──────────────────────────────────────────────────────────────────┘
```

## Key Features

- **Automatic detection** — picks up the video ID via URL parsing, DOM observers, and polling
- **3-tier caching** — in-memory, persistent storage, and server-side for instant repeat views
- **Prefetching** — pre-analyzes the next 6 Shorts while you watch so results are ready on swipe
- **Source citations** — every verdict links back to the evidence it was based on
- **Model benchmarking** — built-in harness to compare Gemini models on latency, cost, and quality
- **Light/dark theme** — auto-syncs with YouTube's active theme

## Setup

### Backend

```bash
cd backend
cp .env.local.example .env.local   # add your API keys
npm install
npm run dev                         # runs on localhost:3000
```

Requires [yt-dlp](https://github.com/yt-dlp/yt-dlp#installation) on PATH.

**Environment variables:**

| Key | Source |
|---|---|
| `GOOGLE_AI_API_KEY` | [Google AI Studio](https://aistudio.google.com/apikey) |
| `TAVILY_API_KEY` | [Tavily](https://tavily.com) |

### Extension

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked** → select the `extension/` folder
4. Navigate to any YouTube Short

## Project Structure

```
├── extension/
│   ├── manifest.json       # Chrome MV3 manifest
│   ├── content.js          # Video detection, prefetch, sidebar orchestration
│   ├── sidebar.js          # Vanilla JS sidebar UI (no framework)
│   └── background.js       # Service worker: caching, API bridge
│
├── backend/
│   ├── app/api/analyze/    # POST endpoint — orchestrates the pipeline
│   ├── app/lib/
│   │   ├── youtube.ts      # yt-dlp transcript + metadata extraction
│   │   ├── llm.ts          # Gemini: claim extraction + verification
│   │   ├── search.ts       # Tavily web search
│   │   └── scoring.ts      # Weighted confidence scoring
│   └── scripts/
│       └── benchmark-models.ts  # Model comparison harness
│
└── mock/                   # Sample responses for development
```

## Team
- Pranav Karthik
- Arista Ranka
- Jay Kuroor
