/**
 * audioEngine.ts — Phase 1 + 2: Real audio analysis pipeline
 *
 * Phase 2 upgrades:
 *   - HPS (Harmonic Product Spectrum) multi-pitch detection
 *   - Multi-note heatmap (chords visible)
 *   - Temporal smoothing to reduce noise
 *   - dB-scale spectrogram normalization
 */

import { fft, applyHannWindow, applyHammingWindow, applyBlackmanWindow, magnitudeSpectrum } from "./fft";
import { detectKey, midiToSolfeggioRow, NOTE_NAMES } from "./keyDetection";
import { findTopPitches, smoothHeatmap, freqToMidi } from "./pitchDetection";
import { AnalysisConfig, AnalysisResult, NoteDistribution, MoodDistribution } from "@/types";

// ── Constants ──────────────────────────────────────────────────
const TARGET_SLICES = 300;  // Heatmap time resolution
const SPEC_BANDS = 48;   // Spectrogram frequency bands
const HEATMAP_ROWS = 21;   // 3 octaves × 7 solfeggio degrees

// ── Helpers ────────────────────────────────────────────────────

function mixToMono(buffer: AudioBuffer): Float32Array {
  const ch = buffer.numberOfChannels;
  const len = buffer.length;
  const mono = new Float32Array(len);
  for (let c = 0; c < ch; c++) {
    const data = buffer.getChannelData(c);
    for (let i = 0; i < len; i++) mono[i] += data[i] / ch;
  }
  return mono;
}

function nextPow2(n: number): number {
  return Math.pow(2, Math.ceil(Math.log2(n)));
}

function applyWindow(samples: Float32Array, type: string): Float32Array {
  if (type === "hamming") return applyHammingWindow(samples);
  if (type === "blackman") return applyBlackmanWindow(samples);
  return applyHannWindow(samples); // default hann
}

function normalize2D(data: number[][]): number[][] {
  let max = 0;
  for (const row of data) for (const v of row) if (v > max) max = v;
  if (max === 0) return data;
  return data.map(row => row.map(v => v / max));
}

// ── Spectrogram bands (log-spaced Hz) ─────────────────────────
function computeLogBands(
  mag: Float32Array,
  sampleRate: number,
  fftSize: number,
  minFreq: number,
  maxFreq: number,
  numBands: number
): number[] {
  const logMin = Math.log10(Math.max(1, minFreq));
  const logMax = Math.log10(maxFreq);
  const bands = new Array(numBands).fill(0);

  for (let b = 0; b < numBands; b++) {
    const fLow = Math.pow(10, logMin + (b / numBands) * (logMax - logMin));
    const fHigh = Math.pow(10, logMin + ((b + 1) / numBands) * (logMax - logMin));
    const binLow = Math.max(0, Math.floor(fLow * fftSize / sampleRate));
    const binHigh = Math.min(mag.length - 1, Math.ceil(fHigh * fftSize / sampleRate));
    let sum = 0, count = 0;
    for (let i = binLow; i <= binHigh; i++) { sum += mag[i]; count++; }
    // Flip so index 0 = highest freq (top of visual)
    bands[numBands - 1 - b] = count > 0 ? sum / count : 0;
  }
  return bands;
}

// ── Chromagram update ──────────────────────────────────────────
function updateChromagram(
  mag: Float32Array,
  sampleRate: number,
  fftSize: number,
  chroma: Float32Array
) {
  for (let i = 1; i < mag.length; i++) {
    const freq = (i * sampleRate) / fftSize;
    if (freq < 65 || freq > 2093) continue;
    const midi = 69 + 12 * Math.log2(freq / 440);
    const noteClass = ((Math.round(midi) % 12) + 12) % 12;
    chroma[noteClass] += mag[i];
  }
}

// ── dB normalization for spectrogram ──────────────────────────
function normalizeDb(data: number[][]): number[][] {
  const MIN_DB = -60;
  let peakMag = 1e-10;
  for (const row of data) for (const v of row) if (v > peakMag) peakMag = v;
  return data.map(row =>
    row.map(v => {
      if (v <= 0) return 0;
      const db = 20 * Math.log10(v / peakMag);
      return Math.max(0, (db - MIN_DB) / (-MIN_DB));
    })
  );
}

