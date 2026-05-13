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


// ── Audio pre-pass: detect frequency range + brightness ─────────────
// Quick sub-sampled scan (every 8th frame) to measure spectral energy.
// Results: adaptive minFreq/maxFreq + brightness hint for BPM correction.
interface AudioProfile {
  minFreq: number;
  maxFreq: number;
  brightness: number; // 0=dark/bass-heavy, 1=bright/treble-heavy
}
function detectAudioProfile(samples: Float32Array, sampleRate: number): AudioProfile {
  const frameSize = 1024;
  const stride = 8;
  const bins = frameSize / 2;
  const binToHz = (b: number) => (b * sampleRate) / frameSize;
  const meanMag = new Float32Array(bins);
  let frameCount = 0;
  for (let offset = 0; offset + frameSize < samples.length; offset += frameSize * stride) {
    const real: number[] = [];
    const imag: number[] = new Array(frameSize).fill(0);
    for (let j = 0; j < frameSize; j++) {
      const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * j) / (frameSize - 1));
      real.push((samples[offset + j] ?? 0) * w);
    }
    fft(real, imag);
    const mag = magnitudeSpectrum(real, imag);
    for (let b = 0; b < bins; b++) meanMag[b] += mag[b];
    frameCount++;
  }
  if (frameCount === 0) return { minFreq: 65, maxFreq: 2093, brightness: 0.5 };
  for (let b = 0; b < bins; b++) meanMag[b] /= frameCount;

  // Cumulative energy → P5 = minFreq, P90 = maxFreq
  let totalE = 0;
  for (let b = 1; b < bins; b++) totalE += meanMag[b];
  if (totalE === 0) return { minFreq: 65, maxFreq: 2093, brightness: 0.5 };
  let cumE = 0, freqP5 = 30, freqP90 = 4000;
  for (let b = 1; b < bins; b++) {
    cumE += meanMag[b];
    const pct = cumE / totalE;
    if (pct <= 0.05) freqP5 = binToHz(b);
    if (pct <= 0.90) freqP90 = binToHz(b);
  }

  // Spectral centroid → brightness 0-1
  let wSum = 0, mSum = 0;
  for (let b = 1; b < bins; b++) { wSum += binToHz(b) * meanMag[b]; mSum += meanMag[b]; }
  const centroid = mSum > 0 ? wSum / mSum : 1000;
  const brightness = Math.max(0, Math.min(1, (centroid - 300) / 3200));

  const minFreq = Math.max(30, Math.min(freqP5, 130));
  const maxFreq = Math.max(500, Math.min(freqP90 * 1.2, 12000));
  console.log(`[AutoFreq] min=${minFreq.toFixed(0)}Hz  max=${maxFreq.toFixed(0)}Hz  brightness=${brightness.toFixed(2)}`);
  return { minFreq, maxFreq, brightness };
}

