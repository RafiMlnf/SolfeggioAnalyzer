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
import { detectChordFromChroma, analyzeChordProgression, type ChordProgressionFeatures } from "./chordDetection";

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

// ── A-weighting: perceptual loudness curve (IEC 61672:2003) ───
// Returns a multiplier 0-1 that models how the human ear perceives
// different frequencies. Low bass and very high treble are attenuated.
function aWeight(f: number): number {
  if (f < 20) return 0;
  const f2 = f * f;
  const num = 12194 * 12194 * f2 * f2;
  const den =
    (f2 + 20.6 * 20.6) *
    Math.sqrt((f2 + 107.7 * 107.7) * (f2 + 737.9 * 737.9)) *
    (f2 + 12194 * 12194);
  const ra = num / den;
  // Normalize so 1kHz ≈ 1.0
  const ref = 12194 * 12194 * 1e12 /
    ((1e6 + 20.6 * 20.6) * Math.sqrt((1e6 + 107.7 * 107.7) * (1e6 + 737.9 * 737.9)) * (1e6 + 12194 * 12194));
  return ra / ref;
}

// ── Chromagram update (perceptual A-weighted) ─────────────────
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
    // Apply A-weighting so treble-heavy instruments don't dominate
    chroma[noteClass] += mag[i] * aWeight(freq);
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

// ── BPM detection (autocorrelation + percussive onset) ───────────
// Uses dedicated kick (20-300Hz) + snare (200-1kHz) bands for accurate onset,
// plus iterative octave correction and multi-candidate harmonic voting.
function detectBPM(samples: Float32Array, sampleRate: number, brightness = 0.5): number {

  const frameSize = 2048; // larger = better low-freq resolution for kick
  const hopSize = 512;
  // Analyze up to 60 seconds for better tempo stability
  const analysisLen = Math.min(samples.length, sampleRate * 60);
  const numFrames = Math.floor((analysisLen - frameSize) / hopSize);

  if (numFrames < 20) return 120;

  // ── 1. Dual-band percussive onset (kick + snare) ──
  const kickBinMax = Math.floor(300 * frameSize / sampleRate);
  const snareBinMax = Math.floor(1000 * frameSize / sampleRate);
  const snareBinMin = Math.floor(200 * frameSize / sampleRate);
  let prevMag: Float32Array | null = null;
  const onsetKick: number[] = [];
  const onsetSnare: number[] = [];

  for (let i = 0; i < numFrames; i++) {
    const frame = new Float32Array(frameSize);
    const offset = i * hopSize;
    for (let j = 0; j < frameSize; j++) {
      const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * j) / (frameSize - 1));
      frame[j] = (samples[offset + j] ?? 0) * w;
    }
    const real = Array.from(frame);
    const imag = new Array(frameSize).fill(0);
    fft(real, imag);
    const mag = magnitudeSpectrum(real, imag);

    if (prevMag) {
      let kick = 0, snare = 0;
      for (let j = 1; j < mag.length; j++) {
        const diff = mag[j] - prevMag[j];
        if (diff <= 0) continue;
        if (j <= kickBinMax) kick += diff;
        if (j >= snareBinMin && j <= snareBinMax) snare += diff;
      }
      onsetKick.push(kick);
      onsetSnare.push(snare);
    } else {
      onsetKick.push(0);
      onsetSnare.push(0);
    }
    prevMag = mag;
  }

  // ── 2. Combine kick (65%) + snare (35%) onset ──
  const maxKick = Math.max(...onsetKick, 1e-10);
  const maxSnare = Math.max(...onsetSnare, 1e-10);
  const onset = onsetKick.map((k, i) =>
    (k / maxKick) * 0.65 + (onsetSnare[i] / maxSnare) * 0.35
  );

  // ── 3. Autocorrelation in BPM range 40–220 ──
  const fps = sampleRate / hopSize;
  const minLag = Math.floor((fps * 60) / 220);
  const maxLag = Math.min(Math.ceil((fps * 60) / 40), Math.floor(onset.length / 2));

  const acf: { bpm: number; r: number }[] = [];
  for (let lag = minLag; lag <= maxLag; lag++) {
    let sum = 0;
    const n = onset.length - lag;
    for (let i = 0; i < n; i++) sum += onset[i] * onset[i + lag];
    acf.push({ bpm: (fps * 60) / lag, r: sum / n });
  }

  // ── 4. Find local maxima in the autocorrelation ──
  const peaks: typeof acf = [];
  for (let i = 1; i < acf.length - 1; i++) {
    if (acf[i].r > acf[i - 1].r && acf[i].r > acf[i + 1].r) {
      peaks.push(acf[i]);
    }
  }
  if (peaks.length === 0) return 120;
  peaks.sort((a, b) => b.r - a.r);

  // ── 5. Multi-candidate harmonic voting ──
  // BPM with the most harmonic support (half/double also appears) wins.
  const topN = peaks.slice(0, Math.min(8, peaks.length));
  const findNear = (target: number, tol = 5) =>
    peaks.find(p => Math.abs(p.bpm - target) < tol);

  const votes = topN.map(p => {
    let score = p.r;
    const half = findNear(p.bpm / 2);
    const dbl = findNear(p.bpm * 2);
    const third = findNear(p.bpm / 3);
    const triple = findNear(p.bpm * 3);
    if (half) score += half.r * 0.40;
    if (dbl) score += dbl.r * 0.40;
    if (third) score += third.r * 0.20;
    if (triple) score += triple.r * 0.20;
    return { bpm: p.bpm, score };
  });
  votes.sort((a, b) => b.score - a.score);
  let bestBpm = votes[0]?.bpm ?? peaks[0].bpm;

  // ── 6. Iterative octave correction toward natural tempo range 60-140 ──
  const TARGET_LO = 60, TARGET_HI = 140;
  for (let iter = 0; iter < 3; iter++) {
    if (bestBpm > TARGET_HI) {
      const halved = bestBpm / 2;
      const halfPeak = findNear(halved, 8);
      if ((halfPeak && halfPeak.r > peaks[0].r * 0.25) || halved >= TARGET_LO) {
        bestBpm = halved;
      } else break;
    } else if (bestBpm < TARGET_LO) {
      const doubled = bestBpm * 2;
      const dblPeak = findNear(doubled, 8);
      if ((dblPeak && dblPeak.r > peaks[0].r * 0.25) || doubled <= TARGET_HI) {
        bestBpm = doubled;
      } else break;
    } else break;
  }

  console.log(`[BPM] brightness=${brightness.toFixed(2)} → ${Math.round(bestBpm)} BPM (top3: ${topN.slice(0, 3).map(p => Math.round(p.bpm)).join(', ')})`);
  return Math.round(Math.max(40, Math.min(220, bestBpm)));
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
  spectralFlux: number;        // 0-1 — average frame-to-frame spectral change (high=rough/distorted)
  zcr: number;                 // 0-1 — Zero Crossing Rate
  onsetDensity: number;        // 0-1 — Attacks/beats frequency
}

