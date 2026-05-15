export type AnalysisState = "idle" | "loaded" | "processing" | "complete";

export interface AnalysisConfig {
  fftSize: 2048 | 4096 | 8192 | 16384;
  windowType: "hann" | "hamming" | "blackman";
  pitchAlgo: "yin" | "amdf" | "macleod";
  keyAlgo: "ks" | "temperley";
  minFreq: number;
  maxFreq: number;
  autoFreq?: boolean;
}

export interface AudioFileInfo {
  name: string;
  size: number;
  type: string;
  duration: number;
  sampleRate: number;
  channels: number;
  file: File;
}

export interface NoteDistribution {
  solfege: string;
  absolute: string;
  percentage: number;
  count: number;
}

export interface MoodDistribution {
  mood: string;
  value: number;
export interface ChromagramEntry {
  note: string;
  value: number;
}

export interface KeyInfo {
  root: string;
  mode: string;
  confidence: number;
  midiRoot?: number; // MIDI note class 0-11 (C=0)
}

export interface MoodInfo {
  primary: string;
  confidence: number;
  distribution: MoodDistribution[];
  valence: number;
  arousal: number;
  style?: string;
}

export interface AnalysisResult {
  key: KeyInfo;
  bpm: number;
  timeSignature: string;
  totalNotes: number;
  dominantNotes: NoteDistribution[];
  mood: MoodInfo;
  genres?: string[];
  lyricMood?: string;
  chromagram: ChromagramEntry[];
  explanation: string;
  intervals: number[];
  heatmapData: number[][];      // [timeSlice][solfeggioNote 0-20] = intensity 0-1
  spectrogramData: number[][];  // [timeSlice][freqBand 0-47] = intensity 0-1
  vocalPresence: number[];      // [timeSlice] = probability 0-1 of vocals/lyrics presence
  lyrics?: { text: string; timestamp: [number, number] }[]; // Whisper STT output chunks
  processingTime: number;       // ms
  duration: number;             // seconds
  tensionPeaks: number[];       // timestamps in seconds of high-intensity moments
  waveformData: [number, number][]; // [timeSlice] = [min, max] amplitude per slice
}
