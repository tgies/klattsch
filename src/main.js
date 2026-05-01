// Page-specific glue
import { compileString } from './engine/sequencer.js';
import { PHONEME_KEYS } from './engine/phonemes.js';
import { encodeWav } from './engine/wav.js';

const seqInput   = document.getElementById('seq');
const speakBtn   = document.getElementById('speak');
const renderBtn  = document.getElementById('render');
const videoBtn   = document.getElementById('render-video');
const phonemesDiv = document.getElementById('phonemes');
const f0Slider          = document.getElementById('f0');
const f0Val             = document.getElementById('f0val');
const durSlider         = document.getElementById('dur');
const durVal            = document.getElementById('durval');
const scaleSlider       = document.getElementById('scale');
const scaleVal          = document.getElementById('scaleval');
const vibratoSlider     = document.getElementById('vibrato');
const vibratoVal        = document.getElementById('vibratoval');
const vibratoRateSlider = document.getElementById('vibratoRate');
const vibratoRateVal    = document.getElementById('vibratoRateVal');
const aspSlider         = document.getElementById('aspiration');
const aspVal            = document.getElementById('aspval');
const tiltSlider        = document.getElementById('tilt');
const tiltVal           = document.getElementById('tiltval');
const effortSlider      = document.getElementById('effort');
const effortVal         = document.getElementById('effortval');
const status            = document.getElementById('status');

let ctx = null;
let node = null;
let audioInit = null;

// Lazy init: AudioContext can only start on a user gesture, so we wait
// for the first interaction (speak / canned / phoneme button / Enter).
function ensureAudio() {
  if (audioInit) return audioInit;
  audioInit = (async () => {
    ctx = new AudioContext();
    await ctx.audioWorklet.addModule('src/formant-worklet.js');
    node = new AudioWorkletNode(ctx, 'formant-processor', {
      numberOfOutputs: 1,
      outputChannelCount: [1],
    });
    node.connect(ctx.destination);
  })();
  return audioInit;
}

function compileOpts() {
  return {
    baseF0:       Number(f0Slider.value),
    rate:         Number(durSlider.value),
    scale:        Number(scaleSlider.value),
    vibratoDepth: Number(vibratoSlider.value),
    vibratoRate:  Number(vibratoRateSlider.value),
    aspiration:   Number(aspSlider.value),
    tilt:         Number(tiltSlider.value),
    effort:       Number(effortSlider.value),
  };
}

async function speak(text) {
  await ensureAudio();
  const { schedule, warnings } = compileString(text, compileOpts());
  if (warnings.length) {
    setStatus(warnings.join(' '), 'warn');
  } else {
    setStatus('');
  }
  node.port.postMessage({ type: 'schedule', schedule });
}