type MusicStyle = "Rock/Metal" | "Electronic/Dance" | "Acoustic/Folk" | "Pop/Orchestral";

function detectGenreDistribution(
  sf: SpectralFeatures, 
  bpm: number,
  keyInfo: ReturnType<typeof detectKey>,
  chordProg: ChordProgressionFeatures
): { style: string; distribution: GenreDistribution[] } {
  let rockScore = 0;
  let electroScore = 0;
  let acousticScore = 0;
  let popScore = 0;
  let altRockScore = 0;
  let hipHopScore = 0;
  let synthwaveScore = 0;
  const isMinor = keyInfo.mode === "Minor";

  // Rock/Metal
  if (sf.spectralFlux > 0.4) rockScore += 3;
  if (sf.zcr > 0.12) rockScore += 2;
  if (bpm > 120) rockScore += 1;

  // Alternative Rock / Indie
  if (sf.spectralFlux > 0.25 && sf.spectralFlux <= 0.4) altRockScore += 2;
  if (sf.zcr > 0.08 && sf.zcr <= 0.15) altRockScore += 2;
  if (bpm > 90 && bpm < 130) altRockScore += 1;
  if (chordProg.changeRate > 0.3) altRockScore += 1;

  // Electronic/Dance
  if (sf.energyVariance > 0.35) electroScore += 2;
  if (sf.onsetDensity > 0.35) electroScore += 2;
  if (sf.brightness > 0.3) electroScore += 1;
  if (bpm > 115 && bpm < 140) electroScore += 2;

  // Synthwave
  if (sf.onsetDensity > 0.3 && sf.energyVariance < 0.4) synthwaveScore += 2;
  if (isMinor) synthwaveScore += 2;
  if (bpm >= 85 && bpm <= 115) synthwaveScore += 2;
  if (sf.brightness > 0.4) synthwaveScore += 1; // Bright synths

  // Hip-Hop / Rap
  if (sf.onsetDensity > 0.45) hipHopScore += 3; // vocal/beat heavy
  if (sf.brightness < 0.4) hipHopScore += 2; // bass heavy
  if (bpm >= 75 && bpm <= 105) hipHopScore += 2;
  if (chordProg.changeRate < 0.3) hipHopScore += 1; // loop based

  // Acoustic/Folk
  if (sf.spectralFlux < 0.25) acousticScore += 3;
  if (sf.zcr < 0.08) acousticScore += 2;
  if (sf.energyVariance < 0.3) acousticScore += 1;
  if (bpm < 110) acousticScore += 1;

  // Pop/Orchestral
  popScore += 3; // Base score
  if (sf.brightness > 0.4) popScore += 1;
  if (sf.energyVariance > 0.2) popScore += 1;
  if (bpm > 80 && bpm < 130) popScore += 1;

  const genres = [
    { genre: "Rock / Metal", score: rockScore },
    { genre: "Alt Rock / Indie", score: altRockScore },
    { genre: "Electronic / Dance", score: electroScore },
    { genre: "Synthwave", score: synthwaveScore },
    { genre: "Hip-Hop / Rap", score: hipHopScore },
    { genre: "Acoustic / Folk", score: acousticScore },
    { genre: "Pop / Orchestral", score: popScore },
  ];

  // Emphasize the top genres using exponent
  const total = genres.reduce((s, g) => s + Math.max(0, g.score) ** 1.5, 0) || 1;
  const distribution = genres
    .map(g => ({ genre: g.genre, value: Math.round(((Math.max(0, g.score) ** 1.5) / total) * 100) }))
    .filter(g => g.value > 0)
    .sort((a, b) => b.value - a.value);

  // Fix rounding
  const sum = distribution.reduce((s, d) => s + d.value, 0);
  if (sum !== 100 && distribution.length > 0) {
    distribution[0].value += 100 - sum;
  }

  return { style: distribution[0]?.genre || "Pop / Orchestral", distribution };
}

const MOOD_COLORS: Record<string, string> = {
  // Positive / energetic
  Energetic: "#f97316",
  Happy: "#facc15",
  Groovy: "#f59e0b",
  Catchy: "#84cc16",
  Epic: "#e67e22",
  // Peaceful
  Calm: "#34d399",
  Dreamy: "#a78bfa",
  Romantic: "#f472b6",
  // Bittersweet / mixed
  Nostalgic: "#7c6fd4",
  Bittersweet: "#818cf8",
  // Negative / minor
  Melancholy: "#60a5fa",
  Sad: "#3b82f6",
  Solemn: "#4a5568",
  // Intense / dark
  Tense: "#f87171",
  Dramatic: "#dc2626",
  Dark: "#1e293b",
  Intense: "#d35400",
};

