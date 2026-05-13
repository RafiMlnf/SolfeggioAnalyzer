/**
 * keyDetection.ts — Krumhansl-Schmuckler key-finding algorithm
 * Takes a 12-element chromagram and returns the most likely musical key.
 */

export const NOTE_NAMES = ["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"];

// Krumhansl-Schmuckler tonal hierarchy profiles
const KS_MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const KS_MINOR = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

function pearsonCorrelation(a: number[], b: number[]): number {
  const n = a.length;
  const meanA = a.reduce((s, v) => s + v, 0) / n;
  const meanB = b.reduce((s, v) => s + v, 0) / n;
  let num = 0, denA = 0, denB = 0;
  for (let i = 0; i < n; i++) {
    const da = a[i] - meanA;
    const db = b[i] - meanB;
    num += da * db;
    denA += da * da;
    denB += db * db;
  }
  return denA === 0 || denB === 0 ? 0 : num / Math.sqrt(denA * denB);
}

export interface KeyInfo {
  root: string;
  mode: string;
  confidence: number;
  midiRoot: number; // MIDI note class 0-11 (C=0)
}

export function detectKey(chromagram: number[]): KeyInfo {
  let bestCorr = -Infinity;
  let bestRoot = 0;
  let bestMode = "Major";

  for (let root = 0; root < 12; root++) {
    // Rotate chromagram so root aligns with index 0
    const rotated = Array.from({ length: 12 }, (_, i) => chromagram[(i + root) % 12]);

    const majorCorr = pearsonCorrelation(rotated, KS_MAJOR);
    const minorCorr = pearsonCorrelation(rotated, KS_MINOR);

    if (majorCorr > bestCorr) {
      bestCorr = majorCorr;
      bestRoot = root;
      bestMode = "Major";
    }
    if (minorCorr > bestCorr) {
      bestCorr = minorCorr;
      bestRoot = root;
      bestMode = "Minor";
    }
  }

  // Confidence: map correlation (-1..1) to percentage
  const confidence = Math.round(Math.max(0, bestCorr) * 100);

  return {
    root: NOTE_NAMES[bestRoot],
    mode: bestMode,
    confidence,
    midiRoot: bestRoot,
  };
}

/**
 * Convert MIDI note number to solfeggio row index (0-20, top=high octave).
 * Returns -1 if out of range.
 * Layout: rows 0-6 = octave 2 (high), 7-13 = octave 1 (mid), 14-20 = octave 0 (low)
 */
const MAJOR_INTERVALS = [0, 2, 4, 5, 7, 9, 11]; // semitones from root for Do Re Mi Fa Sol La Si
const MINOR_INTERVALS = [0, 2, 3, 5, 7, 8, 10]; // natural minor

export function midiToSolfeggioRow(midi: number, keyInfo: KeyInfo): number {
  const intervals = keyInfo.mode === "Major" ? MAJOR_INTERVALS : MINOR_INTERVALS;
  const noteClass  = ((midi - keyInfo.midiRoot) % 12 + 12) % 12;
  const degreeIndex = intervals.indexOf(noteClass);
  if (degreeIndex === -1) return -1; // chromatic note — outside scale

  // Octave relative to middle C (MIDI 60 = C4)
  const octaveOffset = Math.floor((midi - 60) / 12); // -1 = low, 0 = mid, 1 = high
  const octaveRow    = 1 - Math.max(-1, Math.min(1, octaveOffset)); // 0=high, 1=mid, 2=low

  // Y-axis label order within each octave block is DESCENDING:
  //   slot 0 = Do (1),  slot 1 = Si (7),  slot 2 = La (6),
  //   slot 3 = Sol (5), slot 4 = Fa (4),  slot 5 = Mi (3), slot 6 = Re (2)
  // => slot = 0 if Do, else (7 - degreeIndex)
  const slotInOctave = degreeIndex === 0 ? 0 : 7 - degreeIndex;
  return octaveRow * 7 + slotInOctave;
}
