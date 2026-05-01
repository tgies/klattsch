#!/usr/bin/env node
// Standalone WAV renderer
//
//   node bin/klattsch.mjs "HH AH L OW" hello.wav
//   node bin/klattsch.mjs "b140 AY+30 . AY-30" sweep.wav

import { writeFileSync } from 'node:fs';
import {
  compileString, FormantSynth, encodeWav,
} from '../src/engine/index.js';

const [, , text, outPath = 'klattsch.wav'] = process.argv;
if (!text) {
  console.error('usage: klattsch <phoneme-string> [output.wav]');
  console.error('  e.g. klattsch "HH AH L OW" hello.wav');
  process.exit(1);
}

const sampleRate = 48000;
const { schedule, totalMs, warnings } = compileString(text);
if (warnings.length) {
  console.error('warnings: ' + warnings.join(', '));
}

const synth = new FormantSynth({ sampleRate, schedule });
const buf = new Float32Array(Math.ceil(totalMs * sampleRate / 1000));
synth.process(buf);

const { bytes, gain } = encodeWav(buf, sampleRate);
writeFileSync(outPath, bytes);
console.error(
  `wrote ${outPath}: ${(bytes.length / 1024).toFixed(0)} KB, ` +
  `${(totalMs / 1000).toFixed(2)}s, normalize gain ${gain.toFixed(2)}x`
);