function classifyMood(
  keyInfo: ReturnType<typeof detectKey>,
  bpm: number,
  intervals: number[],
  sf: SpectralFeatures,
  chordProg: ChordProgressionFeatures
): { primary: string; confidence: number; distribution: MoodDistribution[]; valence: number; arousal: number; style: string; genres: GenreDistribution[] } {

  const genreData = detectGenreDistribution(sf, bpm, keyInfo, chordProg);
  const style = genreData.style;
  const genres = genreData.distribution;

  // Base Features
  const isMinor = keyInfo.mode === "Minor";
  const fast = bpm > 115;
  const slow = bpm < 85;
  const highTension = chordProg.avgTension > 0.4;

  // ── Archetype scoring — each max ~9 pts, tightly gated ──────────
  // Rules:
  //  • Each archetype has unique "fingerprint" conditions — significant overlap is forbidden
  //  • First condition is a HARD GATE (if not met, score stays 0)
  //  • Score 0 means archetype is truly absent — no soft minimum
  const archetypes: Record<string, () => number> = {

    // ── ENERGETIC ──────────────────────────────────────────────────
    // Gate: fast tempo + major + high onset
    Energetic: () => {
      if (!(!isMinor && fast && sf.onsetDensity > 0.4)) return 0;
      let s = 3; // gate bonus
      if (bpm > 130) s += 2;
      if (sf.brightness > 0.5) s += 2;
      if (chordProg.majorRatio > 0.7) s += 2;
      return s;
    },

    // ── HAPPY ─────────────────────────────────────────────────────
    // Gate: major mode + valence positive + moderate-to-fast
    Happy: () => {
      if (isMinor || chordProg.avgValence < 0.1 || bpm < 80) return 0;
      let s = 2;
      if (chordProg.majorRatio > 0.7) s += 2;
      if (bpm > 100) s += 2;
      if (sf.brightness > 0.5) s += 1;
      if (style === "Pop/Orchestral" || style === "Acoustic/Folk") s += 1;
      return s;
    },

    // ── GROOVY ────────────────────────────────────────────────────
    // Gate: dance/electronic style + specific BPM range
    Groovy: () => {
      if (!(style === "Electronic/Dance" || style === "Pop/Orchestral")) return 0;
      if (!(bpm >= 90 && bpm <= 130)) return 0;
      let s = 3;
      if (sf.onsetDensity > 0.5) s += 3;
      if (sf.energyVariance > 0.35) s += 1;
      if (!isMinor) s += 1;
      return s;
    },

    // ── CATCHY ────────────────────────────────────────────────────
    // Gate: high chord change rate + major dominant + moderate BPM
    Catchy: () => {
      if (!(chordProg.changeRate > 0.4 && !isMinor && bpm > 85)) return 0;
      let s = 2;
      if (sf.brightness > 0.45) s += 2;
      if (chordProg.majorRatio > 0.6) s += 2;
      if (sf.onsetDensity > 0.3) s += 1;
      return s;
    },

    // ── CALM ──────────────────────────────────────────────────────
    // Gate: slow + low flux + major or neutral (NOT minor heavy)
    Calm: () => {
      if (!(slow && sf.spectralFlux < 0.2 && chordProg.minorRatio < 0.5)) return 0;
      let s = 3;
      if (sf.energyVariance < 0.2) s += 2;
      if (chordProg.changeRate < 0.2) s += 1;
      if (sf.onsetDensity < 0.25) s += 1;
      if (style === "Acoustic/Folk") s += 1;
      return s;
    },

    // ── DREAMY ────────────────────────────────────────────────────
    // Gate: low flux + low ZCR + slow/moderate tempo
    Dreamy: () => {
      if (!(sf.spectralFlux < 0.18 && sf.zcr < 0.1 && bpm < 100)) return 0;
      let s = 3;
      if (slow) s += 2;
      if (sf.brightness < 0.45) s += 1;
      if (chordProg.changeRate < 0.3) s += 1;
      if (style === "Acoustic/Folk" || style === "Electronic/Dance") s += 1;
      return s;
    },

    // ── ROMANTIC ──────────────────────────────────────────────────
    // Gate: mid-tempo + must have BOTH major AND some minor + smooth
    Romantic: () => {
      if (!(bpm > 55 && bpm < 105)) return 0;
      if (!(chordProg.majorRatio > 0.35 && chordProg.minorRatio > 0.25)) return 0;
      let s = 2;
      if (sf.spectralFlux < 0.25) s += 2;
      if (sf.brightness < 0.52) s += 1;
      if (style === "Acoustic/Folk" || style === "Pop/Orchestral") s += 2;
      if (chordProg.avgValence > 0) s += 1;
      return s;
    },

    // ── NOSTALGIC ─────────────────────────────────────────────────
    // Gate: must have CLEAR major-minor balance (bittersweet harmony) + NOT fast
    Nostalgic: () => {
      if (bpm > 100) return 0;
      const mixedChords = chordProg.majorRatio > 0.35 && chordProg.minorRatio > 0.35;
      if (!mixedChords) return 0;
      let s = 2;
      if (sf.brightness > 0.3 && sf.brightness < 0.55) s += 2; // mid-tone brightness
      if (chordProg.changeRate < 0.4) s += 1;
      if (style === "Acoustic/Folk" || style === "Pop/Orchestral") s += 2;
      return s;
    },

    // ── BITTERSWEET ───────────────────────────────────────────────
    // Gate: minor key but with upward harmonic motion (moderate valence)
    Bittersweet: () => {
      if (!isMinor) return 0;
      if (!(chordProg.avgValence > -0.3 && chordProg.avgValence < 0.2)) return 0;
      let s = 2;
      if (chordProg.majorRatio > 0.25) s += 2; // some major relief
      if (bpm > 65 && bpm < 110) s += 1;
      if (sf.brightness > 0.3) s += 1;
      if (style === "Pop/Orchestral" || style === "Acoustic/Folk") s += 1;
      return s;
    },

    // ── MELANCHOLY ────────────────────────────────────────────────
    // Gate: minor + low-moderate energy + slower
    Melancholy: () => {
      if (!isMinor || bpm > 105) return 0;
      let s = 2;
      if (chordProg.minorRatio > 0.55) s += 2;
      if (slow) s += 2;
      if (sf.brightness < 0.4) s += 1;
      if (chordProg.avgValence < -0.1) s += 1;
      return s;
    },

    // ── SAD ───────────────────────────────────────────────────────
    // Gate: minor + strong negative valence + slow tempo
    Sad: () => {
      if (!(isMinor && bpm < 90 && chordProg.avgValence < -0.2)) return 0;
      let s = 3;
      if (chordProg.minorRatio > 0.7) s += 2;
      if (bpm < 75) s += 2;
      if (sf.energyVariance < 0.25) s += 1;
      return s;
    },

    // ── SOLEMN ────────────────────────────────────────────────────
    // Gate: very slow + very low energy variance + minor
    Solemn: () => {
      if (!(bpm < 72 && isMinor && sf.energyVariance < 0.2)) return 0;
      let s = 3;
      if (chordProg.avgTension > 0.3) s += 2;
      if (sf.spectralFlux < 0.18) s += 2;
      if (style === "Pop/Orchestral" || style === "Acoustic/Folk") s += 1;
      return s;
    },

    // ── TENSE ─────────────────────────────────────────────────────
    // Gate: high chord tension + minor + energy building
    Tense: () => {
      if (!(highTension && isMinor)) return 0;
      let s = 3;
      if (chordProg.avgTension > 0.55) s += 2;
      if (sf.energyVariance > 0.4) s += 2;
      if (chordProg.changeRate > 0.35) s += 1;
      return s;
    },

    // ── DRAMATIC ──────────────────────────────────────────────────
    // Gate: high tension + high energy variance (dynamic contrast)
    Dramatic: () => {
      if (!(highTension && sf.energyVariance > 0.5)) return 0;
      let s = 3;
      if (chordProg.avgTension > 0.5) s += 2;
      if (chordProg.changeRate > 0.4) s += 2;
      if (sf.brightness > 0.35) s += 1;
      return s;
    },

    // ── DARK ──────────────────────────────────────────────────────
    // Gate: minor + low brightness + high tension
    Dark: () => {
      if (!(isMinor && sf.brightness < 0.35 && highTension)) return 0;
      let s = 3;
      if (chordProg.minorRatio > 0.65) s += 2;
      if (sf.zcr > 0.1) s += 2; // gritty texture
      if (chordProg.avgValence < -0.3) s += 1;
      return s;
    },

    // ── INTENSE ───────────────────────────────────────────────────
    // Gate: Rock/Electronic + fast OR high energy variance
    Intense: () => {
      if (!(style === "Rock/Metal" || style === "Electronic/Dance")) return 0;
      if (!(fast || sf.energyVariance > 0.55)) return 0;
      let s = 3;
      if (highTension) s += 2;
      if (sf.energyVariance > 0.55) s += 2;
      if (chordProg.changeRate > 0.45) s += 1;
      return s;
    },

    // ── EPIC ──────────────────────────────────────────────────────
    // Gate: orchestral/rock + high energy variance + must NOT be predominantly minor
    Epic: () => {
      if (!(style === "Pop/Orchestral" || style === "Rock/Metal")) return 0;
      if (!(sf.energyVariance > 0.5 && sf.brightness > 0.4)) return 0;
      let s = 3;
      if (chordProg.majorRatio > 0.45) s += 2;
      if (chordProg.changeRate > 0.35) s += 2;
      if (bpm > 90) s += 1;
      return s;
    },
  };

  const scored = Object.entries(archetypes).map(([name, scorer]) => ({
    mood: name,
    score: scorer(), // 0 = truly absent, no soft floor
  })).filter(m => m.score > 0); // completely remove zero-score moods

  const RELATED_MOODS: Record<string, string[]> = {
    Energetic: ["Happy", "Catchy", "Groovy", "Epic"],
    Happy: ["Catchy", "Energetic", "Dreamy", "Groovy"],
    Groovy: ["Energetic", "Catchy", "Happy"],
    Catchy: ["Happy", "Groovy", "Energetic"],
    Epic: ["Intense", "Dramatic", "Tense", "Energetic"],
    Calm: ["Dreamy", "Romantic", "Nostalgic"],
    Dreamy: ["Calm", "Romantic", "Nostalgic"],
    Romantic: ["Dreamy", "Calm", "Nostalgic"],
    Nostalgic: ["Bittersweet", "Calm", "Dreamy"],
    Bittersweet: ["Nostalgic", "Melancholy", "Romantic"],
    Melancholy: ["Sad", "Bittersweet", "Solemn"],
    Sad: ["Melancholy", "Solemn", "Dark"],
    Solemn: ["Sad", "Melancholy", "Dark"],
    Tense: ["Dramatic", "Dark", "Intense"],
    Dramatic: ["Tense", "Epic", "Intense"],
    Dark: ["Tense", "Solemn", "Sad"],
    Intense: ["Epic", "Dramatic", "Tense"],
  };

  if (scored.length > 0 && scored.length < 3) {
    scored.sort((a,b) => b.score - a.score);
    const primaryName = scored[0].mood;
    const related = RELATED_MOODS[primaryName] || [];
    for (const rel of related) {
      if (scored.length >= 3) break;
      if (!scored.find(m => m.mood === rel)) {
        scored.push({ mood: rel, score: 1 }); // Give a small score
      }
    }
  }

  // Guard: if nothing scored (extremely sparse audio), fall back to a neutral result
  if (scored.length === 0) {
    return { primary: "Calm", confidence: 50, distribution: [{ mood: "Calm", value: 60, color: MOOD_COLORS["Calm"] }, { mood: "Dreamy", value: 30, color: MOOD_COLORS["Dreamy"] }, { mood: "Romantic", value: 10, color: MOOD_COLORS["Romantic"] }], valence: 0, arousal: 0, style, genres };
  }

  // Calculate faux valence and arousal based on the winner for UI backward compatibility
  scored.sort((a, b) => b.score - a.score);
  const primary = scored[0].mood;

  let valence = 0;
  let arousal = 0;
  switch (primary) {
    case "Energetic": valence = 0.7; arousal = 0.9; break;
    case "Happy": valence = 0.8; arousal = 0.6; break;
    case "Groovy": valence = 0.5; arousal = 0.7; break;
    case "Catchy": valence = 0.6; arousal = 0.5; break;
    case "Epic": valence = 0.4; arousal = 0.8; break;
    case "Calm": valence = 0.4; arousal = -0.7; break;
    case "Dreamy": valence = 0.3; arousal = -0.6; break;
    case "Romantic": valence = 0.5; arousal = -0.3; break;
    case "Nostalgic": valence = 0.1; arousal = -0.4; break;
    case "Bittersweet": valence = -0.1; arousal = -0.2; break;
    case "Melancholy": valence = -0.6; arousal = -0.5; break;
    case "Sad": valence = -0.8; arousal = -0.6; break;
    case "Solemn": valence = -0.5; arousal = -0.8; break;
    case "Tense": valence = -0.4; arousal = 0.7; break;
    case "Dramatic": valence = -0.3; arousal = 0.8; break;
    case "Dark": valence = -0.7; arousal = 0.2; break;
    case "Intense": valence = -0.3; arousal = 0.9; break;
    default: valence = 0.0; arousal = 0.0;
  }

  const totalScore = scored.reduce((s, m) => s + m.score ** 1.5, 0); 
  const distribution: MoodDistribution[] = scored
    .map(m => ({
      mood: m.mood,
      value: Math.round(((m.score ** 1.5) / totalScore) * 100),
      color: MOOD_COLORS[m.mood] ?? "var(--accent-primary)",
    }))
    .filter(m => m.value > 0)
    .sort((a, b) => b.value - a.value);

  // Enforce minimum 3 moods if we lost some due to rounding to 0
  while (distribution.length < 3 && distribution.length < scored.length) {
      const dropped = scored.find(s => !distribution.find(d => d.mood === s.mood));
      if (dropped) {
          distribution.push({ mood: dropped.mood, value: 1, color: MOOD_COLORS[dropped.mood] || "var(--accent-primary)" });
      } else {
          break;
      }
  }

  // Ensure values sum to 100
  const sum = distribution.reduce((s, d) => s + d.value, 0);
  if (sum !== 100 && distribution.length > 0) {
    distribution[0].value += 100 - sum;
  }

  console.log(`[Mood v4-Archetype] Style: ${style} | Winner: ${primary} | ZCR: ${sf.zcr.toFixed(2)} | Flux: ${sf.spectralFlux.toFixed(2)} | Onsets: ${sf.onsetDensity.toFixed(2)}`);

  return {
    primary: distribution[0].mood,
    confidence: distribution[0].value,
    distribution,
    valence,
    arousal,
    style,
    genres
  };
}