// ── BPM detection (autocorrelation + spectral flux) ─────────────
// brightness hint: 0=dark/slow, 1=bright/fast — shifts preferred BPM range
function detectBPM(samples: Float32Array, sampleRate: number, brightness = 0.5): number {

  const frameSize = 1024;
  const hopSize = 512;
  // Analyze up to 30 seconds for performance (enough to find tempo)
  const analysisLen = Math.min(samples.length, sampleRate * 30);
  const numFrames = Math.floor((analysisLen - frameSize) / hopSize);

  if (numFrames < 20) return 120; // too short to detect

  // ── 1. Compute spectral flux onset strength (percussive band 0–4kHz) ──
  const maxBin = Math.min(Math.floor(4000 * frameSize / sampleRate), frameSize / 2);
  let prevMag: Float32Array | null = null;
  const onset: number[] = [];

  for (let i = 0; i < numFrames; i++) {
    // Windowed frame
    const frame = new Float32Array(frameSize);
    const offset = i * hopSize;
    for (let j = 0; j < frameSize; j++) {
      const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * j) / (frameSize - 1)); // Hann
      frame[j] = samples[offset + j] * w;
    }

    const real = Array.from(frame);
    const imag = new Array(frameSize).fill(0);
    fft(real, imag);
    const mag = magnitudeSpectrum(real, imag);

    if (prevMag) {
      // Half-wave rectified spectral flux (only positive differences = new energy)
      let flux = 0;
      for (let j = 0; j < maxBin; j++) {
        const diff = mag[j] - prevMag[j];
        if (diff > 0) flux += diff;
      }
      onset.push(flux);
    } else {
      onset.push(0);
    }
    prevMag = mag;
  }

  // ── 2. Normalize onset signal ──
  const maxO = Math.max(...onset, 1e-10);
  for (let i = 0; i < onset.length; i++) onset[i] /= maxO;

  // ── 3. Autocorrelation in BPM range 50–200 ──
  const fps = sampleRate / hopSize; // frames per second
  const minLag = Math.floor((fps * 60) / 200);
  const maxLag = Math.min(Math.ceil((fps * 60) / 50), Math.floor(onset.length / 2));

  const acf: { bpm: number; r: number }[] = [];
  for (let lag = minLag; lag <= maxLag; lag++) {
    let sum = 0;
    const n = onset.length - lag;
    for (let i = 0; i < n; i++) sum += onset[i] * onset[i + lag];
    acf.push({ bpm: (fps * 60) / lag, r: sum / n });
  }

  // ── 4. Find local maxima (peaks) in the autocorrelation ──
  const peaks: typeof acf = [];
  for (let i = 1; i < acf.length - 1; i++) {
    if (acf[i].r > acf[i - 1].r && acf[i].r > acf[i + 1].r) {
      peaks.push(acf[i]);
    }
  }
  if (peaks.length === 0) return 120;
  peaks.sort((a, b) => b.r - a.r);

  // ── 5. Adaptive octave correction based on spectral brightness ──
  // Dark/calm songs (bass-heavy):  prefer  55-120 BPM
  // Neutral songs:                 prefer  65-145 BPM
  // Bright/energetic songs:        prefer  80-175 BPM
  let prefLo: number, prefHi: number;
  if (brightness > 0.55) {        // bright = fast/energetic (EDM, metal, fast pop)
    prefLo = 80; prefHi = 175;
  } else if (brightness < 0.35) { // dark = slow/calm (ballad, ambient, slow jazz)
    prefLo = 55; prefHi = 120;
  } else {                        // neutral
    prefLo = 65; prefHi = 150;
  }

  let best = peaks[0];
  const inPreferred = (bpm: number) => bpm >= prefLo && bpm <= prefHi;
  const findNear = (target: number) => peaks.find(p => Math.abs(p.bpm - target) < 8);

  if (!inPreferred(best.bpm)) {
    if (best.bpm > prefHi) {
      // Too fast — try halving, but only if the halved value enters preferred range
      const half = findNear(best.bpm / 2);
      if (half && half.r > best.r * 0.35) {
        best = half;
      } else if (inPreferred(best.bpm / 2)) {
        best = { bpm: best.bpm / 2, r: best.r };
      }
    } else if (best.bpm < prefLo) {
      // Too slow — try doubling
      const dbl = findNear(best.bpm * 2);
      if (dbl && dbl.r > best.r * 0.35) {
        best = dbl;
      } else if (inPreferred(best.bpm * 2)) {
        best = { bpm: best.bpm * 2, r: best.r };
      }
    }
  }

  console.log(`[BPM] brightness=${brightness.toFixed(2)} → prefRange=${prefLo}-${prefHi} → ${Math.round(best.bpm)} BPM`);
  return Math.round(Math.max(40, Math.min(220, best.bpm)));
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

// ── Phase 4: Enhanced Mood Classification (v2) ───────────────
// Russell's Circumplex: Valence (−1 negative ↔ +1 positive) × Arousal (−1 low ↔ +1 high)
// v2: Multi-feature approach using spectral analysis for much better accuracy

