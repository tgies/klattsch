# klattsch

A primitive parallel-formant speech synthesizer in the browser. Late-70s / early-80s tier (Votrax, SAM).

The name is a portmanteau of *Klatt* (Dennis Klatt, the formant-synth pioneer) and *Klatsch* (German for gossip / casual chat).

[**Live demo**](https://klatts.ch/play/)

[**Commercial support**](#commercial-support) - integration consulting from the author

## The klattsch app

The klattsch app builds on this engine with a piano-roll editor for singing,
pitch editing, multiple voice parts, backing tracks, and WAV and video export.
It runs offline on Windows, macOS, Linux, and Android.

[klatts.ch](https://klatts.ch/) · [itch.io for desktop](https://crashunited.itch.io/klattsch) · [Google Play for Android](https://play.google.com/store/apps/details?id=com.crashunited.klattsch)

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

### Polyphony

A `[voice=N]` marker splits the phoneme string into independent voice sections.
Everything before the first marker is voice 0; each marker begins a new section
that compiles from a fresh initial state (running directives never carry across a
marker). The sections are meant to sound together.

```
bC3 AA r400 AA AA [voice=1] bC4 IY r400 IY IY   a two-voice chord
```

`compileString` returns a `voices` array (`[{ schedule, totalMs, phrases }]`)
alongside the backward-compatible top-level `schedule`/`phrases`/`totalMs`, which
mirror voice 0. Render each voice into its own buffer (or its own worklet output)
and mix. With no marker, `voices` has a single entry and the top-level fields are
unchanged.

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

For polyphony, construct the node with one output per voice and address each by a
`voice` field:

```js
const { voices } = compileString('bC3 AA [voice=1] bC4 IY');
const node = new AudioWorkletNode(ctx, 'formant-processor', {
  numberOfOutputs: voices.length,
  outputChannelCount: voices.map(() => 1),
});
voices.forEach((v, i) => {
  const g = ctx.createGain();
  node.connect(g, i, 0);
  g.connect(ctx.destination);
  node.port.postMessage({ type: 'schedule', schedule: v.schedule, voice: i });
});
```

A `reset` message with no `voice` field resets every voice; with one, it resets
just that voice. Offline renders can pass `processorOptions: { schedules }`.

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

### Custom engines and directives

The compiler is decoupled from the synthesizer: it produces a schedule of
parameter targets that `FormantSynth` interprets, but any consumer can interpret
the same schedule differently. Two directives support that:

- `[engine=NAME]` marks a voice section for a named engine. The compiler does not
  interpret the name; it records it on each `voices[i].engine` (and the top-level
  `engine`) for a consumer to dispatch on. `[engine]` resets to the default.
  Compiling with `{ engine: 'NAME' }` sets the default for every section.
- Uppercase bracket directives such as `[OQ=0.65]` or `[FNZ=450]` are recorded as
  opaque, sticky state that rides into every subsequent schedule target, for an
  engine that reads extra parameters beyond the built-in set. `[OQ]` clears the
  override. Bank fields named `F4`/`BW4` and up are scaled by the running `s`
  scale like `F1`-`F3`.

`FormantSynth` ignores both, so existing strings and banks are unaffected.

## References

- Klatt, D. H. (1980). *Software for a cascade/parallel formant synthesizer.*
- Hillenbrand et al. (1995). *Acoustic characteristics of American English vowels.*
- Rosenberg, A. E. (1971). *Effect of glottal pulse shape on the quality of natural vowels.*
- Robinson, R. Bristow-Johnson. *Audio EQ Cookbook.*
- Mokhtari, P. & Tanaka, K. (2000). *A Corpus of Japanese Vowel Formant Patterns.* Bulletin of the Electrotechnical Laboratory (ETL), Vol. 64, Special Issue, 57-66. ([project page](https://isd.pu-toyama.ac.jp/~parham/sp_FormantDataETL.html), [data file](https://web.archive.org/web/20240811224814/https://isd.pu-toyama.ac.jp/~parham/documents/formantsETL/MokhtariTanaka2000_ETLformantdata.txt)) - source of the Japanese vowel formants in the `ja-mokhtari-2000` phoneme bank.

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