// ── Solfeggiogram: energy-distribution heatmap ────────────────
// Accumulates ALL bin energies into their solfeggio row.
// Much more accurate than sparse HPS peak-picking.
function buildSolfeggiogramRow(
  mag: Float32Array,
  sampleRate: number,
  fftSize: number,
  keyInfo: ReturnType<typeof detectKey>,
  minFreq: number,
  maxFreq: number
): number[] {
  const rows = new Array(HEATMAP_ROWS).fill(0);
  const binMin = Math.max(1, Math.floor(minFreq * fftSize / sampleRate));
  const binMax = Math.min(mag.length - 1, Math.floor(maxFreq * fftSize / sampleRate));

  for (let bin = binMin; bin <= binMax; bin++) {
    const freq = (bin * sampleRate) / fftSize;
    const midi = Math.round(69 + 12 * Math.log2(freq / 440));
    const row = midiToSolfeggioRow(midi, keyInfo);
    if (row >= 0 && row < HEATMAP_ROWS) {
      rows[row] += mag[bin]; // accumulate energy in this solfeggio slot
    }
  }
  return rows;
}


// ── BPM detection (energy onset-based) ────────────────────────
function detectBPM(samples: Float32Array, sampleRate: number): number {
  const frameSize = 1024;
  const energies: number[] = [];
  for (let i = 0; i + frameSize < samples.length; i += frameSize) {
    let e = 0;
    for (let j = 0; j < frameSize; j++) e += samples[i + j] ** 2;
    energies.push(e / frameSize);
  }
  // Count onsets (energy spikes > 1.5× local average)
  let onsets = 0;
  const window = 20;
  for (let i = window; i < energies.length - window; i++) {
    const localAvg = energies.slice(i - window, i + window).reduce((a, b) => a + b, 0) / (window * 2);
    if (energies[i] > localAvg * 1.5 && energies[i] > energies[i - 1] && energies[i] > energies[i + 1]) {
      onsets++;
    }
  }
  const durationMin = samples.length / sampleRate / 60;
  const rawBPM = onsets / durationMin;
  // Clamp to musical range 40–200
  if (rawBPM < 40) return Math.round(rawBPM * 2);
  if (rawBPM > 200) return Math.round(rawBPM / 2);
  return Math.round(rawBPM);
}

// ── Note distribution from heatmap ────────────────────────────
const SOLFEGE_NAMES = ["1 (Do)", "2 (Re)", "3 (Mi)", "4 (Fa)", "5 (Sol)", "6 (La)", "7 (Si)"];

function buildNoteDistribution(
  heatmap: number[][],
  keyInfo: ReturnType<typeof detectKey>
): NoteDistribution[] {
  const sums = new Array(7).fill(0);
  let total = 0;
  for (const slice of heatmap) {
    for (let row = 0; row < slice.length; row++) {
      const degree = row % 7;
      sums[degree] += slice[row];
      total += slice[row];
    }
  }
  const intervals = keyInfo.mode === "Major"
    ? ["C", "D", "E", "F", "G", "A", "B"]
    : ["C", "D", "Eb", "F", "G", "Ab", "Bb"];
  const rootIdx = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"].indexOf(keyInfo.root);

  return SOLFEGE_NAMES.map((name, i) => {
    const pct = total > 0 ? (sums[i] / total) * 100 : 0;
    const absNote = NOTE_NAMES[(rootIdx + [0, 2, 4, 5, 7, 9, 11][i]) % 12];
    return {
      solfege: name,
      absolute: absNote,
      percentage: Math.round(pct * 10) / 10,
      count: Math.round(sums[i]),
    };
  }).sort((a, b) => b.percentage - a.percentage);
}

// ── Phase 4: Enhanced Mood Classification ─────────────────────
// Russell's Circumplex: Valence (−1 negative ↔ +1 positive) × Arousal (−1 low ↔ +1 high)

