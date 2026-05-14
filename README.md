<div align="center">

# Solfeggio Analyzer

**A genre-aware, AI-driven music analysis engine built on the Web.**

Analyzes any audio file using client-side DSP, Groq LLM semantic intelligence, and hybrid lyric fingerprinting — all without uploading your music to a cloud server.

[![Next.js](https://img.shields.io/badge/Next.js-16.x-black?logo=nextdotjs&logoColor=white)](https://nextjs.org)
[![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)](https://reactjs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Groq](https://img.shields.io/badge/AI-Groq%20%2F%20Llama%203-F55036?logo=meta&logoColor=white)](https://groq.com)
[![Redis](https://img.shields.io/badge/Cache-Upstash%20Redis-DC382D?logo=redis&logoColor=white)](https://upstash.com)

</div>

---

## Project Brief

Solfeggio Analyzer is an in-browser music analysis platform that goes far beyond simple BPM or key detection. The engine was designed with a single guiding philosophy: **audio and lyrics must be analyzed together**. A song with a major-key, fast-tempo arrangement can still be deeply melancholic — and the system is built to understand that.

The analysis pipeline combines:
- **Custom FFT-based Signal Processing** running entirely in the browser thread
- **A 17-Archetype Gated Mood Engine** that avoids bias through hard-gate conditions per mood
- **Groq LLM Semantic Analysis** that classifies lyric sentiment and re-weights the audio mood distribution
- **Hybrid Lyric Fingerprinting** using a Whisper-guided LRCLIB search strategy

> **No audio data is ever uploaded to a server.** All FFT, BPM, chord, and mood computations happen locally inside the Web Audio API.

---

## Feature Highlights

| Feature | Description |
| :--- | :--- |
| **Real-Time Spectrogram** | Log-spaced frequency visualization at 60FPS via Canvas API |
| **Key Detection** | Krumhansl-Schmuckler chroma profile matching for major/minor keys |
| **BPM Detection** | Autocorrelation + onset-based tempo extraction with octave correction |
| **Chord Detection** | Per-frame chromagram analysis with tension/valence scoring |
| **Solfeggio Heatmap** | Pitch energy density across 3 octaves × 7 solfeggio degrees |
| **Mood Classification** | 17-archetype gated scoring with lyric-audio fusion |
| **Synced Lyrics** | Hybrid search: Direct LRCLIB → Whisper-guided LRCLIB → Whisper fallback |
| **AI Narrative** | Groq Llama-3.3-70b generates a human-readable musical analysis |
| **Aggressive Caching** | Upstash Redis caches lyrics and narratives to avoid redundant API calls |
| **Tension Peaks** | Novelty-based structural analysis that detects the exact first beat of a drop/chorus |

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        Browser (Client)                      │
│                                                             │
│  Audio File → Web Audio API → FFT Engine (audioEngine.ts)   │
│                                     │                        │
│         ┌────────────┬──────────────┼───────────────┐        │
│         ▼            ▼              ▼               ▼        │
│     Spectrogram  Chromagram      Energy          ZCR/Flux    │
│         │            │              │               │        │
│         └────────────┴──────────────┴───────────────┘        │
│                              │                               │
│                    ┌─────────▼──────────┐                    │
│                    │  Mood Engine v4    │                    │
│                    │  (17 Archetypes)   │                    │
│                    └─────────┬──────────┘                    │
└──────────────────────────────┼──────────────────────────────┘
                               │  POST (metadata, no audio)
          ┌────────────────────▼───────────────────────┐
          │              Next.js Server                 │
          │                                            │
          │  /api/transcribe  →  LRCLIB / Whisper      │
          │  /api/narrative   →  Groq LLM (Llama 3)    │
          │                       ↕                    │
          │              Upstash Redis (Cache)          │
          └────────────────────────────────────────────┘
```

### Technology Stack

| Layer | Technology | Purpose |
| :--- | :--- | :--- |
| **Framework** | Next.js 16, React 19, TypeScript 5 | Application shell & server routes |
| **Signal Processing** | Web Audio API, Canvas API | Client-side FFT & 60FPS visualization |
| **AI / LLM** | Groq API (Llama-3.3-70b) | Lyric mood classification & narrative |
| **Speech-to-Text** | Groq Whisper (large-v3) | Audio fingerprint fallback for lyric search |
| **Lyric Source** | LRCLIB (free, open) | Synced `.lrc` timestamp retrieval |
| **Caching** | Upstash Redis (serverless) | Persistent API response caching |

---

## Getting Started

### Prerequisites

- Node.js >= 18
- A [Groq API Key](https://console.groq.com) (free tier available)
- An [Upstash Redis](https://upstash.com) database (free tier available)

### Installation

```bash
# 1. Clone the repository
git clone https://github.com/RafiMlnf/SolfeggioAnalyzer.git
cd SolfeggioAnalyzer

# 2. Install dependencies
npm install

# 3. Configure environment variables
cp .env.example .env.local
# Fill in GROQ_API_KEY, UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN

# 4. Start the development server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) to start analyzing.

### Environment Variables

```env
GROQ_API_KEY=your_groq_api_key
UPSTASH_REDIS_REST_URL=https://your-redis.upstash.io
UPSTASH_REDIS_REST_TOKEN=your_redis_token
```

---

## How the Mood Engine Works

The Mood Engine v4 is a **Gated Archetype Scoring System**. Unlike simple heuristics, each of the 17 mood archetypes has a hard-gate condition that **must be satisfied** before any score is awarded. This prevents false positives like "Happy" winning on a slow, dark-minor song just because the energy is slightly elevated.

```
  Audio Features
  ─────────────
  BPM, Chroma, SpectralFlux,
  Brightness, EnergyVariance  →  17 Archetype Scorers (gated)
  ZCR, OnsetDensity                │
                                   ▼
                          Raw Audio Distribution
                                   │
                        Groq LLM: Lyric Sentiment
                        (Happy / Sad / Romantic / Angry / Reflective)
                                   │
                                   ▼
                         Fusion (Multiplier Matrix)
                         Boosts aligned archetypes,
                         suppresses contradicting ones
                                   │
                                   ▼
                         Final Mood Distribution (%)
```

**Lyric fusion uses a multiplier matrix** — not a fixed percentage. For example, if the LLM classifies lyrics as "Sad", the `Sad` archetype score is boosted by ~1.6x while `Happy` is penalized to ~0.5x. Values are then re-normalized to 100%.

---

## Tension Peak Detection

Tension peaks are found using a **Novelty-Based Structural Analysis**, not simple loudness:

1. **Structural Context** — A 12-frame (~8s) moving average identifies high-intensity sections (chorus/drop zones).
2. **Novelty Signal** — Measures the *sudden jump* in energy compared to a few seconds prior. This targets the **first beat of a drop**, not the middle.
3. **Lyric Timestamps** — Frames where a new lyric line begins receive a 20% boost, anchoring peaks to vocal entry points.
4. **Minimum 15s separation** between peaks prevents clustering in a single section.

---

## Changelog

### [v0.4.0] — 2025-05-15 (Current)
- **NEW** Novelty-based tension peak detection targeting the exact first beat of drops
- **NEW** Lyric-aware tension peak support using LRC timestamps (20% weight)
- **NEW** Whisper-Guided Hybrid Lyric Search: `LRCLIB → Whisper transcribe → LRCLIB by lyrics → Whisper fallback`
- **IMPROVED** Fusion multiplier matrix halved to reduce lyric over-dominance
- **FIXED** Crash on empty `scored` array in `classifyMood` (guard moved before access)

### [v0.3.0] — 2025-05-14
- **NEW** 17-archetype gated mood engine replacing loose heuristics
- **NEW** Lyric-Audio Mood Fusion via Groq LLM semantic classification
- **NEW** Redesigned waveform visualization with dual-layer mirrored bars & HSL gradients
- **REMOVED** Chroma Radar visualization (inaccurate, replaced by archetype engine)
- **IMPROVED** Valence/Arousal mapped for all 17 archetypes

### [v0.2.0] — 2025-05-12
- **NEW** Chord detection with per-frame chromagram windowing
- **NEW** Spectral Flux & Onset Density for mood scoring
- **NEW** Solfeggio heatmap per-row normalization
- **IMPROVED** BPM detection with octave correction based on detected brightness

### [v0.1.0] — 2025-05-10 (Initial)
- Client-side FFT pipeline with Hann, Hamming & Blackman window options
- Spectrogram, Solfeggio Heatmap, BPM, Key detection
- LRCLIB synced lyric retrieval with Redis caching
- Groq Llama narrative generation

---

## License

This project is for educational and personal use. External services (Groq, LRCLIB, Upstash) are subject to their own respective terms of service.
