/**
 * chordDetection.ts — Real-time chord detection from chromagram frames
 *
 * Uses template matching (cosine similarity) against all common chord types
 * across all 12 roots. Analyzes chord progressions for mood-relevant features.
 */

// ── Chord type definitions (intervals in semitones from root) ──
const CHORD_TYPES: Record<string, number[]> = {
  "maj":  [0, 4, 7],
  "min":  [0, 3, 7],
  "dim":  [0, 3, 6],
  "aug":  [0, 4, 8],
  "sus2": [0, 2, 7],
  "sus4": [0, 5, 7],
  "maj7": [0, 4, 7, 11],
  "min7": [0, 3, 7, 10],
  "dom7": [0, 4, 7, 10],
  "dim7": [0, 3, 6, 9],
};

const NOTE_NAMES_CHORD = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

// Emotional character per chord type
const CHORD_EMOTION: Record<string, { tension: number; valence: number }> = {
  "maj":  { tension: 0.05, valence:  0.60 },
  "min":  { tension: 0.10, valence: -0.50 },
  "dim":  { tension: 0.80, valence: -0.70 },
  "aug":  { tension: 0.70, valence: -0.30 },
  "sus2": { tension: 0.30, valence:  0.10 },
  "sus4": { tension: 0.35, valence:  0.00 },
  "maj7": { tension: 0.15, valence:  0.45 },
  "min7": { tension: 0.25, valence: -0.40 },
  "dom7": { tension: 0.50, valence:  0.10 },
  "dim7": { tension: 0.90, valence: -0.80 },
};

interface ChordTemplate {
  name: string;
  root: number;
  type: string;
  bins: number[];    // 12-element template vector
  tension: number;
  valence: number;
}

// ── Pre-generate all chord templates (12 roots × 10 types = 120) ──
function buildTemplates(): ChordTemplate[] {
  const out: ChordTemplate[] = [];
  for (const [type, intervals] of Object.entries(CHORD_TYPES)) {
    const emo = CHORD_EMOTION[type];
    for (let root = 0; root < 12; root++) {
      const bins = new Array(12).fill(0);
      for (const iv of intervals) bins[(root + iv) % 12] = 1.0;
      bins[root] = 1.5; // root note gets extra weight
      out.push({
        name: `${NOTE_NAMES_CHORD[root]}${type}`,
        root, type, bins,
        tension: emo.tension,
        valence: emo.valence,
      });
    }
  }
  return out;
}

const ALL_TEMPLATES = buildTemplates();

// ── Single-frame chord detection ──
export interface DetectedChord {
  name: string;
  root: number;
  type: string;
  confidence: number;
  tension: number;
  valence: number;
}

export function detectChordFromChroma(chroma: number[]): DetectedChord {
  const mx = Math.max(...chroma);
  if (mx < 1e-6) {
    return { name: "N/C", root: -1, type: "none", confidence: 0, tension: 0, valence: 0 };
  }
  const norm = chroma.map(v => v / mx);

  let best = ALL_TEMPLATES[0];
  let bestScore = -Infinity;

  for (const tmpl of ALL_TEMPLATES) {
    let dot = 0, nA = 0, nB = 0;
    for (let i = 0; i < 12; i++) {
      dot += norm[i] * tmpl.bins[i];
      nA  += norm[i] ** 2;
      nB  += tmpl.bins[i] ** 2;
    }
    const score = dot / (Math.sqrt(nA) * Math.sqrt(nB) + 1e-10);
    if (score > bestScore) { bestScore = score; best = tmpl; }
  }

  return {
    name: best.name,
    root: best.root,
    type: best.type,
    confidence: Math.max(0, Math.min(1, bestScore)),
    tension: best.tension,
    valence: best.valence,
  };
}

// ── Chord progression analysis for mood ──
export interface ChordProgressionFeatures {
  majorRatio: number;      // 0-1: fraction of major-family chords
  minorRatio: number;      // 0-1: fraction of minor-family chords
  avgTension: number;      // 0-1: mean harmonic tension
  avgValence: number;      // -1..+1: mean chord emotional character
  changeRate: number;      // 0-1: how often the chord changes (high = restless)
  chordCount: number;      // total number of detected chord windows
}

export function analyzeChordProgression(chords: DetectedChord[]): ChordProgressionFeatures {
  const DEFAULT: ChordProgressionFeatures = {
    majorRatio: 0.5, minorRatio: 0.5, avgTension: 0.3,
    avgValence: 0, changeRate: 0.5, chordCount: 0,
  };
  if (chords.length === 0) return DEFAULT;

  // Only use confident detections
  const good = chords.filter(c => c.confidence > 0.55);
  if (good.length < 3) return DEFAULT;

  const majTypes = new Set(["maj", "maj7", "dom7"]);
  const minTypes = new Set(["min", "min7", "dim", "dim7"]);

  const majCount = good.filter(c => majTypes.has(c.type)).length;
  const minCount = good.filter(c => minTypes.has(c.type)).length;
  const total = good.length;

  let changes = 0;
  for (let i = 1; i < good.length; i++) {
    if (good[i].name !== good[i - 1].name) changes++;
  }

  return {
    majorRatio: majCount / total,
    minorRatio: minCount / total,
    avgTension: good.reduce((s, c) => s + c.tension, 0) / total,
    avgValence: good.reduce((s, c) => s + c.valence, 0) / total,
    changeRate: Math.min(1, changes / (total * 0.5)),
    chordCount: total,
  };
}