const MOOD_MATRIX: Array<[string, number, number]> = [
  // [mood,          valence, arousal]
  ["Energetic", 0.85, 0.90],
  ["Happy", 0.80, 0.30],
  ["Catchy", 0.70, 0.75],
  ["Calm", 0.65, -0.70],
  ["Romantic", 0.40, -0.50],
  ["Bittersweet", -0.10, -0.20],
  ["Nostalgic", -0.30, -0.40],
  ["Solemn", -0.45, -0.60],
  ["Melancholy", -0.60, -0.30],
  ["Sad", -0.80, -0.75],
  ["Tense", -0.50, 0.80],
  ["Dramatic", -0.30, 0.90],
  ["Epic", 0.30, 0.95],
];

const MOOD_COLORS: Record<string, string> = {
  Energetic: "var(--mood-energetic)",
  Happy: "var(--mood-happy)",
  Catchy: "var(--mood-catchy)",
  Calm: "var(--mood-calm)",
  Romantic: "var(--mood-romantic)",
  Bittersweet: "var(--mood-melancholy)",
  Nostalgic: "#7c6fd4",
  Solemn: "#4a5568",
  Melancholy: "var(--mood-melancholy)",
  Sad: "var(--mood-sad)",
  Tense: "var(--mood-tense)",
  Dramatic: "var(--mood-tense)",
  Epic: "#e67e22",
};

function classifyMood(
  keyInfo: ReturnType<typeof detectKey>,
  bpm: number,
  notes: NoteDistribution[],
  intervals: number[]
): { primary: string; confidence: number; distribution: MoodDistribution[]; valence: number; arousal: number } {

  // ── 1. Compute Valence (−1 to +1) ──
  let valence = keyInfo.mode === "Major" ? 0.60 : -0.60;

  const pct = (name: string) => notes.find(n => n.solfege === name)?.percentage ?? 0;
  const laP = pct("6 (La)");   // high La → more negative (minor 6th = sad)
  const doP = pct("1 (Do)");   // high Do → resolution, slightly positive
  const siP = pct("7 (Si)");   // high Si → tension, slightly negative
  const solP = pct("5 (Sol)");  // high Sol → stable, slightly positive

  valence += laP > 22 ? -0.20 : laP > 15 ? -0.10 : 0;
  valence += doP > 20 ? 0.12 : 0;
  valence += siP > 15 ? -0.10 : 0;
  valence += solP > 18 ? 0.08 : 0;
  // Key confidence boost
  valence *= 0.85 + (keyInfo.confidence / 100) * 0.15;
  valence = Math.max(-1, Math.min(1, valence));

  // ── 2. Compute Arousal (−1 to +1) ──
  let arousal = bpm > 140 ? 0.85
    : bpm > 110 ? 0.45
      : bpm > 85 ? 0.05
        : bpm > 65 ? -0.35
          : -0.70;

  // Interval volatility: high = dramatic leaps → higher arousal
  const avgInterval = intervals.length > 0
    ? intervals.reduce((a, b) => a + b, 0) / intervals.length : 2;
  const volatility = Math.min(1, avgInterval / 7); // 0-1
  arousal += (volatility - 0.3) * 0.30;             // shift by deviation from "normal"
  arousal = Math.max(-1, Math.min(1, arousal));

  // ── 3. Map (valence, arousal) → moods via distance ──
  const scored = MOOD_MATRIX.map(([name, mv, ma]) => {
    const dist = Math.sqrt((valence - mv) ** 2 + (arousal - ma) ** 2);
    // Gaussian-like falloff: closer = stronger
    const score = Math.exp(-dist * 1.8);
    return { mood: name, score };
  });

  const totalScore = scored.reduce((s, m) => s + m.score, 0);
  const distribution: MoodDistribution[] = scored
    .map(m => ({
      mood: m.mood,
      value: Math.round((m.score / (totalScore || 1)) * 100),
      color: MOOD_COLORS[m.mood] ?? "var(--accent-primary)",
    }))
    .sort((a, b) => b.value - a.value);

  return {
    primary: distribution[0].mood,
    confidence: distribution[0].value,
    distribution,
    valence: Math.round(valence * 100) / 100,
    arousal: Math.round(arousal * 100) / 100,
  };
}