interface SpectralFeatures {
  brightness: number;          // 0-1 — spectral centroid position (high=bright)
  energyVariance: number;      // 0-1 — dynamic range of frame energies
  noteDensity: number;         // 0-1 — fraction of frames with significant activity
  harmonicComplexity: number;  // 0-1 — chromagram entropy (high=complex harmony)
}

const MOOD_MATRIX: Array<[string, number, number]> = [
  // [mood,          valence, arousal]
  ["Energetic",    0.80,   0.90],
  ["Happy",        0.75,   0.40],
  ["Catchy",       0.60,   0.65],
  ["Calm",         0.55,  -0.65],
  ["Romantic",     0.35,  -0.40],
  ["Bittersweet", -0.05,  -0.15],
  ["Nostalgic",   -0.25,  -0.35],
  ["Solemn",      -0.40,  -0.55],
  ["Melancholy",  -0.55,  -0.25],
  ["Sad",         -0.75,  -0.70],
  ["Tense",       -0.45,   0.75],
  ["Dramatic",    -0.25,   0.85],
  ["Epic",         0.30,   0.95],
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
  intervals: number[],
  sf: SpectralFeatures
): { primary: string; confidence: number; distribution: MoodDistribution[]; valence: number; arousal: number } {

  // ── Helper: get solfege percentage by name ──
  const pct = (name: string) => notes.find(n => n.solfege === name)?.percentage ?? 0;

  // ── 1. Compute Valence (−1 to +1): multi-factor weighted sum ──
  // Factor weights: mode(0.30) + brightness(0.15) + harmComplexity(0.15) + chromaConcentration(0.15) + noteInfluence(0.15) + confidence(0.10)

  // a) Mode contribution: Major = positive, Minor = negative, but not overwhelming
  const modeVal = keyInfo.mode === "Major" ? 0.35 : -0.35;

  // b) Spectral brightness: bright timbre → slightly more positive
  const brightnessVal = (sf.brightness - 0.5) * 0.5; // range -0.25..+0.25

  // c) Harmonic complexity: high complexity → more negative (tense/ambiguous)
  const complexityVal = -(sf.harmonicComplexity - 0.4) * 0.5; // simpler = positive

  // d) Chroma concentration: how focused energy is on few notes
  //    High concentration = tonal/resolved = positive; spread = ambiguous = negative
  const topThreeNotePct = notes.slice(0, 3).reduce((s, n) => s + n.percentage, 0);
  const chromaConcentration = Math.min(1, topThreeNotePct / 60); // 60% in top3 = fully concentrated
  const concentrationVal = (chromaConcentration - 0.5) * 0.4;

  // e) Note-specific influence
  const doP = pct("1 (Do)");   // root → resolution, positive
  const solP = pct("5 (Sol)"); // perfect fifth → stable, positive
  const laP = pct("6 (La)");   // minor 6th → sadder
  const siP = pct("7 (Si)");   // leading tone → tension
  const miP = pct("3 (Mi)");   // major 3rd prominence in major = happier
  let noteVal = 0;
  noteVal += doP > 18 ? 0.10 : doP > 12 ? 0.05 : 0;
  noteVal += solP > 16 ? 0.08 : 0;
  noteVal += miP > 14 ? 0.06 : 0;
  noteVal -= laP > 20 ? 0.12 : laP > 14 ? 0.06 : 0;
  noteVal -= siP > 15 ? 0.08 : siP > 10 ? 0.04 : 0;

  // f) Key confidence: stronger detection = stronger valence signal
  const confScale = 0.75 + (keyInfo.confidence / 100) * 0.25;

  let valence = (modeVal + brightnessVal + complexityVal + concentrationVal + noteVal) * confScale;
  valence = Math.max(-1, Math.min(1, valence));

  // ── 2. Compute Arousal (−1 to +1): continuous multi-factor ──

  // a) BPM: continuous sigmoid-like mapping centered at 105 BPM
  const bpmNorm = (bpm - 105) / 55; // ~50 BPM → -1, ~160 BPM → +1
  const bpmArousal = Math.tanh(bpmNorm * 1.2); // smooth -1..+1

  // b) Spectral brightness: bright = high arousal
  const brightnessArousal = (sf.brightness - 0.45) * 0.6;

  // c) Energy variance: high dynamic range = more arousing
  const energyArousal = (sf.energyVariance - 0.3) * 0.5;

  // d) Note density: busy = higher arousal
  const densityArousal = (sf.noteDensity - 0.5) * 0.4;

  // e) Interval volatility: large leaps = dramatic = higher arousal
  const avgInterval = intervals.length > 0
    ? intervals.reduce((a, b) => a + b, 0) / intervals.length : 2;
  const volatility = Math.min(1, avgInterval / 6);
  const intervalArousal = (volatility - 0.35) * 0.35;

  let arousal = bpmArousal * 0.35 + brightnessArousal + energyArousal + densityArousal + intervalArousal;
  arousal = Math.max(-1, Math.min(1, arousal));

  // ── 3. Map (valence, arousal) → moods via softened Gaussian distance ──
  const SIGMA = 1.4; // softer falloff so secondary moods are more visible
  const scored = MOOD_MATRIX.map(([name, mv, ma]) => {
    const dist = Math.sqrt((valence - mv) ** 2 + (arousal - ma) ** 2);
    const score = Math.exp(-dist * SIGMA);
    return { mood: name, score };
  });

  // Apply a minimum floor so no mood is 0%
  const FLOOR = 0.02; // 2% minimum
  const totalRaw = scored.reduce((s, m) => s + m.score, 0);
  const withFloor = scored.map(m => ({
    ...m,
    score: Math.max(FLOOR, m.score / (totalRaw || 1)),
  }));

  const totalScore = withFloor.reduce((s, m) => s + m.score, 0);
  const distribution: MoodDistribution[] = withFloor
    .map(m => ({
      mood: m.mood,
      value: Math.round((m.score / (totalScore || 1)) * 100),
      color: MOOD_COLORS[m.mood] ?? "var(--accent-primary)",
    }))
    .sort((a, b) => b.value - a.value);

  // Ensure values sum to 100
  const sum = distribution.reduce((s, d) => s + d.value, 0);
  if (sum !== 100 && distribution.length > 0) {
    distribution[0].value += 100 - sum;
  }

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

// ── WAV encoder (browser-side, for Groq Whisper upload) ────────────
function encodeWAV(samples: Float32Array, sampleRate: number): Blob {
  const n = samples.length;
  const buf = new ArrayBuffer(44 + n * 2);
  const v = new DataView(buf);
  const ws = (off: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i)); };
  ws(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true);
  ws(8, 'WAVE'); ws(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true);  // mono
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 2, true);
  v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  ws(36, 'data'); v.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) {
    v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, samples[i])) * 0x7FFF, true);
  }
  return new Blob([buf], { type: 'audio/wav' });
}

