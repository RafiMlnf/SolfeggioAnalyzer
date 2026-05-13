export type Lang = "id" | "en";

export const T: Record<Lang, Record<string, string>> = {
  id: {
    // Tabs
    tabMood: "Mood", tabNotes: "Nada", tabDetail: "Detail",
    // Sections
    primaryMood: "Mood Utama",
    moodDist: "Distribusi Mood",
    musicalMetrics: "Metrik Musikal",
    chromagram: "Chromagram (12 Nada)",
    narration: "Narasi Analisis",
    solfeggioDistrib: "Distribusi Solfeggio",
    intervalPattern: "Pola Lompatan Interval",
    processingPipeline: "Pipeline Pemrosesan",
    phase4Scoring: "Skor Phase 4",
    valenceArousalMap: "Peta Valensi-Arousal",
    // Metrics
    key: "Kunci", mode: "Mode", tempo: "Tempo",
    timeSig: "Birama", totalNotes: "Total Nada",
    keyConf: "Konf. Kunci", processed: "Diproses",
    valence: "Valensi", arousal: "Arousal",
    // Status
    awaiting: "Menunggu analisis",
    // Table headers
    solfege: "Solfege", abs: "Abs", count: "Count",
    // Legend
    stepwise: "Langkah (1-2)", skip: "Loncat (3-4)", leap: "Lompat (5+)",
    // Pipeline steps
    step_decode: "Dekode Audio + Window",
    step_fft: "Analisis FFT (8192pt)",
    step_spec: "Pita Spektrogram (48)",
    step_chroma: "Generasi Chromagram",
    step_key: "Estimasi Kunci (K-S)",
    step_bpm: "Deteksi BPM (Onset)",
    step_solfeg: "Pemetaan Solfeggio",
    step_mood: "Klasifikasi Mood",
    total: "Total",
  },
  en: {
    tabMood: "Mood", tabNotes: "Notes", tabDetail: "Detail",
    primaryMood: "Primary Mood",
    moodDist: "Mood Distribution",
    musicalMetrics: "Musical Metrics",
    chromagram: "Chromagram (12-Tone)",
    narration: "Analysis Narration",
    solfeggioDistrib: "Solfeggio Distribution",
    intervalPattern: "Interval Jump Pattern",
    processingPipeline: "Processing Pipeline",
    phase4Scoring: "Phase 4 Scoring",
    valenceArousalMap: "Valence-Arousal Map",
    key: "Key", mode: "Mode", tempo: "Tempo",
    timeSig: "Time Sig", totalNotes: "Total Notes",
    keyConf: "Key Conf.", processed: "Processed",
    valence: "Valence", arousal: "Arousal",
    awaiting: "Awaiting analysis",
    solfege: "Solfege", abs: "Abs", count: "Count",
    stepwise: "Stepwise (1-2)", skip: "Skip (3-4)", leap: "Leap (5+)",
    step_decode: "Audio Decode + Window",
    step_fft: "FFT Analysis (8192pt)",
    step_spec: "Spectrogram Bands (48)",
    step_chroma: "Chromagram Generation",
    step_key: "Key Estimation (K-S)",
    step_bpm: "BPM Detection (Onset)",
    step_solfeg: "Solfeggio Mapping",
    step_mood: "Mood Classification",
    total: "Total",
  },
};