// ── Explanation generator ──────────────────────────────────────
function generateExplanation(
  keyInfo: ReturnType<typeof detectKey>,
  bpm: number,
  mood: { primary: string },
  notes: NoteDistribution[]
): string {
  const top = notes[0];
  const tempoDesc = bpm > 120 ? "cepat" : bpm > 80 ? "sedang" : "lambat";
  const modeIndo = keyInfo.mode === "Major" ? "Mayor" : "Minor";
  
  return (
    `Lagu ini terdeteksi berada di nada dasar ${keyInfo.root} ${modeIndo} (kepercayaan ${keyInfo.confidence}%) ` +
    `dengan tempo ${tempoDesc} sebesar ${bpm} BPM. ` +
    `Nada solfeggio yang paling dominan adalah ${top?.solfege} (${top?.absolute}) ` +
    `dengan persentase ${top?.percentage}%. ` +
    `Kombinasi tonalitas ${modeIndo.toLowerCase()} dan tempo yang ${tempoDesc} ` +
    `menempatkan lagu ini dalam kategori emosional "${mood.primary}". ` +
    `Skala dasar: ${keyInfo.mode === "Major" ? "Mayor (1-2-3-4-5-6-7)" : "Minor Natural (1-2-♭3-4-5-♭6-♭7)"}.`
  );
}

// ── Interval calculation ───────────────────────────────────────
function computeIntervals(heatmap: number[][]): number[] {
  const peaks: number[] = heatmap.map(slice => {
    let maxIdx = 0;
    for (let i = 1; i < slice.length; i++) if (slice[i] > slice[maxIdx]) maxIdx = i;
    return maxIdx % 7;
  });
  const intervals: number[] = [];
  for (let i = 1; i < peaks.length && intervals.length < 20; i++) {
    const diff = Math.abs(peaks[i] - peaks[i - 1]);
    if (diff > 0) intervals.push(diff);
  }
  return intervals;
}