// ── Lyric-Audio Mood Fusion ──────────────────────────────────────
// Re-weights the audio mood distribution using lyric sentiment.
// Prevents cases like "death-themed lyrics" scoring as "Happy".
function fuseMoodWithLyrics(
  mood: { primary: string; confidence: number; distribution: MoodDistribution[]; valence: number; arousal: number; style: string },
  lyricMood: string
): typeof mood {
  if (!lyricMood || lyricMood === "Reflective") return mood; // Neutral — no adjustment

  // Maps each lyricMood to boost/penalize multipliers for audio archetypes.
  // Boosts > 1.0 amplify that archetype; penalties < 1.0 suppress it.
  const FUSION_MAP: Record<string, Record<string, number>> = {
    Happy: {
      Happy: 1.5, Groovy: 1.4, Energetic: 1.3, Catchy: 1.2,
      Melancholy: 0.6, Sad: 0.5, Dark: 0.6, Bittersweet: 0.7,
    },
    Sad: {
      Sad: 1.6, Melancholy: 1.5, Nostalgic: 1.3, Bittersweet: 1.2,
      Dark: 1.1, Dramatic: 1.1,
      Happy: 0.5, Groovy: 0.5, Energetic: 0.6, Catchy: 0.6, Epic: 0.7,
    },
    Romantic: {
      Romantic: 1.7, Dreamy: 1.5, Calm: 1.3, Nostalgic: 1.1,
      Intense: 0.6, Dark: 0.6, Groovy: 0.7,
    },
    Angry: {
      Intense: 1.6, Dark: 1.4, Dramatic: 1.3, Tense: 1.2,
      Happy: 0.5, Romantic: 0.5, Calm: 0.6, Dreamy: 0.6, Groovy: 0.6,
    },
  };

  const multipliers = FUSION_MAP[lyricMood] ?? {};

  // Apply multipliers to raw values
  const fused = mood.distribution.map(d => ({
    ...d,
    value: d.value * (multipliers[d.mood] ?? 1.0),
  })).filter(d => d.value > 0);

  // Re-normalize to 100%
  const total = fused.reduce((s, d) => s + d.value, 0);
  if (total === 0) return mood;
  const normalized = fused.map(d => ({
    ...d,
    value: Math.round((d.value / total) * 100),
  })).sort((a, b) => b.value - a.value);

  // Fix rounding drift on top item
  const normSum = normalized.reduce((s, d) => s + d.value, 0);
  if (normalized.length > 0) normalized[0].value += 100 - normSum;

  const newPrimary = normalized[0]?.mood ?? mood.primary;
  console.log(`[FuseMood] lyricMood=${lyricMood} audio=${mood.primary} → fused=${newPrimary}`);

  return {
    ...mood,
    primary: newPrimary,
    confidence: normalized[0]?.value ?? mood.confidence,
    distribution: normalized,
  };
}


