# klattsch

A primitive parallel-formant speech synthesizer in the browser. Late-70s / early-80s tier (Votrax, SAM).

The name is a portmanteau of *Klatt* (Dennis Klatt, the formant-synth pioneer) and *Klatsch* (German for gossip / casual chat).

[**Live demo**](https://tgies.github.io/klattsch/)

## What it does

You type a phoneme string in ARPABET, with optional directives, and the computer says it.

```
HH AH L OW                        hello, default voice
b140 HH AH L OW                   higher voice
bA3 HH AH L OW                    higher voice (note name)
AY+15 D IH D                      "I did" with a rising contour
D IH D DH AE(+40) T               "did THAT" with a transient pitch ornament on AE
r200 bC#4 ( HH AH ) ( L OW )      sung syllables, one note per group
```

See the in-app `syntax help` panel for the full directive table.

## Using the engine without the browser

```js
import { compileString, FormantSynth, encodeWav } from './src/engine/index.js';

const sampleRate = 48000;
const { schedule, totalMs } = compileString('HH AH L OW');
const synth = new FormantSynth({ sampleRate, schedule });
const buf = new Float32Array(Math.ceil(totalMs * sampleRate / 1000));
synth.process(buf);

const { bytes } = encodeWav(buf, sampleRate);
// write bytes to a .wav file
```

A standalone CLI that does exactly the above is included:

```bash
node bin/klattsch-render.mjs "HH AH L OW" hello.wav
```

## How it works

- **Excitation:** voiced source is a Rosenberg-style glottal pulse with a tunable open / closed quotient (`g` / "effort") and unvoiced source is xorshift noise. These are crossfaded by each phoneme's `voicing` parameter, with optional aspiration noise mixed in.
- **Filtering:** three parallel bandpass biquads for each formant.
- **Prosody:** the sequencer compiles phoneme strings into a time-stamped schedule of formant targets.
- **Voice character:** vibrato (depth + rate), aspiration / breathiness, spectral tilt, and glottal effort are all controllable.

## References

- Klatt, D. H. (1980). *Software for a cascade/parallel formant synthesizer.*
- Hillenbrand et al. (1995). *Acoustic characteristics of American English vowels.*
- Rosenberg, A. E. (1971). *Effect of glottal pulse shape on the quality of natural vowels.*
- Robinson, R. Bristow-Johnson. *Audio EQ Cookbook.*

## License

MIT
