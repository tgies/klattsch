// Public surface of the klattsch synthesis engine
//
// Typical usage:
//
//   import { compileString, FormantSynth, encodeWav } from './engine/index.js';
//   const sr = 48000;
//   const { schedule, totalMs } = compileString("HH AH L OW");
//   const synth = new FormantSynth({ sampleRate: sr, schedule });
//   const buf = new Float32Array(Math.ceil(totalMs * sr / 1000));
//   synth.process(buf);
//   const { bytes } = encodeWav(buf, sr);
//   // ...write bytes to a .wav file
//
//   ./dsp.js          - low-level biquad/glottal/noise/softclip
//   ./synth-core.js   - FormantSynth class
//   ./phonemes.js     - ARPABET phoneme parameter table
//   ./sequencer.js    - text-to-schedule compiler
//   ./wav.js          - WAV encoder

export { BandpassBiquad, glottalPulse, xorshift, softClip } from './dsp.js';
export { FormantSynth, PARAMS, DEFAULT, renderToBuffer } from './synth-core.js';
export { phonemes, PHONEME_KEYS } from './phonemes.js';
export { tokenize, compile, compileString } from './sequencer.js';
export { encodeWav } from './wav.js';