async function renderWav(text) {
  setStatus('rendering...');
  const sr = 48000;
  const { schedule, totalMs, warnings } = compileString(text, compileOpts());
  const offline = new OfflineAudioContext(1, Math.ceil(totalMs * sr / 1000), sr);
  await offline.audioWorklet.addModule('src/formant-worklet.js');
  const offNode = new AudioWorkletNode(offline, 'formant-processor', {
    numberOfOutputs: 1,
    outputChannelCount: [1],
    processorOptions: { schedule },
  });
  offNode.connect(offline.destination);
  const rendered = await offline.startRendering();
  const { bytes, gain } = encodeWav(rendered.getChannelData(0), sr);

  const blob = new Blob([bytes], { type: 'audio/wav' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `klattsch-${Date.now()}.wav`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  const note = warnings.length ? ` (warnings: ${warnings.join('; ')})` : '';
  setStatus(`rendered ${(bytes.length/1024).toFixed(0)} KB, gain ${gain.toFixed(2)}x${note}`);
}

async function renderVideo(text) {
  setStatus('rendering video...');
  const W = 1280, H = 720;
  const FPS = 30;

  const { schedule, totalMs, warnings } = compileString(text, compileOpts());

  // text is another canvas that gets recomposited every frame
  const spec = document.createElement('canvas');
  spec.width = W; spec.height = H;
  const sctx = spec.getContext('2d');
  sctx.fillStyle = '#141414';
  sctx.fillRect(0, 0, W, H);

  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  Object.assign(canvas.style, {
    position: 'fixed', bottom: '1rem', right: '1rem',
    width: '320px', height: 'auto',
    border: '1px solid #333', borderRadius: '3px',
    boxShadow: '0 4px 16px rgba(0,0,0,0.5)',
    background: '#141414',
    zIndex: 9999,
  });
  document.body.appendChild(canvas);
  const cctx = canvas.getContext('2d');

  const actx = new AudioContext();
  await actx.audioWorklet.addModule('src/formant-worklet.js');
  const synth = new AudioWorkletNode(actx, 'formant-processor', {
    numberOfOutputs: 1, outputChannelCount: [1],
    processorOptions: { schedule },
  });
  const analyser = actx.createAnalyser();
  analyser.fftSize = 2048;
  analyser.smoothingTimeConstant = 0.3;
  analyser.minDecibels = -90;
  analyser.maxDecibels = -25;
  const dest = actx.createMediaStreamDestination();
  synth.connect(analyser);
  analyser.connect(dest);
  analyser.connect(actx.destination);  // also play through speakers

  const stream = new MediaStream([
    ...canvas.captureStream(FPS).getVideoTracks(),
    ...dest.stream.getAudioTracks(),
  ]);

  const mimeCandidates = [
    'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
    'video/mp4;codecs=avc1,mp4a',
    'video/mp4',
    'video/webm;codecs=vp9,opus',
    'video/webm',
  ];
  const mimeType = mimeCandidates.find(m => MediaRecorder.isTypeSupported(m)) || 'video/webm';
  const ext = mimeType.startsWith('video/mp4') ? 'mp4' : 'webm';
  const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 2_500_000 });
  const chunks = [];
  recorder.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };

  const freq = new Float32Array(analyser.frequencyBinCount);

  const fMin = 60, fMax = 8000;
  const lnMin = Math.log(fMin), lnRange = Math.log(fMax) - lnMin;
  const yToBinF = new Float32Array(H);
  for (let y = 0; y < H; y++) {
    const t = 1 - y / H;  // top of canvas = high freq, bottom = low freq
    const f = Math.exp(lnMin + lnRange * t);
    yToBinF[y] = Math.min(freq.length - 1.001, f * analyser.fftSize / actx.sampleRate);
  }

  const infernoStops = [
    [0, 0, 4], [40, 11, 84], [101, 21, 110], [159, 42, 99],
    [212, 72, 66], [245, 125, 21], [250, 193, 39], [252, 255, 164],
  ];
  const colorLUT = new Uint8Array(256 * 3);
  for (let i = 0; i < 256; i++) {
    const t = Math.pow(i / 255, 0.7);
    const f = t * (infernoStops.length - 1);
    const ii = Math.min(infernoStops.length - 2, Math.floor(f));
    const fr = f - ii;
    const a = infernoStops[ii], b = infernoStops[ii + 1];
    colorLUT[i * 3]     = a[0] + (b[0] - a[0]) * fr;
    colorLUT[i * 3 + 1] = a[1] + (b[1] - a[1]) * fr;
    colorLUT[i * 3 + 2] = a[2] + (b[2] - a[2]) * fr;
  }

  const MAX_CW = 32;
  const colImg = sctx.createImageData(MAX_CW, H);
  const colPx = colImg.data;
  for (let i = 3; i < colPx.length; i += 4) colPx[i] = 255;

  const minDb = analyser.minDecibels;
  const dbRange = analyser.maxDecibels - minDb;

  function wrapText(c, t, maxW) {
    const words = t.split(/\s+/);
    const lines = []; let cur = '';
    for (const w of words) {
      const tt = cur ? cur + ' ' + w : w;
      if (c.measureText(tt).width > maxW) {
        if (cur) lines.push(cur);
        cur = w;
      } else { cur = tt; }
    }
    if (cur) lines.push(cur);
    return lines;
  }

  function compose() {
    cctx.drawImage(spec, 0, 0);

    // Phoneme string overlay along the bottom edge
    cctx.save();
    cctx.globalAlpha = 0.5;
    cctx.fillStyle = '#fff';
    cctx.font = 'bold 26px ui-monospace, "Cascadia Code", Consolas, monospace';
    cctx.textBaseline = 'top';
    const pad = 24;
    const lines = wrapText(cctx, text, W - pad * 2);
    const lh = 34;
    let y = H - lines.length * lh - pad;
    for (const line of lines) {
      cctx.fillText(line, pad, y);
      y += lh;
    }
    cctx.restore();

    // Attribution watermark, top-right corner
    cctx.save();
    cctx.globalAlpha = 0.6;
    cctx.fillStyle = '#fff';
    cctx.font = '22px ui-monospace, "Cascadia Code", Consolas, monospace';
    cctx.textBaseline = 'top';
    cctx.textAlign = 'right';
    cctx.fillText('klattsch  ·  tgies.github.io/klattsch', W - 24, 24);
    cctx.restore();
  }

  recorder.start();
  const t0 = performance.now();
  let xLast = 0;
  let raf;

  function loop() {
    const elapsed = performance.now() - t0;
    const xNow = Math.min(W, (elapsed / totalMs) * W);
    if (xNow > xLast) {
      analyser.getFloatFrequencyData(freq);
      const cw = Math.min(MAX_CW, Math.max(1, Math.ceil(xNow - xLast)));
      for (let y = 0; y < H; y++) {
        const bf = yToBinF[y];
        const i = bf | 0;
        const frac = bf - i;
        const dB = freq[i] * (1 - frac) + freq[i + 1] * frac;
        const norm = dB <= minDb ? 0 : dB >= minDb + dbRange ? 1 : (dB - minDb) / dbRange;
        const ci = (norm * 255) | 0;
        const r = colorLUT[ci * 3];
        const g = colorLUT[ci * 3 + 1];
        const b = colorLUT[ci * 3 + 2];
        const rowBase = y * MAX_CW * 4;
        for (let x = 0; x < cw; x++) {
          const off = rowBase + x * 4;
          colPx[off] = r;
          colPx[off + 1] = g;
          colPx[off + 2] = b;
          // alpha is pre-filled to 255 once
        }
      }
      // dirty-rect, only write the cw columns we actually filled
      sctx.putImageData(colImg, Math.floor(xLast), 0, 0, 0, cw, H);
      xLast = xNow;
    }
    compose();
    if (elapsed < totalMs + 200) raf = requestAnimationFrame(loop);
  }
  loop();

  await new Promise(r => setTimeout(r, totalMs + 400));
  cancelAnimationFrame(raf);
  recorder.stop();
  await new Promise(r => recorder.onstop = r);
  actx.close();
  canvas.remove();

  const blob = new Blob(chunks, { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `klattsch-${Date.now()}.${ext}`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);

  const note = warnings.length ? ` (warnings: ${warnings.join('; ')})` : '';
  setStatus(`rendered ${(blob.size / 1024).toFixed(0)} KB .${ext}${note}`);
}