// ── Vocal bandpass filter + export as 16kHz WAV ─────────────────
// Removes bass (<280Hz) and high-freq (>3500Hz) to isolate vocals before
// sending to Groq Whisper. Downsamples to 16kHz to minimize upload size.
async function extractVocalAudio(srcBuffer: AudioBuffer): Promise<Blob> {
  const SR = 16_000; // 16kHz — optimal for Whisper, ~2MB per minute
  // Cap at 240s (4 min) to stay well under Groq's 25MB limit
  const dur = Math.min(srcBuffer.duration, 240);
  const outSamples = Math.floor(dur * SR);

  const offCtx = new OfflineAudioContext(1, outSamples, SR);

  const src = offCtx.createBufferSource();
  src.buffer = srcBuffer;

  // Highpass: cut bass & kick drum rumble below 280Hz
  const hp = offCtx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 280;
  hp.Q.value = 0.7;

  // Lowpass: cut hi-hats, cymbals, distortion above 3500Hz
  const lp = offCtx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 3500;
  lp.Q.value = 0.7;

  // Presence boost around 2kHz (improves Whisper speech clarity)
  const peak = offCtx.createBiquadFilter();
  peak.type = 'peaking';
  peak.frequency.value = 2000;
  peak.Q.value = 1.5;
  peak.gain.value = 4; // +4dB

  src.connect(hp);
  hp.connect(lp);
  lp.connect(peak);
  peak.connect(offCtx.destination);
  src.start(0);

  const rendered = await offCtx.startRendering();
  return encodeWAV(rendered.getChannelData(0), SR);
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

  // 1.5 Fetch synced lyrics — LRCLIB first, Groq Whisper as fallback
  // Stage 1 runs NON-BLOCKING in parallel with FFT analysis.
  // Stage 2 (Groq Whisper) is triggered only if LRCLIB returns 0 synced lines.
  const songId = file.name.replace(/\.[^/.]+$/, '');

  const sttPromise: Promise<any[]> = (async () => {
    // ── Stage 1: LRCLIB (fast, ~500ms) ──
    try {
      const fd1 = new FormData();
      fd1.append('songId', songId);
      fd1.append('force', 'true'); // Force fresh fetch on re-analyze
      const ctrl1 = new AbortController();
      const t1 = setTimeout(() => ctrl1.abort(), 12_000);
      const res1 = await fetch('/api/transcribe', { method: 'POST', body: fd1, signal: ctrl1.signal });
      clearTimeout(t1);

      if (res1.ok) {
        const data1 = await res1.json();
        const chunks1: any[] = data1.result?.chunks ?? [];
        if (chunks1.length > 0) {
          console.log(`✅ [LRCLIB${data1.cached ? '/Cache' : ''}] ${chunks1.length} synced lines.`);
          return chunks1;
        }
        console.log('📻 [LRCLIB] Tidak ada synced lyrics — mencoba Groq Whisper...');
      }
    } catch (e: any) {
      if (e?.name !== 'AbortError') console.error('[LRCLIB] Error:', e);
      else console.warn('[LRCLIB] Timeout 12s.');
    }

    // ── Stage 2: Groq Whisper fallback (vocal-filtered audio) ──
    try {
      console.log('🎙 [Whisper] Menerapkan vocal filter & mengekstrak audio...');
      const vocalBlob = await extractVocalAudio(buffer);
      console.log(`🎙 [Whisper] Audio siap: ${(vocalBlob.size / 1024).toFixed(0)}KB — mengunggah ke Groq...`);

      const fd2 = new FormData();
      fd2.append('songId', songId);
      fd2.append('audio', vocalBlob, 'vocal.wav');
      fd2.append('force', 'true'); // Force fresh whisper on re-analyze

      const ctrl2 = new AbortController();
      const t2 = setTimeout(() => ctrl2.abort(), 90_000); // Groq is fast but allow for upload time
      const res2 = await fetch('/api/transcribe', { method: 'POST', body: fd2, signal: ctrl2.signal });
      clearTimeout(t2);

      if (!res2.ok) {
        console.warn('[Whisper] API gagal:', res2.status);
        return [];
      }
      const data2 = await res2.json();
      const chunks2: any[] = data2.result?.chunks ?? [];
      console.log(`✅ [Whisper${data2.cached ? '/Cache' : ''}] ${chunks2.length} segmen dari Groq Whisper.`);
      return chunks2;
    } catch (e: any) {
      if (e?.name === 'AbortError') console.warn('[Whisper] Timeout 90s.');
      else console.error('[Whisper] Error:', e);
      return [];
    }
  })();

  const sampleRate = buffer.sampleRate;
  const samples = mixToMono(buffer);
  const totalSamples = samples.length;
  const fftSize = config.fftSize;
  const hopSize = Math.max(fftSize, Math.floor((totalSamples - fftSize) / TARGET_SLICES));

  // 1.8 Auto-detect frequency range + brightness for adaptive analysis
  onProgress(14);
  const audioProfile = detectAudioProfile(samples, sampleRate);
  // Override config with auto-detected values (user config acts as fallback)
  const effectiveMinFreq = audioProfile.minFreq;
  const effectiveMaxFreq = audioProfile.maxFreq;

  const chroma = new Float32Array(12);
  const spectrogramRaw: number[][] = [];
  const vocalPresenceRaw: number[] = []; // for lyrics/vocal detector

  // Spectral feature accumulators (for mood v2)
  let spectralCentroidSum = 0;
  let spectralCentroidCount = 0;
  const frameEnergies: number[] = [];

  // Store compact magnitude spectrum (musical range only) per frame for solfeggiogram
  const compactSpectra: Float32Array[] = [];
  const musicalBinMin = Math.max(1, Math.floor(effectiveMinFreq * fftSize / buffer.sampleRate));
  const musicalBinMax = Math.min(Math.floor(fftSize / 2) - 1, Math.floor(effectiveMaxFreq * fftSize / buffer.sampleRate));

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

    // Spectral centroid (brightness) — weighted mean of frequency
    let weightedSum = 0, magSum = 0;
    for (let i = 1; i < mag.length; i++) {
      const freq = (i * sampleRate) / fftSize;
      weightedSum += freq * mag[i];
      magSum += mag[i];
    }
    if (magSum > 0) {
      spectralCentroidSum += weightedSum / magSum;
      spectralCentroidCount++;
    }

    // Frame energy for variance computation
    frameEnergies.push(totalE);

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
    return buildSolfeggiogramRow(fullMag, sampleRate, fftSize, keyInfo, effectiveMinFreq, effectiveMaxFreq);
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

  // 5. BPM — pass brightness so octave correction prefers right range
  const bpm = detectBPM(samples, sampleRate, audioProfile.brightness);
  onProgress(84);

  // 6. Note distribution
  const dominantNotes = buildNoteDistribution(heatmapSmoothed, keyInfo);
  onProgress(90);

  // 7. Intervals & spectral features → Mood (Phase 4 v2)
  const intervals = computeIntervals(heatmapSmoothed);

  // Compute spectral features for mood v2
  const avgCentroid = spectralCentroidCount > 0 ? spectralCentroidSum / spectralCentroidCount : 1000;
  // Normalize brightness: 0 = very dark (~200Hz), 1 = very bright (~4000Hz)
  const brightness = Math.max(0, Math.min(1, (avgCentroid - 200) / 3800));

  // Energy variance (normalized)
  const meanEnergy = frameEnergies.length > 0 ? frameEnergies.reduce((a, b) => a + b, 0) / frameEnergies.length : 0;
  const rawVariance = frameEnergies.length > 0
    ? Math.sqrt(frameEnergies.map(e => (e - meanEnergy) ** 2).reduce((a, b) => a + b, 0) / frameEnergies.length)
    : 0;
  const energyVariance = meanEnergy > 0 ? Math.min(1, rawVariance / meanEnergy) : 0; // coefficient of variation

  // Note density: fraction of heatmap frames with significant activity
  const ACTIVITY_THRESHOLD = 0.15;
  let activeFrames = 0;
  for (const frame of heatmapSmoothed) {
    const maxVal = Math.max(...frame);
    if (maxVal > ACTIVITY_THRESHOLD) activeFrames++;
  }
  const noteDensity = heatmapSmoothed.length > 0 ? activeFrames / heatmapSmoothed.length : 0;

  // Harmonic complexity: Shannon entropy of normalized chromagram
  const chromaTotal = normalizedChroma.reduce((s, v) => s + v, 0);
  let harmonicComplexity = 0;
  if (chromaTotal > 0) {
    const chromaProbs = normalizedChroma.map(v => v / chromaTotal);
    const maxEntropy = Math.log2(12); // max possible entropy for 12 notes
    const entropy = -chromaProbs.reduce((s, p) => s + (p > 0 ? p * Math.log2(p) : 0), 0);
    harmonicComplexity = entropy / maxEntropy; // normalize to 0-1
  }

  const spectralFeatures: SpectralFeatures = { brightness, energyVariance, noteDensity, harmonicComplexity };
  const mood = classifyMood(keyInfo, bpm, dominantNotes, intervals, spectralFeatures);
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