// ── Main Engine ────────────────────────────────────────────────
export async function analyzeAudio(
  file: File,
  config: AnalysisConfig,
  onProgress: (p: number) => void
): Promise<AnalysisResult> {
  const t0 = performance.now();

  // 1. Decode audio
  onProgress(5);
  const arrayBuffer = await file.arrayBuffer();
  const audioCtx = new AudioContext();
  const buffer = await audioCtx.decodeAudioData(arrayBuffer);
  audioCtx.close();
  onProgress(12);

  // 1.5 Fetch synced lyrics from LRCLIB (cached in Upstash Redis)
  // Flow: Browser sends filename → API searches LRCLIB → if miss, fetches → saves to Redis
  const songId = file.name.replace(/\.[^/.]+$/, ""); // filename without extension as query

  // Kick off the API call NOW (non-blocking) so it runs while FFT analysis proceeds
  const sttPromise: Promise<any[]> = (async () => {
    try {
      const formData = new FormData();
      formData.append('songId', songId); // Only need the name, not the whole audio file!

      // 10 second timeout is enough for a simple API call
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10_000);

      const response = await fetch('/api/transcribe', {
        method: 'POST',
        body: formData,
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        console.error("Transcribe API error:", errData);
        return [];
      }

      const data = await response.json();
      if (data.cached) {
        console.log("✅ [LRCLIB/Redis] Lirik diambil dari cache Upstash Redis!");
      } else {
        console.log(`✅ [LRCLIB/Redis] Lirik selesai diunduh — ${data.result?.chunks?.length ?? 0} baris disimpan ke Redis.`);
      }
      return data.result?.chunks || [];
    } catch (err: any) {
      if (err?.name === 'AbortError') {
        console.warn("API timeout (10s). Lirik tidak tersedia untuk lagu ini.");
      } else {
        console.error("Failed API:", err);
      }
      return [];
    }
  })();

  const sampleRate = buffer.sampleRate;
  const samples = mixToMono(buffer);
  const totalSamples = samples.length;
  const fftSize = config.fftSize;
  const hopSize = Math.max(fftSize, Math.floor((totalSamples - fftSize) / TARGET_SLICES));

  const chroma = new Float32Array(12);
  const spectrogramRaw: number[][] = [];
  const vocalPresenceRaw: number[] = []; // for lyrics/vocal detector

  // Store compact magnitude spectrum (musical range only) per frame for solfeggiogram
  const compactSpectra: Float32Array[] = [];
  const musicalBinMin = Math.max(1, Math.floor(config.minFreq * fftSize / buffer.sampleRate));
  const musicalBinMax = Math.min(Math.floor(fftSize / 2) - 1, Math.floor(config.maxFreq * fftSize / buffer.sampleRate));

  let frame = 0;
  let pos = 0;

  // 2. FFT loop
  while (pos + fftSize <= totalSamples && frame < TARGET_SLICES) {
    if (frame % 15 === 0) {
      await new Promise<void>(r => setTimeout(r, 0));
      onProgress(12 + (frame / TARGET_SLICES) * 55);
    }

    const slice = new Float32Array(fftSize);
    for (let i = 0; i < fftSize; i++) slice[i] = samples[pos + i];
    const windowed = applyWindow(slice, config.windowType);

    const real = Array.from(windowed);
    const imag = new Array(fftSize).fill(0);
    fft(real, imag);
    const mag = magnitudeSpectrum(real, imag);

    // Spectrogram bands (log-spaced)
    spectrogramRaw.push(computeLogBands(mag, sampleRate, fftSize, config.minFreq, config.maxFreq, SPEC_BANDS));

    // Chromagram
    updateChromagram(mag, sampleRate, fftSize, chroma);

    // Vocal/Lyrics Presence (300Hz - 3000Hz energy ratio)
    let totalE = 0, vocalE = 0;
    const bin300 = Math.floor(300 * fftSize / sampleRate);
    const bin3000 = Math.floor(3000 * fftSize / sampleRate);
    for (let i = 0; i < mag.length; i++) {
      totalE += mag[i];
      if (i >= bin300 && i <= bin3000) vocalE += mag[i];
    }
    vocalPresenceRaw.push(totalE > 0 ? vocalE / totalE : 0);

    // Store compact musical-range spectrum for solfeggiogram rebuild
    compactSpectra.push(mag.slice(musicalBinMin, musicalBinMax + 1));

    pos += hopSize;
    frame++;
  }
  onProgress(68);

  // 3. Key detection
  const chromaArr = Array.from(chroma);
  const maxC = Math.max(...chromaArr);
  const normalizedChroma = maxC > 0 ? chromaArr.map(v => v / maxC) : chromaArr;
  const keyInfo = detectKey(normalizedChroma);
  onProgress(72);

  // 4. Solfeggiogram — energy-accumulation heatmap (accurate, continuous)
  // Rebuild compact spectra into solfeggio rows using detected key
  const heatmapRaw2: number[][] = compactSpectra.map(compact => {
    // Reconstruct full-length Float32Array with musical bins only
    const fullMag = new Float32Array(fftSize / 2);
    for (let i = 0; i < compact.length; i++) fullMag[musicalBinMin + i] = compact[i];
    return buildSolfeggiogramRow(fullMag, sampleRate, fftSize, keyInfo, config.minFreq, config.maxFreq);
  });

  // Per-row normalize so dominant rows don't drown out others
  const rowMaxes = new Array(HEATMAP_ROWS).fill(0);
  for (const frame of heatmapRaw2) for (let r = 0; r < HEATMAP_ROWS; r++) if (frame[r] > rowMaxes[r]) rowMaxes[r] = frame[r];
  const heatmapNorm = heatmapRaw2.map(frame =>
    frame.map((v, r) => rowMaxes[r] > 0 ? v / rowMaxes[r] : 0)
  );

  // Temporal smoothing
  const heatmapSmoothed = smoothHeatmap(heatmapNorm, 2);
  onProgress(78);

  // 5. BPM
  const bpm = detectBPM(samples, sampleRate);
  onProgress(84);

  // 6. Note distribution
  const dominantNotes = buildNoteDistribution(heatmapSmoothed, keyInfo);
  onProgress(90);

  // 7. Intervals & Mood (Phase 4: intervals passed to mood classifier)
  const intervals = computeIntervals(heatmapSmoothed);
  const mood = classifyMood(keyInfo, bpm, dominantNotes, intervals);
  onProgress(95);

  // 8. Normalize
  const spectrogramData = normalizeDb(spectrogramRaw);
  const heatmapData = heatmapSmoothed;

  // 9. Tension peaks — based on musical parts (broadband acoustic energy / loudness)
  // Instead of just pitch density, we use the total energy of the spectrogram (including bass/drums)
  const rawEnergies = spectrogramRaw.map(row => row.reduce((a, b) => a + b, 0));

  // Smooth the energy over a window (e.g. 5 frames) to find sustained intense sections (like a chorus), not just brief drum hits
  const windowSize = 5;
  const smoothedEnergies = rawEnergies.map((_, i, arr) => {
    let sum = 0, count = 0;
    for (let j = Math.max(0, i - windowSize); j <= Math.min(arr.length - 1, i + windowSize); j++) {
      sum += arr[j]; count++;
    }
    return sum / count;
  });

  const avgE = smoothedEnergies.reduce((a, b) => a + b, 0) / (smoothedEnergies.length || 1);
  const stdE = Math.sqrt(smoothedEnergies.map(e => (e - avgE) ** 2).reduce((a, b) => a + b, 0) / (smoothedEnergies.length || 1));
  const threshold = avgE + stdE * 0.8;

  // Find local maxima that exceed threshold
  const candidates: { sec: number, e: number }[] = [];
  for (let i = 1; i < smoothedEnergies.length - 1; i++) {
    if (smoothedEnergies[i] > threshold && smoothedEnergies[i] > smoothedEnergies[i - 1] && smoothedEnergies[i] > smoothedEnergies[i + 1]) {
      candidates.push({ sec: (i / TARGET_SLICES) * buffer.duration, e: smoothedEnergies[i] });
    }
  }

  // Sort by energy and pick top 4, ensuring they are at least 5 seconds apart
  candidates.sort((a, b) => b.e - a.e);
  const tensionPeaks: number[] = [];
  for (const c of candidates) {
    if (tensionPeaks.length >= 4) break;
    if (!tensionPeaks.some(p => Math.abs(p - c.sec) < 5)) {
      tensionPeaks.push(Math.round(c.sec));
    }
  }
  tensionPeaks.sort((a, b) => a - b);

  // 10. Smooth vocal presence for visual stability
  const vocalPresence = vocalPresenceRaw.map((_, i, arr) => {
    let sum = 0, count = 0;
    for (let j = Math.max(0, i - 2); j <= Math.min(arr.length - 1, i + 2); j++) {
      sum += arr[j]; count++;
    }
    // Normalize to 0-1 based on expected vocal ratios
    return Math.max(0, Math.min(1, ((sum / count) - 0.2) * 2));
  });

  // Await STT (LRCLIB)
  onProgress(95);
  let lyricsData: { text: string; timestamp: [number, number] }[] = [];
  try {
    lyricsData = await sttPromise;
    console.log(`🎵 Lirik diterima: ${lyricsData.length} segmen`);
  } catch (e) {
    console.error("STT await error:", e);
  }

  // Generate Dynamic Narrative using LLM (Groq)
  let explanation = generateExplanation(keyInfo, bpm, mood, dominantNotes); // Fallback string
  try {
    const plainLyrics = lyricsData.map(l => l.text).join('\n');
    
    // 15 second timeout for narrative generation
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);

    const narrativeRes = await fetch('/api/narrative', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        key: keyInfo.root,
        mode: keyInfo.mode,
        bpm,
        mood: mood.primary,
        topSolfegge: dominantNotes[0]?.solfege || 'Unknown',
        lyrics: plainLyrics,
      })
    });

    if (narrativeRes.ok) {
      const narrativeData = await narrativeRes.json();
      if (narrativeData.narrative) {
        explanation = narrativeData.narrative;
      } else if (narrativeData.fallback) {
        explanation = narrativeData.fallback;
      }
    }
  } catch (err) {
    console.error("Failed to generate narrative:", err);
  }

  onProgress(100);

  return {
    key: keyInfo,
    bpm,
    timeSignature: "4/4",
    totalNotes: dominantNotes.reduce((s, n) => s + n.count, 0),
    dominantNotes,
    mood,
    chromagram: normalizedChroma.map((v, i) => ({ note: NOTE_NAMES[i], value: v })),
    explanation,
    intervals,
    heatmapData,
    spectrogramData,
    vocalPresence,
    lyrics: lyricsData,
    processingTime: Math.round(performance.now() - t0),
    duration: buffer.duration,
    tensionPeaks,
  };
}
