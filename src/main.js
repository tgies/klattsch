// Page-specific glue
import { compileString } from './engine/sequencer.js';
import { banks } from './engine/banks/index.js';

const BANK_STORAGE_KEY = 'klattsch.preferredBank';
function loadSelectedBank() {
  const saved = localStorage.getItem(BANK_STORAGE_KEY);
  return saved && banks.list().includes(saved) ? saved : banks.defaultName;
}
let selectedBank = loadSelectedBank();
import { encodeWav } from './engine/wav.js';

const seqInput   = document.getElementById('seq');
const speakBtn   = document.getElementById('speak');
const stopBtn    = document.getElementById('stop');
const renderBtn  = document.getElementById('render');
const videoBtn   = document.getElementById('render-video');
const shareBtn   = document.getElementById('share');
const submitBtn  = document.getElementById('submit-preset');
const filenameInput = document.getElementById('filename');
const videoTitleInput = document.getElementById('video-title');
const videoKaraokeInput = document.getElementById('video-karaoke');
const stateMirror = document.getElementById('state-mirror');
const stateDisplay = document.getElementById('state-display');
const insertStateBtn = document.getElementById('insert-state');
const playbackDisplay = document.getElementById('playback-display');
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
const tremoloSlider     = document.getElementById('tremolo');
const tremoloVal        = document.getElementById('tremoloval');
const tremoloRateSlider = document.getElementById('tremoloRate');
const tremoloRateVal    = document.getElementById('tremoloRateVal');
const aspSlider         = document.getElementById('aspiration');
const aspVal            = document.getElementById('aspval');
const tiltSlider        = document.getElementById('tilt');
const tiltVal           = document.getElementById('tiltval');
const effortSlider      = document.getElementById('effort');
const effortVal         = document.getElementById('effortval');
const volumeSlider      = document.getElementById('volume');
const volumeVal         = document.getElementById('volumeval');
const status            = document.getElementById('status');

let ctx = null;
let node = null;
let gainNode = null;
let audioInit = null;
let videoRender = null;

// Karaoke playback state
// fine for now but need to revisit the textarea overlay thing
const playback = {
  phrases: [],
  source: '',
  totalMs: 0,
  startedAt: 0,        // ctx.currentTime in seconds
  activeIndex: -1,
  rafId: 0,
  onUpdate: null,
};

function findActivePhrase(phrases, ms) {
  for (let i = 0; i < phrases.length; i++) {
    if (ms < phrases[i].tEndMs) return i;
  }
  return -1;
}

function notifyPlayback() {
  if (playback.onUpdate) playback.onUpdate(playback);
}

function startPlayback(phrases, source, totalMs) {
  stopPlayback();
  playback.phrases = phrases;
  playback.source = source;
  playback.totalMs = totalMs;
  playback.startedAt = ctx.currentTime;
  playback.activeIndex = phrases.length ? 0 : -1;
  notifyPlayback();
  if (!phrases.length) return;
  const tick = () => {
    if (!playback.phrases.length) { playback.rafId = 0; return; }
    const elapsedMs = (ctx.currentTime - playback.startedAt) * 1000;
    if (elapsedMs >= playback.totalMs) {
      playback.activeIndex = -1;
      playback.rafId = 0;
      notifyPlayback();
      return;
    }
    const idx = findActivePhrase(playback.phrases, elapsedMs);
    if (idx !== playback.activeIndex) {
      playback.activeIndex = idx;
      notifyPlayback();
    }
    playback.rafId = requestAnimationFrame(tick);
  };
  playback.rafId = requestAnimationFrame(tick);
}

function stopPlayback() {
  if (playback.rafId) cancelAnimationFrame(playback.rafId);
  playback.rafId = 0;
  if (playback.activeIndex !== -1) {
    playback.activeIndex = -1;
    notifyPlayback();
  }
}

