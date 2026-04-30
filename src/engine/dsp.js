// Low-level DSP primitives used by the formant synth core.

// Constant-skirt-gain bandpass biquad (RBJ Audio EQ Cookbook)
// Coefficients are recomputed only when frequency or bandwidth changes
export class BandpassBiquad {
  constructor() {
    this.x1 = 0; this.x2 = 0;
    this.y1 = 0; this.y2 = 0;
    this.b0 = 0; this.b1 = 0; this.b2 = 0;
    this.a1 = 0; this.a2 = 0;
    this.lastF = -1; this.lastBW = -1;
  }
  setFreq(f, bw, sr) {
    if (f === this.lastF && bw === this.lastBW) return;
    this.lastF = f; this.lastBW = bw;
    f = Math.max(40, Math.min(sr * 0.45, f));
    bw = Math.max(20, bw);
    const w0 = 2 * Math.PI * f / sr;
    const cosw0 = Math.cos(w0);
    const sinw0 = Math.sin(w0);
    const Q = f / bw;
    const alpha = sinw0 / (2 * Q);
    const a0 = 1 + alpha;
    this.b0 =  alpha / a0;
    this.b1 =  0;
    this.b2 = -alpha / a0;
    this.a1 = -2 * cosw0 / a0;
    this.a2 = (1 - alpha) / a0;
  }
  process(x) {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2
            - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1; this.x1 = x;
    this.y2 = this.y1; this.y1 = y;
    return y;
  }
}

// Derivative of the Rosenberg glottal pulse. Phase normalized to [0, 1).
// Peak |value| is pi / (2·Tn) ~= 9.82, so we divide by 10 to keep amplitude
// near unity.
//
// `effort` (0..1) controls the pulse shape: 0 is lax/breathy (longer Tp,
// gentler closure), 1 is tense (shorter Tp, sharper closure)
export function glottalPulse(phase, effort = 0.5) {
  const e = effort < 0 ? 0 : effort > 1 ? 1 : effort;
  const Tp = 0.5 - e * 0.2;     // 0.5 (lax) -> 0.3 (tense)
  const Tn = 0.25 - e * 0.17;   // 0.25 (lax) -> 0.08 (tense)
  const NORM = 0.1;
  if (phase < Tp) {
    return NORM * 0.5 * (Math.PI / Tp) * Math.sin(Math.PI * phase / Tp);
  }
  if (phase < Tp + Tn) {
    return -NORM * (Math.PI / (2 * Tn)) * Math.sin(Math.PI * (phase - Tp) / (2 * Tn));
  }
  return 0;
}

// 32-bit xorshift LFSR
export function xorshift(state) {
  let x = state | 0;
  x ^= x << 13;
  x ^= x >>> 17;
  x ^= x << 5;
  return x | 0;
}

// Soft-clip with a linear region up to ±0.85 and a smooth knee
export function softClip(x) {
  const T = 0.85;
  const a = x < 0 ? -x : x;
  if (a <= T) return x;
  const sign = x < 0 ? -1 : 1;
  const excess = a - T;
  return sign * (T + (1 - T) * excess / (excess + 1));
}
