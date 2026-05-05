// Minimal RIFF/WAVE encoder w/ normalization. Optionally embeds a LIST INFO
// chunk after the data chunk with ISFT (software identifier) and ICMT (free-form
// comment, used here to round-trip the source utterance string).

function buildInfoChunk(metadata) {
  const enc = new TextEncoder();
  const subs = [];
  if (metadata.software) subs.push({ id: 'ISFT', data: enc.encode(metadata.software) });
  if (metadata.comment)  subs.push({ id: 'ICMT', data: enc.encode(metadata.comment) });
  if (!subs.length) return null;
  // LIST payload = 'INFO' fourcc (4 bytes) + each sub-chunk (8-byte header
  // + data + 1 byte of padding to keep chunks word-aligned when odd-sized).
  let payloadSize = 4;
  for (const s of subs) payloadSize += 8 + s.data.length + (s.data.length % 2);
  const out = new Uint8Array(8 + payloadSize);
  const dv = new DataView(out.buffer);
  let o = 0;
  out.set([0x4C, 0x49, 0x53, 0x54], o); o += 4;
  dv.setUint32(o, payloadSize, true); o += 4;
  out.set([0x49, 0x4E, 0x46, 0x4F], o); o += 4;
  for (const s of subs) {
    for (let i = 0; i < 4; i++) out[o + i] = s.id.charCodeAt(i);
    o += 4;
    dv.setUint32(o, s.data.length, true); o += 4;
    out.set(s.data, o);
    o += s.data.length + (s.data.length % 2);
  }
  return out;
}

export function encodeWav(float32, sampleRate, { peakNormalize = 0.95, metadata = null } = {}) {
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
  const infoBytes = metadata ? buildInfoChunk(metadata) : null;
  const totalSize = 44 + dataBytes + (infoBytes ? infoBytes.length : 0);
  const buf = new ArrayBuffer(totalSize);
  const view = new DataView(buf);
  const u8 = new Uint8Array(buf);

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

  if (infoBytes) u8.set(infoBytes, 44 + dataBytes);

  return { bytes: new Uint8Array(buf), gain };
}
