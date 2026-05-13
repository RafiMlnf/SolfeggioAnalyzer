/**
 * pitchDetection.ts — Phase 2
 * Harmonic Product Spectrum (HPS) for accurate pitch detection.
 * Multi-pitch peak finding for chord content.
 */

/**
 * HPS pitch detection — more accurate than naive peak picking.
 * Multiplies downsampled spectra to emphasize fundamentals.
 */
export function detectPitchHPS(
  mag: Float32Array,
  sampleRate: number,
  fftSize: number,
  minFreq = 65,
  maxFreq = 2093,
  numHarmonics = 3
): number {
  const binMin = Math.ceil(minFreq * fftSize / sampleRate);
  const binMax = Math.min(
    Math.floor(maxFreq * fftSize / sampleRate),
    Math.floor(mag.length / numHarmonics) - 1
  );
  if (binMax <= binMin) return -1;

  let bestBin = binMin;
  let bestScore = 0;
  for (let bin = binMin; bin <= binMax; bin++) {
    let score = mag[bin];
    for (let h = 2; h <= numHarmonics; h++) {
      score *= mag[Math.min(mag.length - 1, bin * h)];
    }
    if (score > bestScore) { bestScore = score; bestBin = bin; }
  }

  // Parabolic interpolation for sub-bin accuracy
  const y0 = bestBin > 0 ? mag[bestBin - 1] : mag[bestBin];
  const y1 = mag[bestBin];
  const y2 = bestBin < mag.length - 1 ? mag[bestBin + 1] : mag[bestBin];
  const denom = y0 - 2 * y1 + y2;
  const correction = denom !== 0 ? 0.5 * (y0 - y2) / denom : 0;
  return ((bestBin + correction) * sampleRate) / fftSize;
}

/**
 * Find top N pitch candidates (for chord/multi-pitch heatmap).
 * Filters out harmonics so only fundamentals are returned.
 */
export function findTopPitches(
  mag: Float32Array,
  sampleRate: number,
  fftSize: number,
  minFreq = 65,
  maxFreq = 2093,
  topN = 3
): Array<{ freq: number; strength: number }> {
  const binMin = Math.ceil(minFreq * fftSize / sampleRate);
  const binMax = Math.min(Math.floor(maxFreq * fftSize / sampleRate), mag.length - 2);

  // Collect local maxima
  const peaks: Array<{ bin: number; strength: number }> = [];
  for (let i = binMin + 1; i < binMax; i++) {
    if (mag[i] > mag[i - 1] && mag[i] > mag[i + 1]) {
      peaks.push({ bin: i, strength: mag[i] });
    }
  }
  peaks.sort((a, b) => b.strength - a.strength);

  // Filter harmonics (remove peaks that are integer multiples of a stronger peak)
  const filtered: typeof peaks = [];
  for (const peak of peaks.slice(0, topN * 4)) {
    const isHarmonic = filtered.some(ref => {
      const ratio = peak.bin / ref.bin;
      return Math.abs(ratio - Math.round(ratio)) < 0.06 && Math.round(ratio) >= 2;
    });
    if (!isHarmonic) filtered.push(peak);
    if (filtered.length >= topN) break;
  }

  const maxStr = filtered[0]?.strength ?? 1;
  return filtered.map(p => ({
    freq: (p.bin * sampleRate) / fftSize,
    strength: p.strength / maxStr,
  }));
}

/** Temporal smoothing via moving average — removes isolated spurious notes */
export function smoothHeatmap(data: number[][], windowSize = 2): number[][] {
  const T = data.length;
  const N = data[0]?.length ?? 0;
  return Array.from({ length: T }, (_, t) =>
    Array.from({ length: N }, (_, n) => {
      let sum = 0, count = 0;
      for (let dt = -windowSize; dt <= windowSize; dt++) {
        const idx = t + dt;
        if (idx >= 0 && idx < T) { sum += data[idx][n]; count++; }
      }
      return sum / count;
    })
  );
}

export function freqToMidi(freq: number): number {
  return 69 + 12 * Math.log2(freq / 440);
}