function setStatus(text, kind = '') {
  if (!status) return;
  status.textContent = text;
  status.className = kind;
}

function buildPhonemeButtons() {
  phonemesDiv.replaceChildren();
  for (const code of PHONEME_KEYS) {
    const b = document.createElement('button');
    b.textContent = code;
    b.addEventListener('click', () => speak(code));
    phonemesDiv.appendChild(b);
  }
}

buildPhonemeButtons();

function trySpeak(text) {
  speak(text).catch(err => {
    console.error(err);
    setStatus('audio failed: ' + err.message, 'warn');
  });
}

speakBtn.addEventListener('click', () => trySpeak(seqInput.value));
renderBtn.addEventListener('click', () => {
  renderWav(seqInput.value).catch(err => {
    console.error(err);
    setStatus('render failed: ' + err.message, 'warn');
  });
});
videoBtn.addEventListener('click', () => {
  renderVideo(seqInput.value).catch(err => {
    console.error(err);
    setStatus('video render failed: ' + err.message, 'warn');
  });
});

// Enter submits, shift-enter newline
seqInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    trySpeak(seqInput.value);
  }
});

document.querySelectorAll('button.canned').forEach(b => {
  b.addEventListener('click', () => {
    const seq = b.dataset.seq;
    seqInput.value = seq;
    trySpeak(seq);
  });
});

f0Slider.addEventListener('input', () => f0Val.textContent = f0Slider.value);
durSlider.addEventListener('input', () => durVal.textContent = durSlider.value);
scaleSlider.addEventListener('input', () => {
  scaleVal.textContent = Number(scaleSlider.value).toFixed(2);
});
vibratoSlider.addEventListener('input', () => {
  vibratoVal.textContent = Number(vibratoSlider.value).toFixed(1);
});
vibratoRateSlider.addEventListener('input', () => {
  vibratoRateVal.textContent = Number(vibratoRateSlider.value).toFixed(1);
});
aspSlider.addEventListener('input', () => {
  aspVal.textContent = Number(aspSlider.value).toFixed(2);
});
tiltSlider.addEventListener('input', () => {
  tiltVal.textContent = Number(tiltSlider.value).toFixed(2);
});
effortSlider.addEventListener('input', () => {
  effortVal.textContent = Number(effortSlider.value).toFixed(2);
});
