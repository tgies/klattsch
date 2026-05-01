# klattsch

A primitive parallel-formant speech synthesizer in the browser. Late-70s / early-80s tier (Votrax, SAM).

The name is a portmanteau of *Klatt* (Dennis Klatt, the formant-synth pioneer) and *Klatsch* (German for gossip / casual chat).

[**Live demo**](https://tgies.github.io/klattsch/)

[**Commercial support**](#commercial-support) - integration consulting from the author

## What it does

You type a phoneme string in [ARPABET](https://en.wikipedia.org/wiki/ARPABET), with optional directives, and the computer says it.

```
HH AH L OW                        hello, default voice
b140 HH AH L OW                   higher voice
bA3 HH AH L OW                    higher voice (note name)
AY+15 D IH D                      "I did" with a rising contour
D IH D DH AE(+40) T               "did THAT" with a transient pitch ornament on AE
r200 bC#4 ( HH AH ) ( L OW )      sung syllables, one note per group
```

See the in-app `syntax help` panel for the full directive table.

## Installation

```bash
npm install klattsch
```

The same package works as a CLI, as an importable engine in Node, and as an embeddable engine + AudioWorklet in the browser. Zero runtime dependencies.

## Usage

### CLI

Render a phoneme string straight to a WAV file:

```bash
npx klattsch "HH AH L OW" hello.wav
```

### Node / `OfflineAudioContext`

```js
import { compileString, FormantSynth, encodeWav } from 'klattsch';

const sampleRate = 48000;
const { schedule, totalMs } = compileString('HH AH L OW');
const synth = new FormantSynth({ sampleRate, schedule });
const buf = new Float32Array(Math.ceil(totalMs * sampleRate / 1000));
synth.process(buf);

const { bytes } = encodeWav(buf, sampleRate);
// write bytes to a .wav file
```

### Browser with a bundler (Vite, webpack, esbuild, Rollup)

```js
import { compileString } from 'klattsch';
import workletUrl from 'klattsch/formant-worklet.js?url';

const ctx = new AudioContext();
await ctx.audioWorklet.addModule(workletUrl);
const node = new AudioWorkletNode(ctx, 'formant-processor');
node.connect(ctx.destination);

const { schedule } = compileString('HH AH L OW');
node.port.postMessage({ type: 'schedule', schedule });
```

### Browser without a bundler (CDN)

```html
<script type="module">
  import { compileString } from 'https://esm.sh/klattsch';

  const ctx = new AudioContext();
  await ctx.audioWorklet.addModule('https://esm.sh/klattsch/formant-worklet.js');
  const node = new AudioWorkletNode(ctx, 'formant-processor');
  node.connect(ctx.destination);

  const { schedule } = compileString('HH AH L OW');
  node.port.postMessage({ type: 'schedule', schedule });
</script>
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

## See also

- [**libadlmidi-js**](https://github.com/libadlmidi-js/libadlmidi-js) - WebAssembly build of libADLMIDI, an OPL3 FM synthesis library with AudioWorklet integration. Where klattsch does parallel-formant *vocal-tract* synthesis, libadlmidi-js does FM-operator synthesis: the sound of early-80s arcade boards and AdLib cards. Includes [oplsfxr](https://libadlmidi-js.github.io/examples/oplsfxr.html), a sfxr-style sound effect generator.

## Commercial Support

`klattsch` is built and maintained by [Tony Gies](https://github.com/tgies). For studios, indie developers, and agencies integrating klattsch into a shipped product, consulting is available through his consultancy, Crash United, LLC.

### Support Offerings

| Service | Description |
|---------|-------------|
| **Game / app integration** | Wiring klattsch into your engine (Unity, Godot, web, Electron, Flutter), with dialog-system glue and tooling for non-programmer collaborators (writers, sound designers) |
| **Custom character voices** | Crafting a recognizable voice signature for a specific character: formant tuning, prosody templates, phoneme calibration, voice tests against scripted dialogue |
| **Audio pipeline work** | Routing klattsch through your DSP graph: mixing with music, ducking, environmental effects (reverb, distortion, radio filtering), multi-voice ensembles, dynamic vocal sizing |
| **Language / phoneme expansion** | Non-English phoneme tables, alternate transcription formats, custom symbol sets for stylized worlds (alien races, fantasy languages, in-universe scripts) |
| **Performance tuning** | Real-time constraints (game audio thread, low-latency targets), WASM/Rust ports, embedded or constrained-runtime targets |
| **Custom DSP features** | Cascade synthesis, additional formants, LPC pre-filtering, vocoder modes, custom synth extensions beyond the included parallel-resonator engine |
| **Priority bug fixes** | Reported issues triaged and patched ahead of the public queue, with backports to your pinned version |
| **Workshops / talks** | Formant synthesis, retro speech tech, or DSP fundamentals for your team |

For pricing, scoping, or anything not listed above, email **[support@crashunited.com](mailto:support@crashunited.com)** to discuss your project.

### Sponsorship

To support ongoing development without a formal contract, [GitHub Sponsors](https://github.com/sponsors/tgies) or [Ko-fi](https://ko-fi.com/crashunited) are the simplest paths.

## License

MIT &copy; Tony Gies
