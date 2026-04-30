// Minimal RIFF/WAVE encoder w/ normalization

export function encodeWav(float32, sampleRate, { peakNormalize = 0.95 } = {}) {
  let gain = 1;
  if (peakNormalize) {
    let peak = 0;
    for (let i = 0; i < float32.length; i++) {
      const a = float32[i] < 0 ? -float32[i] : float32[i];
      if (a > peak) peak = a;
    }
    if (peak > 0) gain = peakNormalize / peak;
  }

  const dataBytes = float32.length * 2;
  const totalSize = 44 + dataBytes;
  const buf = new ArrayBuffer(totalSize);
  const view = new DataView(buf);

  view.setUint32(0,  0x52494646, false);     // "RIFF"
  view.setUint32(4,  totalSize - 8, true);
  view.setUint32(8,  0x57415645, false);     // "WAVE"
  view.setUint32(12, 0x666d7420, false);     // "fmt "
  view.setUint32(16, 16, true);              // PCM fmt chunk size
  view.setUint16(20, 1, true);               // format = PCM
  view.setUint16(22, 1, true);               // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  view.setUint32(36, 0x64617461, false);     // "data"
  view.setUint32(40, dataBytes, true);

  const offset = 44;
  for (let i = 0; i < float32.length; i++) {
    let s = float32[i] * gain;
    if (s > 1) s = 1;
    else if (s < -1) s = -1;
    view.setInt16(offset + i * 2, Math.round(s * 32767), true);
  }

  return { bytes: new Uint8Array(buf), gain };
}