function generateExplanation(
  keyInfo: ReturnType<typeof detectKey>,
  bpm: number,
  mood: { primary: string; style?: string },
  notes: NoteDistribution[]
): string {
  const top = notes[0];
  const tempoDesc = bpm > 120 ? "cepat" : bpm > 80 ? "sedang" : "lambat";
  const modeIndo = keyInfo.mode === "Major" ? "Mayor" : "Minor";

  return (
    `Lagu ini terdeteksi berada di gaya musik ${mood.style || "Pop/Orchestral"} dengan nada dasar ${keyInfo.root} ${modeIndo} (kepercayaan ${keyInfo.confidence}%) ` +
    `serta tempo ${tempoDesc} sebesar ${bpm} BPM. ` +
    `Nada solfeggio yang paling dominan adalah ${top?.solfege} (${top?.absolute}) ` +
    `dengan persentase ${top?.percentage}%. ` +
    `Kombinasi progresi akord, tekstur suara (distorsi/kebersihan), dan energi berirama ` +
    `menempatkan lagu ini secara kuat dalam kategori emosional "${mood.primary}". ` +
    `Skala dasar: ${keyInfo.mode === "Major" ? "Mayor (1-2-3-4-5-6-7)" : "Minor Natural (1-2-♭3-4-5-♭6-♭7)"}.`
  );
}