function renderPlaybackDisplay() {
  stopBtn.disabled = playback.activeIndex < 0;
  if (!playback.source) {
    playbackDisplay.replaceChildren();
    return;
  }
  const idx = playback.activeIndex;
  const phr = idx >= 0 ? playback.phrases[idx] : null;
  const frag = document.createDocumentFragment();
  if (phr) {
    if (phr.srcStart > 0) {
      frag.appendChild(document.createTextNode(playback.source.slice(0, phr.srcStart)));
    }
    // split directives from the audible token
    const tokenStart = phr.tokenSrcStart ?? phr.srcStart;
    if (tokenStart > phr.srcStart) {
      const pre = document.createElement('span');
      pre.className = 'active-pre';
      pre.textContent = playback.source.slice(phr.srcStart, tokenStart);
      frag.appendChild(pre);
    }
    const span = document.createElement('span');
    span.className = 'active';
    span.textContent = playback.source.slice(tokenStart, phr.srcEnd);
    frag.appendChild(span);
    if (phr.srcEnd < playback.source.length) {
      frag.appendChild(document.createTextNode(playback.source.slice(phr.srcEnd)));
    }
    playbackDisplay.replaceChildren(frag);
    span.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
  } else {
    playbackDisplay.textContent = playback.source;
  }
}
playback.onUpdate = renderPlaybackDisplay;

stopBtn.addEventListener('click', () => {
  if (node) node.port.postMessage({ type: 'reset' });
  stopPlayback();
});

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
    gainNode = ctx.createGain();
    gainNode.gain.value = Number(volumeSlider.value);
    node.connect(gainNode);
    gainNode.connect(ctx.destination);
  })();
  return audioInit;
}

function filenameSlug(text) {
  const tokens = text.split(/\s+/).filter(t => /^[A-Z]+!?$/.test(t)).slice(0, 6);
  if (tokens.length === 0) return 'klattsch';
  return ('klattsch-' + tokens.join('-').toLowerCase()).slice(0, 50);
}

