// Page-specific glue
import { compileString } from './engine/sequencer.js';
import { PHONEME_KEYS } from './engine/phonemes.js';
import { encodeWav } from './engine/wav.js';

const startBtn   = document.getElementById('start');
const mainSection = document.getElementById('main');
const seqInput   = document.getElementById('seq');
const speakBtn   = document.getElementById('speak');
const renderBtn  = document.getElementById('render');
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

async function startAudio() {
  ctx = new AudioContext();
  await ctx.audioWorklet.addModule('src/formant-worklet.js');
  node = new AudioWorkletNode(ctx, 'formant-processor', {
    numberOfOutputs: 1,
    outputChannelCount: [1],
  });
  node.connect(ctx.destination);
  startBtn.hidden = true;
  mainSection.hidden = false;
  buildPhonemeButtons();
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

function speak(text) {
  if (!node) return;
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

startBtn.addEventListener('click', () => {
  startAudio().catch(err => {
    console.error(err);
    startBtn.textContent = 'audio failed - see console';
  });
});

speakBtn.addEventListener('click', () => speak(seqInput.value));
renderBtn.addEventListener('click', () => {
  renderWav(seqInput.value).catch(err => {
    console.error(err);
    setStatus('render failed: ' + err.message, 'warn');
  });
});

// Enter submits, shift-enter newline
seqInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    speak(seqInput.value);
  }
});

document.querySelectorAll('button.canned').forEach(b => {
  b.addEventListener('click', () => {
    const seq = b.dataset.seq;
    seqInput.value = seq;
    speak(seq);
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