// ── Interval calculation (semitone-based) ─────────────────────
// Maps solfeggio degree → semitones from root for meaningful interval measurement.
// Uses major-scale semitone offsets: Do=0, Re=2, Mi=4, Fa=5, Sol=7, La=9, Si=11
const DEGREE_TO_SEMITONE = [0, 2, 4, 5, 7, 9, 11]; // Do Re Mi Fa Sol La Si

function computeIntervals(heatmap: number[][]): number[] {
  // For each frame, find the dominant solfeggio degree and convert to semitones
  const semitones: number[] = heatmap.map(slice => {
    let maxIdx = 0;
    for (let i = 1; i < slice.length; i++) {
      if (slice[i] > slice[maxIdx]) maxIdx = i;
    }
    const degree = maxIdx % 7;
    return DEGREE_TO_SEMITONE[degree];
  });

  // Compute semitone intervals between consecutive frames
  const intervals: number[] = [];
  for (let i = 1; i < semitones.length && intervals.length < 40; i++) {
    // Circular semitone distance (within octave, max 6 semitones = tritone)
    const raw = Math.abs(semitones[i] - semitones[i - 1]);
    const dist = Math.min(raw, 12 - raw);
    if (dist > 0) intervals.push(dist);
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
  onProgress: (p: number) => void,
  lang: "id" | "en" = "id"
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
  const songIdRaw = file.name.replace(/\.[^/.]+$/, '');

  // 1. Ubah underscore & hyphen jadi spasi
  let songId = songIdRaw.replace(/[_-]+/g, ' ');

  // 2. Hapus kata-kata "sampah" hasil download (case-insensitive)
  const fluffWords = /\b(audio|official|video|lyrics|lyric|hd|hq|128kbps|320kbps|kbps|mp3|original|music|y2meta|app|live)\b/gi;
  songId = songId.replace(fluffWords, '');

  // 3. Bersihkan spasi ganda dan spasi di ujung teks
  songId = songId.replace(/\s+/g, ' ').trim();

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
      if (e?.name !== 'AbortError') console.warn('[LRCLIB] Error:', e.message || e);
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
      else console.warn('[Whisper] Error:', e.message || e);
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

  // Use auto-detected values only if autoFreq is enabled, otherwise use user config
  const effectiveMinFreq = config.autoFreq ? audioProfile.minFreq : config.minFreq;
  const effectiveMaxFreq = config.autoFreq ? audioProfile.maxFreq : config.maxFreq;

  const chroma = new Float32Array(12);
  const spectrogramRaw: number[][] = [];
  const vocalPresenceRaw: number[] = []; // for lyrics/vocal detector

  // Spectral feature accumulators (for mood v2/v3)
  let spectralCentroidSum = 0;
  let spectralCentroidCount = 0;
  const frameEnergies: number[] = [];
  let prevMagForFlux: Float32Array | null = null;
  const fluxValues: number[] = [];
  const zcrValues: number[] = [];
  const frameChromasForChords: number[][] = []; // per-frame chroma for chord detection

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
    let zeroCrossings = 0;
    for (let i = 0; i < fftSize; i++) {
      slice[i] = samples[pos + i];
      if (i > 0) {
        if ((slice[i - 1] >= 0 && slice[i] < 0) || (slice[i - 1] < 0 && slice[i] >= 0)) {
          zeroCrossings++;
        }
      }
    }
    zcrValues.push(zeroCrossings / fftSize);

    const windowed = applyWindow(slice, config.windowType);

    const real = Array.from(windowed);
    const imag = new Array(fftSize).fill(0);
    fft(real, imag);
    const mag = magnitudeSpectrum(real, imag);

    // Spectrogram bands (log-spaced)
    spectrogramRaw.push(computeLogBands(mag, sampleRate, fftSize, config.minFreq, config.maxFreq, SPEC_BANDS));

    // Chromagram — accumulate global + store per-frame for chord detection
    const frameChroma = new Float32Array(12);
    updateChromagram(mag, sampleRate, fftSize, frameChroma);
    for (let i = 0; i < 12; i++) chroma[i] += frameChroma[i];
    frameChromasForChords.push(Array.from(frameChroma));

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

    // Spectral flux: half-wave rectified difference from previous frame
    if (prevMagForFlux) {
      let flux = 0;
      const bins = Math.min(mag.length, prevMagForFlux.length);
      for (let i = 1; i < bins; i++) {
        const diff = mag[i] - prevMagForFlux[i];
        if (diff > 0) flux += diff;
      }
      fluxValues.push(flux);
    }
    prevMagForFlux = mag;

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

  // Note density: mean activity level per frame (continuous, not binary)
  // Uses the average of max-values across frames — gives more granularity
  // than a simple threshold count, especially after smoothing.
  let activitySum = 0;
  for (const fr of heatmapSmoothed) {
    const maxVal = Math.max(...fr);
    activitySum += maxVal;
  }
  const noteDensity = heatmapSmoothed.length > 0
    ? Math.min(1, activitySum / heatmapSmoothed.length) : 0;

  // Harmonic complexity: Shannon entropy of normalized chromagram
  const chromaTotal = normalizedChroma.reduce((s, v) => s + v, 0);
  let harmonicComplexity = 0;
  if (chromaTotal > 0) {
    const chromaProbs = normalizedChroma.map(v => v / chromaTotal);
    const maxEntropy = Math.log2(12); // max possible entropy for 12 notes
    const entropy = -chromaProbs.reduce((s, p) => s + (p > 0 ? p * Math.log2(p) : 0), 0);
    harmonicComplexity = entropy / maxEntropy; // normalize to 0-1
  }

  // Spectral flux: average frame-to-frame spectral change, normalized
  let spectralFlux = 0;
  let onsetDensity = 0;
  if (fluxValues.length > 0) {
    const meanFlux = fluxValues.reduce((a, b) => a + b, 0) / fluxValues.length;
    spectralFlux = Math.min(1, meanFlux / 20);

    // Calculate onset density (peaks in spectral flux)
    const threshold = meanFlux * 1.5;
    let onsets = 0;
    for (let i = 1; i < fluxValues.length - 1; i++) {
      if (fluxValues[i] > threshold && fluxValues[i] > fluxValues[i - 1] && fluxValues[i] > fluxValues[i + 1]) {
        onsets++;
      }
    }
    // Normalize against expected max onsets per frame
    onsetDensity = Math.min(1, onsets / (fluxValues.length * 0.3));
  }

  const avgZcr = zcrValues.length > 0 ? zcrValues.reduce((a, b) => a + b, 0) / zcrValues.length : 0;

  const spectralFeatures: SpectralFeatures = { brightness, energyVariance, noteDensity, harmonicComplexity, spectralFlux, zcr: avgZcr, onsetDensity };

  // 7b. Chord detection from per-frame chromagrams
  // Window ~8 frames together for stable chord detection (~0.5s per window)
  const CHORD_WINDOW = 8;
  const detectedChords: ReturnType<typeof detectChordFromChroma>[] = [];
  for (let w = 0; w < frameChromasForChords.length; w += CHORD_WINDOW) {
    const windowEnd = Math.min(w + CHORD_WINDOW, frameChromasForChords.length);
    const avgChroma = new Array(12).fill(0);
    for (let f = w; f < windowEnd; f++) {
      for (let c = 0; c < 12; c++) avgChroma[c] += frameChromasForChords[f][c];
    }
    const count = windowEnd - w;
    for (let c = 0; c < 12; c++) avgChroma[c] /= count;
    detectedChords.push(detectChordFromChroma(avgChroma));
  }
  const chordProgression = analyzeChordProgression(detectedChords);
  console.log(
    `[Chords] ${detectedChords.length} windows → maj=${(chordProgression.majorRatio * 100).toFixed(0)}% ` +
    `min=${(chordProgression.minorRatio * 100).toFixed(0)}% tension=${chordProgression.avgTension.toFixed(2)} ` +
    `valence=${chordProgression.avgValence.toFixed(3)} changeRate=${chordProgression.changeRate.toFixed(2)}`
  );

  const mood = classifyMood(keyInfo, bpm, intervals, spectralFeatures, chordProgression);
  onProgress(95);

  // 8. Normalize
  const spectrogramData = normalizeDb(spectrogramRaw);
  const heatmapData = heatmapSmoothed;

  // ── Await STT (LRCLIB) for Lyric-Aware Tension Peaks ──
  onProgress(95);
  let lyricsData: { text: string; timestamp: [number, number] }[] = [];
  try {
    lyricsData = await sttPromise;
    console.log(`Lirik diterima: ${lyricsData.length} segmen`);
  } catch (e) {
    console.error("STT await error:", e);
  }

  // Pre-calculate lyric starts (frames where a lyric line begins)
  const lyricStartFrames = new Set<number>();
  lyricsData.forEach(l => {
    // timestamp[0] is start time in seconds
    const startFrame = Math.floor(l.timestamp[0] * sampleRate / hopSize);
    // Allow a small window (±2 frames) to count as a lyric start
    for (let f = startFrame - 2; f <= startFrame + 2; f++) {
      if (f >= 0) lyricStartFrames.add(f);
    }
  });

  // 9. Tension peaks — Structural & Perceptual Analysis (Chorus/Drop Detection)
  // Normalize flux values
  const maxFlux = Math.max(...fluxValues, 0.01);
  const normFlux = fluxValues.map(v => v / maxFlux);

  // Note density per frame
  const frameDensity = heatmapSmoothed.map(row => row.reduce((a, b) => a + b, 0) / HEATMAP_ROWS);
  const maxDensity = Math.max(...frameDensity, 0.01);
  const normDensity = frameDensity.map(v => v / maxDensity);

  // Per-frame brightness (from log-bands)
  const frameBrightness = spectrogramRaw.map(bands => {
    let weighted = 0, sum = 0;
    bands.forEach((v, i) => { weighted += v * (i / SPEC_BANDS); sum += v; });
    return sum > 0 ? weighted / sum : 0;
  });

  const rawCompositeTension = spectrogramRaw.map((_, i) => {
    // 1. Energy factor (20%) - Normalized to mean energy
    const eNorm = meanEnergy > 0 ? Math.min(1.5, (frameEnergies[i] ?? 0) / meanEnergy) : 0;

    // 2. Arrangement Density (25%) - Thickness of the sound
    const d = normDensity[i] ?? 0;

    // 3. Spectral Flux (20%) - Rapid changes/transients (impact)
    const f = normFlux[i] ?? 0;

    // 4. High-Freq Focus / Brightness (15%) - Drops/Reff usually have more high-end energy
    const b = frameBrightness[i] ?? 0;

    // 5. Lyric Presence (20%) - Game changer: boosts tension at the exact moment a vocal line hits
    const lyricBoost = lyricStartFrames.has(i) ? 1.0 : 0;

    // Composite formula
    return (eNorm * 0.20) + (d * 0.25) + (f * 0.20) + (b * 0.15) + (lyricBoost * 0.20);
  });

  // Smooth the composite tension over a larger window to find sustained intense sections
  const windowSize = 12; // ~8s window for better structural detection
  const smoothedTension = rawCompositeTension.map((_, i, arr) => {
    let sum = 0, count = 0;
    for (let j = Math.max(0, i - windowSize); j <= Math.min(arr.length - 1, i + windowSize); j++) {
      sum += arr[j]; count++;
    }
    return sum / count;
  });

  const avgTension = smoothedTension.reduce((a, b) => a + b, 0) / (smoothedTension.length || 1);
  const stdTension = Math.sqrt(smoothedTension.map(e => (e - avgTension) ** 2).reduce((a, b) => a + b, 0) / (smoothedTension.length || 1));

  // Dynamic threshold: peaks must be significantly higher than average
  const threshold = avgTension + stdTension * 0.6;

  // NOVELTY / DROPS DETECTION:
  // Instead of picking the center of the chorus (where smoothed tension is highest),
  // we want the exact FIRST beat of the drop.
  // We calculate "Novelty": how much the tension suddenly jumped compared to a few seconds ago.
  const impactTension = rawCompositeTension.map((raw, i) => {
    const pastSmoothed = smoothedTension[Math.max(0, i - 10)] ?? 0;
    const currentSmoothed = smoothedTension[i];
    // Novelty = jump in structural energy (only positive jumps)
    const novelty = Math.max(0, currentSmoothed - pastSmoothed);

    // Impact = The raw transient (cymbal/kick) multiplied by the suddenness of the drop
    return raw * novelty;
  });

  // Find local maxima that exceed threshold
  const candidates: { sec: number, e: number }[] = [];
  for (let i = 2; i < impactTension.length - 2; i++) {
    // Only consider points that are entering structurally intense sections
    if (smoothedTension[i] > threshold) {
      const val = impactTension[i];
      // Find local peak in the exact drop/impact timeline
      if (val > impactTension[i - 1] && val > impactTension[i - 2] &&
        val > impactTension[i + 1] && val > impactTension[i + 2]) {
        // Calculate exact time based on hopSize and sampleRate
        const exactSeconds = (i * hopSize + (fftSize / 2)) / sampleRate;
        candidates.push({ sec: exactSeconds, e: val });
      }
    }
  }

  // Sort by drop intensity and pick top 4, ensuring they are at least 15 seconds apart
  candidates.sort((a, b) => b.e - a.e);
  const tensionPeaks: number[] = [];
  for (const c of candidates) {
    if (tensionPeaks.length >= 4) break;
    if (!tensionPeaks.some(p => Math.abs(p - c.sec) < 15)) {
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


  // Generate Dynamic Narrative using LLM (Groq)
  let explanation = generateExplanation(keyInfo, bpm, mood, dominantNotes); // Fallback string
  let lyricMood = "Reflective"; // Default
  let aiGenres: string[] = [];
  try {
    const plainLyrics = lyricsData.map(l => l.text).join('\n');

    // 15 second timeout for narrative generation
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);

    const songIdRaw = file.name.replace(/\.[^/.]+$/, '');
    const songTitle = songIdRaw.replace(/[_-]+/g, ' ');

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
        songTitle,
        lang
      }),
      signal: controller.signal
    });

    if (narrativeRes.ok) {
      const narrativeData = await narrativeRes.json();
      if (narrativeData.narrative) {
        explanation = narrativeData.narrative;
      } else if (narrativeData.fallback) {
        explanation = narrativeData.fallback;
      }
      if (narrativeData.lyricMood) {
        lyricMood = narrativeData.lyricMood;
      }
      if (Array.isArray(narrativeData.genres) && narrativeData.genres.length > 0) {
        aiGenres = narrativeData.genres;
      }
    }
  } catch (err: any) {
    console.warn("Failed to generate narrative:", err.message || err);
  }

  // ── Fuse audio mood + lyric sentiment for final distribution ──
  const fusedMood = fuseMoodWithLyrics(mood, lyricMood);

  onProgress(100);

  // 11. Generate waveform data (downsampled min/max per slice)
  const waveformSlices = spectrogramRaw.length; // match spectrogram time resolution
  const samplesPerSlice = Math.floor(totalSamples / waveformSlices);
  const waveformData: [number, number][] = [];
  for (let s = 0; s < waveformSlices; s++) {
    const start = s * samplesPerSlice;
    const end = Math.min(start + samplesPerSlice, totalSamples);
    let mn = 0, mx = 0;
    for (let i = start; i < end; i++) {
      if (samples[i] < mn) mn = samples[i];
      if (samples[i] > mx) mx = samples[i];
    }
    waveformData.push([mn, mx]);
  }

  return {
    key: keyInfo,
    bpm,
    timeSignature: "4/4",
    totalNotes: dominantNotes.reduce((s, n) => s + n.count, 0),
    dominantNotes,
    mood: fusedMood,
    genres: aiGenres.length > 0 ? aiGenres : mood.genres.map(g => g.genre).slice(0, 3),
    lyricMood,
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
    waveformData,
  };
}