function exportBaseName(text) {
  const custom = filenameInput.value.trim();
  if (custom) return custom.replace(/[\/\\:*?"<>|]/g, '_').slice(0, 80);
  return filenameSlug(text);
}

function currentDirectives() {
  const parts = [];
  const f0 = Number(f0Slider.value);    if (f0 !== 120)   parts.push(`b${f0}`);
  const rate = Number(durSlider.value); if (rate !== 110) parts.push(`r${rate}`);
  const scale = Number(scaleSlider.value); if (scale !== 1) parts.push(`s${scale}`);
  const vib = Number(vibratoSlider.value); if (vib !== 0) parts.push(`v${vib}`);
  const vibR = Number(vibratoRateSlider.value); if (vibR !== 5) parts.push(`w${vibR}`);
  const trem = Number(tremoloSlider.value); if (trem !== 0) parts.push(`m${trem}`);
  const tremR = Number(tremoloRateSlider.value); if (tremR !== 5) parts.push(`n${tremR}`);
  const asp = Number(aspSlider.value); if (asp !== 0) parts.push(`h${asp}`);
  const tilt = Number(tiltSlider.value); if (tilt !== 0) parts.push(`t=${tilt}`);
  const eff = Number(effortSlider.value); if (eff !== 0.5) parts.push(`g${eff}`);
  return parts.join(' ');
}

function updateStateMirror() {
  const dirs = currentDirectives();
  if (dirs) {
    stateDisplay.textContent = dirs;
    stateDisplay.classList.remove('empty');
    insertStateBtn.disabled = false;
  } else {
    stateDisplay.textContent = '(all sliders at default)';
    stateDisplay.classList.add('empty');
    insertStateBtn.disabled = true;
  }
}

function compileOpts() {
  return {
    baseF0:       Number(f0Slider.value),
    rate:         Number(durSlider.value),
    scale:        Number(scaleSlider.value),
    vibratoDepth: Number(vibratoSlider.value),
    vibratoRate:  Number(vibratoRateSlider.value),
    tremoloDepth: Number(tremoloSlider.value),
    tremoloRate:  Number(tremoloRateSlider.value),
    aspiration:   Number(aspSlider.value),
    tilt:         Number(tiltSlider.value),
    effort:       Number(effortSlider.value),
    bank:         selectedBank,
  };
}

async function speak(text) {
  await ensureAudio();
  const { schedule, warnings, phrases, source, totalMs } = compileString(text, compileOpts());
  if (warnings.length) {
    setStatus(warnings.join(' '), 'warn');
  } else {
    setStatus('');
  }
  node.port.postMessage({ type: 'reset' });
  node.port.postMessage({ type: 'schedule', schedule });
  startPlayback(phrases, source, totalMs);
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
  const { bytes, gain } = encodeWav(rendered.getChannelData(0), sr, {
    metadata: {
      software: 'klattsch · https://tgies.github.io/klattsch',
      comment: text,
    },
  });

  const blob = new Blob([bytes], { type: 'audio/wav' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${exportBaseName(text)}.wav`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  const note = warnings.length ? ` (warnings: ${warnings.join('; ')})` : '';
  setStatus(`rendered ${(bytes.length/1024).toFixed(0)} KB, gain ${gain.toFixed(2)}x${note}`);
}

async function renderVideo(text) {
  setStatus('rendering video...');
  const ctrl = { cancelled: false, recorder: null, actx: null, canvas: null, raf: 0, resolveWait: null, timer: null };
  videoRender = ctrl;
  const W = 1280, H = 720;
  const FPS = 30;

  const { schedule, totalMs, warnings, phrases, source } = compileString(text, compileOpts());

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

  // Word-wrap the source into display lines
  function wrapWithRanges(c, src, maxW) {
    const out = [];
    let cursor = 0;
    for (const block of src.split('\n')) {
      const blockStart = cursor;
      const words = [];
      const re = /\S+/g;
      let m;
      while ((m = re.exec(block)) !== null) {
        words.push({ srcStart: blockStart + m.index, srcEnd: blockStart + m.index + m[0].length });
      }
      if (!words.length) {
        out.push({ text: '', srcStart: blockStart, srcEnd: blockStart });
        cursor += block.length + 1;
        continue;
      }
      let lineWords = [];
      const flush = () => {
        if (!lineWords.length) return;
        const s = lineWords[0].srcStart;
        const e = lineWords[lineWords.length - 1].srcEnd;
        out.push({ text: src.slice(s, e), srcStart: s, srcEnd: e });
        lineWords = [];
      };
      for (const w of words) {
        if (!lineWords.length) { lineWords.push(w); continue; }
        const candText = src.slice(lineWords[0].srcStart, w.srcEnd);
        if (c.measureText(candText).width > maxW) {
          flush();
          lineWords = [w];
        } else {
          lineWords.push(w);
        }
      }
      flush();
      cursor += block.length + 1;
    }
    return out;
  }

  // Compute layout once - source and font are fixed for the render's duration.
  cctx.font = 'bold 26px ui-monospace, "Cascadia Code", Consolas, monospace';
  const sourceLines = wrapWithRanges(cctx, source, W - 24 * 2);

  // Smooth scroll state, yTop snaps to the active line's position
  // lerp easing
  let scrollY = null;
  let scrollLastT = 0;
  const SCROLL_TAU = 0.15;

  function compose() {
    cctx.drawImage(spec, 0, 0);

    // blend in subtitle backplate thing
    cctx.save();
    const bp = cctx.createLinearGradient(0, H * 0.45, 0, H);
    bp.addColorStop(0, 'rgba(0, 0, 0, 0)');
    bp.addColorStop(0.5, 'rgba(0, 0, 0, 0.32)');
    bp.addColorStop(1, 'rgba(0, 0, 0, 0.62)');
    cctx.fillStyle = bp;
    cctx.fillRect(0, Math.floor(H * 0.45), W, Math.ceil(H * 0.55));
    cctx.restore();

    cctx.save();
    cctx.font = 'bold 26px ui-monospace, "Cascadia Code", Consolas, monospace';
    cctx.textBaseline = 'top';
    const pad = 24;
    const lh = 34;

    const elapsedMs = performance.now() - t0;
    const karaoke = videoKaraokeInput.checked;
    const activeIdx = karaoke ? findActivePhrase(phrases, elapsedMs) : -1;
    const activePhr = activeIdx >= 0 ? phrases[activeIdx] : null;

    // Find which source-line contains the active phrase so we can pin it
    let activeLineIdx = -1;
    if (activePhr) {
      for (let li = 0; li < sourceLines.length; li++) {
        const ln = sourceLines[li];
        if (activePhr.srcStart >= ln.srcStart && activePhr.srcStart <= ln.srcEnd) {
          activeLineIdx = li;
          break;
        }
      }
    }

    // adapt pinning position to line structure of source
    const pinY = sourceLines.length > 1 ? H - 220 : H - 80;
    const targetY = activeLineIdx >= 0
      ? pinY - activeLineIdx * lh
      : H - sourceLines.length * lh - pad;

    const now = performance.now();
    const dt = scrollLastT ? Math.min(0.1, (now - scrollLastT) / 1000) : 0;
    scrollLastT = now;
    if (scrollY === null) scrollY = targetY;
    else scrollY += (targetY - scrollY) * (1 - Math.exp(-dt / SCROLL_TAU));
    const yTop = scrollY;

    const fadeStart = 130;
    const fadeEnd = 50;

    for (let li = 0; li < sourceLines.length; li++) {
      const ln = sourceLines[li];
      const y = yTop + li * lh;
      if (y < -lh || y > H) continue;

      let alpha = 0.55;
      if (y < fadeStart) {
        alpha *= Math.max(0, Math.min(1, (y - fadeEnd) / (fadeStart - fadeEnd)));
      }

      let tokenX = 0, tokenW = 0, tokenStart = 0, tokenEnd = 0;
      if (activePhr) {
        const phStart = Math.max(activePhr.srcStart, ln.srcStart);
        const phEnd = Math.min(activePhr.srcEnd, ln.srcEnd);
        if (phStart < phEnd) {
          const tStart = activePhr.tokenSrcStart ?? activePhr.srcStart;
          // Prefix portion (directives/whitespace leading up to the token)
          const preStart = phStart;
          const preEnd = Math.max(phStart, Math.min(phEnd, tStart));
          if (preStart < preEnd) {
            const beforeText = ln.text.slice(0, preStart - ln.srcStart);
            const preText = ln.text.slice(preStart - ln.srcStart, preEnd - ln.srcStart);
            const px = pad + cctx.measureText(beforeText).width;
            const pw = cctx.measureText(preText).width;
            cctx.globalAlpha = Math.max(alpha, 0.45);
            cctx.fillStyle = 'rgba(255, 106, 0, 0.32)';
            cctx.fillRect(px - 2, y - 2, pw + 4, lh - 6);
          }
          // Token portion (the sound itself)
          tokenStart = Math.max(phStart, tStart);
          tokenEnd = phEnd;
          if (tokenStart < tokenEnd) {
            const beforeText = ln.text.slice(0, tokenStart - ln.srcStart);
            const ovText = ln.text.slice(tokenStart - ln.srcStart, tokenEnd - ln.srcStart);
            tokenX = pad + cctx.measureText(beforeText).width;
            tokenW = cctx.measureText(ovText).width;
            cctx.globalAlpha = Math.max(alpha, 0.9);
            cctx.fillStyle = '#ff6a00';
            cctx.fillRect(tokenX - 4, y - 3, tokenW + 8, lh - 4);
            cctx.lineWidth = 1.5;
            cctx.strokeStyle = 'rgba(0, 0, 0, 0.85)';
            cctx.strokeRect(tokenX - 4, y - 3, tokenW + 8, lh - 4);
          }
        }
      }

      // drop shadow on non-active text
      cctx.shadowColor = 'rgba(0, 0, 0, 0.85)';
      cctx.shadowBlur = 4;
      cctx.shadowOffsetY = 1;
      cctx.globalAlpha = alpha;
      cctx.fillStyle = '#fff';
      cctx.fillText(ln.text, pad, y);
      cctx.shadowColor = 'transparent';
      cctx.shadowBlur = 0;
      cctx.shadowOffsetY = 0;

      if (tokenW > 0) {
        const ovText = ln.text.slice(tokenStart - ln.srcStart, tokenEnd - ln.srcStart);
        cctx.globalAlpha = 1;
        cctx.fillStyle = '#000';
        cctx.fillText(ovText, tokenX, y);
      }
    }
    cctx.restore();

    // Attribution watermark, top-right corner
    cctx.save();
    cctx.shadowColor = 'rgba(0, 0, 0, 0.85)';
    cctx.shadowBlur = 4;
    cctx.shadowOffsetY = 1;
    cctx.globalAlpha = 0.7;
    cctx.fillStyle = '#fff';
    cctx.font = '22px ui-monospace, "Cascadia Code", Consolas, monospace';
    cctx.textBaseline = 'top';
    cctx.textAlign = 'right';
    cctx.fillText('klattsch  ·  tgies.github.io/klattsch', W - 24, 24);
    cctx.restore();

    const titleText = videoTitleInput.value.trim();
    if (titleText) {
      cctx.save();
      cctx.shadowColor = 'rgba(0, 0, 0, 0.85)';
      cctx.shadowBlur = 4;
      cctx.shadowOffsetY = 1;
      cctx.globalAlpha = 0.7;
      cctx.fillStyle = '#fff';
      cctx.font = '22px ui-monospace, "Cascadia Code", Consolas, monospace';
      cctx.textBaseline = 'top';
      cctx.textAlign = 'left';
      cctx.fillText(titleText, 24, 24);
      cctx.restore();
    }
  }

  ctrl.recorder = recorder;
  ctrl.actx = actx;
  ctrl.canvas = canvas;
  recorder.start();
  const t0 = performance.now();
  let xLast = 0;

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
    if (!ctrl.cancelled && elapsed < totalMs + 200) ctrl.raf = requestAnimationFrame(loop);
  }
  loop();

  await new Promise(resolve => {
    ctrl.resolveWait = resolve;
    ctrl.timer = setTimeout(resolve, totalMs + 400);
  });
  if (ctrl.cancelled) return;
  if (ctrl.raf) cancelAnimationFrame(ctrl.raf);
  recorder.stop();
  await new Promise(r => recorder.onstop = r);
  actx.close();
  canvas.remove();

  const blob = new Blob(chunks, { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${exportBaseName(text)}.${ext}`;
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

const PHONEME_EXAMPLES = {
  IY: 's[ee]',  IH: 's[i]t',   EH: 's[e]t',    AE: 'c[a]t',    AA: 'sp[a]',
  AO: 'l[aw]',  AH: 'b[u]t',   UH: 'b[oo]k',   UW: 'b[oo]t',   ER: 'b[ir]d',
  AY: 'b[i]te', AW: 'n[ow]',   EY: 's[ay]',    OW: 'g[o]',     OY: 'b[oy]',
  W:  '[w]ay',  Y:  '[y]es',   R:  '[r]ed',    L:  '[l]et',    M:  '[m]e',
  N:  '[n]o',   NG: 'si[ng]',  F:  '[f]ee',    TH: '[th]in',   S:  '[s]ee',
  SH: '[sh]e',  V:  '[v]ee',   DH: '[th]is',   Z:  '[z]oo',    ZH: 'vi[s]ion',
  HH: '[h]e',   P:  '[p]ea',   B:  '[b]ee',    T:  '[t]ea',    D:  '[d]ee',
  K:  '[k]ey',  G:  '[g]o',    CH: '[ch]eese', JH: '[j]udge',
};

function buildExampleSpan(s) {
  const frag = document.createDocumentFragment();
  for (const part of s.split(/(\[[^\]]+\])/)) {
    if (!part) continue;
    if (part.startsWith('[') && part.endsWith(']')) {
      const hi = document.createElement('span');
      hi.className = 'hi';
      hi.textContent = part.slice(1, -1);
      frag.appendChild(hi);
    } else {
      frag.appendChild(document.createTextNode(part));
    }
  }
  return frag;
}

function buildPhonemeButtons() {
  phonemesDiv.replaceChildren();
  const resolved = banks.get(selectedBank) ?? banks.get(banks.defaultName);
  const codes = Object.keys(resolved.phonemes).filter((k) => !k.startsWith('_'));
  for (const code of codes) {
    const b = document.createElement('button');
    const codeSpan = document.createElement('div');
    codeSpan.className = 'phoneme-code';
    codeSpan.textContent = code;
    const exSpan = document.createElement('div');
    exSpan.className = 'phoneme-example';
    const example = PHONEME_EXAMPLES[code] ?? resolved.phonemes[code]?.example ?? '';
    exSpan.appendChild(buildExampleSpan(example));
    b.appendChild(codeSpan);
    b.appendChild(exSpan);
    b.addEventListener('click', () => speak(code));
    phonemesDiv.appendChild(b);
  }
}

function buildBankSelect() {
  const sel = document.getElementById('bank-select');
  if (!sel) return;
  sel.replaceChildren();
  for (const name of banks.list()) {
    const opt = document.createElement('option');
    opt.value = name;
    opt.textContent = `${name} - ${banks.get(name).displayName}`;
    if (name === selectedBank) opt.selected = true;
    sel.appendChild(opt);
  }
  sel.addEventListener('change', () => {
    selectedBank = sel.value;
    localStorage.setItem(BANK_STORAGE_KEY, selectedBank);
    buildPhonemeButtons();
    updateBankHint();
  });
  updateBankHint();
}

function updateBankHint() {
  const hint = document.getElementById('bank-hint');
  if (!hint) return;
  hint.textContent = `mid-utterance: [bank=${selectedBank}] / [bank] resets`;
}

buildPhonemeButtons();
buildBankSelect();

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
function cancelVideoRender() {
  if (!videoRender) return;
  const c = videoRender;
  c.cancelled = true;
  if (c.timer) clearTimeout(c.timer);
  if (c.raf) cancelAnimationFrame(c.raf);
  try { c.recorder?.stop(); } catch {}
  try { c.actx?.close(); } catch {}
  c.canvas?.remove();
  if (c.resolveWait) c.resolveWait();
  setStatus('cancelled', 'warn');
}

videoBtn.addEventListener('click', () => {
  if (videoRender) {
    cancelVideoRender();
    videoBtn.textContent = 'render video';
    videoRender = null;
    return;
  }
  videoBtn.textContent = 'cancel';
  renderVideo(seqInput.value)
    .catch(err => {
      console.error(err);
      setStatus('video render failed: ' + err.message, 'warn');
    })
    .finally(() => {
      videoBtn.textContent = 'render video';
      videoRender = null;
    });
});

document.addEventListener('click', (e) => {
  if (e.target.closest('button')) seqInput.focus();
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

async function compressSeq(str) {
  const stream = new Response(str).body
    .pipeThrough(new CompressionStream('deflate-raw'));
  const buf = new Uint8Array(await new Response(stream).arrayBuffer());
  let s = '';
  for (let i = 0; i < buf.length; i++) s += String.fromCharCode(buf[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function decompressSeq(b64) {
  const pad = b64.length % 4;
  const padded = b64.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat(pad ? 4 - pad : 0);
  const bin = Uint8Array.from(atob(padded), c => c.charCodeAt(0));
  const stream = new Response(bin).body
    .pipeThrough(new DecompressionStream('deflate-raw'));
  return await new Response(stream).text();
}

const STORAGE_KEY = 'klattsch.seq';
let saveDebounce;
seqInput.addEventListener('input', () => {
  clearTimeout(saveDebounce);
  saveDebounce = setTimeout(() => {
    try { localStorage.setItem(STORAGE_KEY, seqInput.value); } catch {}
  }, 400);
});

(async () => {
  const params = new URLSearchParams(window.location.search);
  const z = params.get('z');
  const seq = params.get('seq');
  if (z) {
    try {
      seqInput.value = await decompressSeq(z);
    } catch (err) {
      console.error('decompress failed:', err);
      setStatus('shared link could not be decoded', 'warn');
    }
  } else if (seq) {
    seqInput.value = seq;
  } else {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) seqInput.value = saved;
    } catch {}
  }
})();

shareBtn.addEventListener('click', async () => {
  try {
    const text = seqInput.value;
    const z = await compressSeq(text);
    const base = window.location.origin + window.location.pathname;
    const urlZ = new URL(base); urlZ.searchParams.set('z', z);
    const urlSeq = new URL(base); urlSeq.searchParams.set('seq', text);
    const link = urlZ.toString().length < urlSeq.toString().length
      ? urlZ.toString()
      : urlSeq.toString();
    await navigator.clipboard.writeText(link);
    setStatus(`share link copied (${link.length} chars)`);
  } catch (err) {
    console.error(err);
    setStatus('share failed: ' + err.message, 'warn');
  }
});

const changelogLink = document.getElementById('changelog-link');
const changelogDialog = document.getElementById('changelog-dialog');
if (changelogLink && changelogDialog) {
  const closeBtn = changelogDialog.querySelector('.changelog-close');
  changelogLink.addEventListener('click', (e) => {
    e.preventDefault();
    changelogDialog.showModal();
  });
  closeBtn?.addEventListener('click', () => changelogDialog.close());
  changelogDialog.addEventListener('click', (e) => {
    // backdrop click closes
    const r = changelogDialog.getBoundingClientRect();
    if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) {
      changelogDialog.close();
    }
  });
}

submitBtn.addEventListener('click', (e) => {
  e.preventDefault();
  const body =
    '## label\n\n\n\n## phoneme string\n\n```\n' +
    seqInput.value +
    '\n```\n\n## what it is\n\n\n\n## credit\n\n';
  const url = `https://github.com/tgies/klattsch/issues/new?template=preset.md&body=${encodeURIComponent(body)}`;
  window.open(url, '_blank', 'noopener');
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
tremoloSlider.addEventListener('input', () => {
  tremoloVal.textContent = Number(tremoloSlider.value).toFixed(2);
});
tremoloRateSlider.addEventListener('input', () => {
  tremoloRateVal.textContent = Number(tremoloRateSlider.value).toFixed(1);
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
volumeSlider.addEventListener('input', () => {
  volumeVal.textContent = Number(volumeSlider.value).toFixed(2);
  if (gainNode) gainNode.gain.value = Number(volumeSlider.value);
});

[f0Slider, durSlider, scaleSlider, vibratoSlider, vibratoRateSlider,
 tremoloSlider, tremoloRateSlider, aspSlider, tiltSlider, effortSlider]
  .forEach(s => s.addEventListener('input', updateStateMirror));

insertStateBtn.addEventListener('click', () => {
  const dirs = currentDirectives();
  if (!dirs) return;
  seqInput.value = dirs + ' ' + seqInput.value.replace(/^\s+/, '');
  seqInput.dispatchEvent(new Event('input'));
  seqInput.focus();
});

updateStateMirror();

const CONSENT_KEY = 'klattsch.analytics-consent';
function gtagSafe(...args) {
  if (typeof window.gtag === 'function') window.gtag(...args);
}
function updateAnalyticsConsent(granted) {
  gtagSafe('consent', 'update', {
    analytics_storage: granted ? 'granted' : 'denied',
    ad_storage: granted ? 'granted' : 'denied',
    ad_user_data: granted ? 'granted' : 'denied',
    ad_personalization: granted ? 'granted' : 'denied',
  });
}
function getConsent() {
  try {
    const v = localStorage.getItem(CONSENT_KEY);
    if (v === 'true') return true;
    if (v === 'false') return false;
  } catch {}
  return null;
}
function setConsent(granted) {
  try { localStorage.setItem(CONSENT_KEY, String(granted)); } catch {}
  updateAnalyticsConsent(granted);
}

const consentBanner = document.getElementById('cookie-consent');
const initialConsent = getConsent();
if (initialConsent === true) {
  updateAnalyticsConsent(true);
} else if (initialConsent === null && consentBanner) {
  consentBanner.hidden = false;
}
document.getElementById('cookie-accept')?.addEventListener('click', () => {
  setConsent(true);
  if (consentBanner) consentBanner.hidden = true;
});
document.getElementById('cookie-decline')?.addEventListener('click', () => {
  setConsent(false);
  if (consentBanner) consentBanner.hidden = true;
});
