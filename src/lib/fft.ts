/**
 * fft.ts — Cooley-Tukey radix-2 FFT
 * In-place transform on real[] and imag[] arrays (length must be power of 2)
 */

export function fft(real: number[], imag: number[]): void {
  const n = real.length;
  if (n <= 1) return;

  // Bit-reversal permutation
  let j = 0;
  for (let i = 1; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [real[i], real[j]] = [real[j], real[i]];
      [imag[i], imag[j]] = [imag[j], imag[i]];
    }
  }

  // Butterfly operations
  for (let len = 2; len <= n; len <<= 1) {
    const angle = (-2 * Math.PI) / len;
    const wReal = Math.cos(angle);
    const wImag = Math.sin(angle);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const uR = real[i + k];
        const uI = imag[i + k];
        const vR = real[i + k + len / 2] * cr - imag[i + k + len / 2] * ci;
        const vI = real[i + k + len / 2] * ci + imag[i + k + len / 2] * cr;
        real[i + k]           = uR + vR;
        imag[i + k]           = uI + vI;
        real[i + k + len / 2] = uR - vR;
        imag[i + k + len / 2] = uI - vI;
        const newCr = cr * wReal - ci * wImag;
        ci = cr * wImag + ci * wReal;
        cr = newCr;
      }
    }
  }
}

/** Apply Hann window to a sample array */
export function applyHannWindow(samples: Float32Array): Float32Array {
  const n = samples.length;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const w = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (n - 1)));
    out[i] = samples[i] * w;
  }
  return out;
}

/** Apply Hamming window */
export function applyHammingWindow(samples: Float32Array): Float32Array {
  const n = samples.length;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const w = 0.54 - 0.46 * Math.cos((2 * Math.PI * i) / (n - 1));
    out[i] = samples[i] * w;
  }
  return out;
}

/** Apply Blackman window */
export function applyBlackmanWindow(samples: Float32Array): Float32Array {
  const n = samples.length;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const w =
      0.42 -
      0.5 * Math.cos((2 * Math.PI * i) / (n - 1)) +
      0.08 * Math.cos((4 * Math.PI * i) / (n - 1));
    out[i] = samples[i] * w;
  }
  return out;
}

/** Compute magnitude spectrum from real+imag FFT output */
export function magnitudeSpectrum(real: number[], imag: number[]): Float32Array {
  const half = real.length / 2;
  const mag = new Float32Array(half);
  for (let i = 0; i < half; i++) {
    mag[i] = Math.sqrt(real[i] * real[i] + imag[i] * imag[i]);
  }
  return mag;
}

/** Convert linear magnitude to dB */
export function toDecibels(mag: Float32Array, minDb = -80): Float32Array {
  const db = new Float32Array(mag.length);
  for (let i = 0; i < mag.length; i++) {
    db[i] = mag[i] > 0 ? Math.max(minDb, 20 * Math.log10(mag[i])) : minDb;
  }
  return db;
}
