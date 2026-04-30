// Phoneme-string parser and schedule compiler

import { phonemes } from './phonemes.js';

const PAUSE_MS = { ',': 100, ';': 200, '.': 300 };

// Convert note names like "C4", "C#5", "Db3", "A-1" to Hz.
const NOTE_SEMITONES = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
function noteToHz(name) {
  const m = name.match(/^([A-G])([b#]?)(-?\d+)$/);
  if (!m) return null;
  const [, letter, accidental, octaveStr] = m;
  let semi = NOTE_SEMITONES[letter];
  if (accidental === '#') semi += 1;
  else if (accidental === 'b') semi -= 1;
  const octave = parseInt(octaveStr, 10);
  const midi = (octave + 1) * 12 + semi;
  return 440 * Math.pow(2, (midi - 69) / 12);
}

const DEFAULTS = Object.freeze({
  baseF0: 120,
  rate: 110,                  // ms per phoneme
  stressDurationFactor: 1.5,
  stressF0Lift: 8,            // Hz
  stopBurstMs: 25,
  defaultTransitionMs: 35,
  sentenceFinalHoldMs: 0,
  fadeOutMs: 100,
  trailOffMs: 150,
});

export function tokenize(input) {
  const stripped = input.replace(/(^|\s)#.*$/gm, '$1');
  const parts = stripped.trim().split(/\s+/).filter(Boolean);
  const tokens = [];
  for (const part of parts) {
    if (part === '(') { tokens.push({ type: 'syllable_open' }); continue; }
    if (part === ')') { tokens.push({ type: 'syllable_close' }); continue; }
    if (part in PAUSE_MS) {
      tokens.push({ type: 'pause', ms: PAUSE_MS[part] });
      continue;
    }

    if (part === '!' || part === "'") {
      for (let i = tokens.length - 1; i >= 0; i--) {
        if (tokens[i].type === 'phoneme') { tokens[i].stressed = true; break; }
      }
      continue;
    }
    // Bracket form (verbose, original): [base=140] [rate=120] [pause=300]
    const bracket = part.match(/^\[(\w+)=(-?\d+(?:\.\d+)?)\]$/);
    if (bracket) {
      tokens.push({ type: 'directive', key: bracket[1], value: Number(bracket[2]), relative: false });
      continue;
    }

    const noteForm = part.match(/^(b)(=)?([A-G][b#]?-?\d+)$/);
    if (noteForm) {
      const hz = noteToHz(noteForm[3]);
      if (hz != null) {
        tokens.push({ type: 'directive', key: 'base', value: hz, relative: false });
        continue;
      }
    }

    const compact = part.match(/^([a-z])(?:(=)?(([+-])?\d+(?:\.\d+)?))?$/);
    if (compact) {
      const [, letter, eq, full, sign] = compact;
      const keyMap = {
        b: 'base', r: 'rate', p: 'pause', s: 'scale',
        v: 'vibrato', w: 'vibratoRate',
        h: 'aspiration', t: 'tilt', g: 'effort',
      };
      const key = keyMap[letter];
      if (key) {
        if (full === undefined) {
          // Bare letter: reset to initial value. `p` alone has no useful
          // meaning so we drop it silently.
          if (key !== 'pause') {
            tokens.push({ type: 'directive', key, reset: true });
          }
        } else {
          const value = Number(full);
          const relative = !eq && (sign === '+' || sign === '-');
          tokens.push({ type: 'directive', key, value, relative });
        }
        continue;
      }
    }

    const phoneme = part.match(/^([A-Z]+)(['!])?(?:\(([+-]\d+)\)|([+-]\d+))?$/);
    if (phoneme) {
      const transientDelta = phoneme[3] !== undefined ? Number(phoneme[3]) : null;
      const stickyDelta = phoneme[4] !== undefined ? Number(phoneme[4]) : null;
      tokens.push({
        type: 'phoneme',
        code: phoneme[1],
        stressed: phoneme[2] !== undefined,
        pitchDelta: transientDelta ?? stickyDelta ?? 0,
        transient: transientDelta !== null,
      });
      continue;
    }
    tokens.push({ type: 'unknown', text: part });
  }
  return tokens;
}

export function compile(tokens, opts = {}) {
  const initialBaseF0      = opts.baseF0 ?? DEFAULTS.baseF0;
  const initialRate        = opts.rate ?? DEFAULTS.rate;
  const initialScale       = opts.scale ?? 1.0;
  const initialVibrato     = opts.vibratoDepth ?? 0;
  const initialVibratoRate = opts.vibratoRate ?? 5;
  const initialAspiration  = opts.aspiration ?? 0;
  const initialTilt        = opts.tilt ?? 0;
  const initialEffort      = opts.effort ?? 0.5;
  let f0           = initialBaseF0;
  let rate         = initialRate;
  let scale        = initialScale;
  let vibrato      = initialVibrato;
  let vibratoRate  = initialVibratoRate;
  let aspiration   = initialAspiration;
  let tilt         = initialTilt;
  let effort       = initialEffort;
  // Bare `b` / `r` / `s` / `v` / `h` / `t` / `g` reset to opts values
  const schedule = [];
  const warnings = [];
  let timeMs = 0;

  // Apply the running formant scale to a phoneme parameter set.
  // `glideTo` overrides the formant fields for diphthong endpoints
  const scaled = (p, f0Hz, glideTo = null) => {
    const src = glideTo ? { ...p, ...glideTo } : p;
    return {
      ...p, ...glideTo,
      F0: f0Hz,
      F1: src.F1 * scale, F2: src.F2 * scale, F3: src.F3 * scale,
      BW1: src.BW1 * scale, BW2: src.BW2 * scale, BW3: src.BW3 * scale,
    };
  };

  const renderPhoneme = (t, slotMs) => {
    const p = phonemes[t.code];
    if (!p) {
      warnings.push(`unknown phoneme: ${t.code}`);
      return 0;
    }
    const startF0 = t.stressed ? f0 + DEFAULTS.stressF0Lift : f0;
    const endF0 = startF0 + t.pitchDelta;
    if (p.isStop) {
      const burstMs = Math.min(DEFAULTS.stopBurstMs, slotMs * 0.3);
      const silenceMs = slotMs - burstMs;
      silence(Math.min(20, silenceMs * 0.4));
      timeMs += silenceMs;
      emit(scaled(p, startF0), Math.min(5, burstMs * 0.2));
      timeMs += burstMs;
      return slotMs;
    } else if (p.glideTo) {
      const onset = slotMs * 0.25, glide = slotMs * 0.50, offset = slotMs * 0.25;
      emit(scaled(p, startF0), Math.min(20, onset));
      timeMs += onset;
      emit(scaled(p, endF0, p.glideTo), glide);
      timeMs += glide + offset;
      return slotMs;
    } else if (t.pitchDelta !== 0) {
      emit(scaled(p, startF0), Math.min(25, slotMs * 0.25));
      timeMs += slotMs * 0.25;
      emit(scaled(p, endF0), slotMs * 0.6);
      timeMs += slotMs * 0.75;
      return slotMs;
    } else {
      const trans = Math.min(DEFAULTS.defaultTransitionMs, slotMs * 0.4);
      emit(scaled(p, startF0), trans);
      timeMs += slotMs;
      return slotMs;
    }
  };

  let inSyllable = false;
  let syllableQueue = [];
  const flushSyllable = () => {
    if (!syllableQueue.length) { inSyllable = false; return; }
    const slot = rate / syllableQueue.length;
    for (const t of syllableQueue) {
      renderPhoneme(t, slot);
      if (!t.transient) f0 += t.pitchDelta;
    }
    syllableQueue = [];
    inSyllable = false;
  };

  const stateExtras = () => ({
    vibratoDepth: vibrato,
    vibratoRate,
    aspiration,
    tilt,
    effort,
  });

  const emit = (target, transitionMs) => {
    schedule.push({
      atMs: timeMs,
      target: { ...target, ...stateExtras() },
      transitionMs,
    });
  };
  const silence = (transitionMs = 30) => emit({ A1: 0, A2: 0, A3: 0 }, transitionMs);

  for (const t of tokens) {
    if (t.type === 'unknown') {
      warnings.push(`unknown token: ${t.text}`);
      continue;
    }

    if (t.type === 'syllable_open') {
      if (inSyllable) {
        warnings.push('nested ( ignored');
        continue;
      }
      inSyllable = true;
      syllableQueue = [];
      continue;
    }
    if (t.type === 'syllable_close') {
      if (!inSyllable) {
        warnings.push('unmatched )');
        continue;
      }
      flushSyllable();
      continue;
    }

    if (t.type === 'directive') {
      switch (t.key) {
        case 'base':
        case 'pitch':
          if (t.reset) f0 = initialBaseF0;
          else if (t.relative) f0 += t.value;
          else f0 = t.value;
          break;
        case 'rate':
          if (t.reset) rate = initialRate;
          else if (t.relative) rate += t.value;
          else rate = t.value;
          break;
        case 'scale':
          if (t.reset) scale = initialScale;
          else if (t.relative) scale += t.value;
          else scale = t.value;
          break;
        case 'vibrato':
          if (t.reset) vibrato = initialVibrato;
          else if (t.relative) vibrato += t.value;
          else vibrato = t.value;
          break;
        case 'vibratoRate':
          if (t.reset) vibratoRate = initialVibratoRate;
          else if (t.relative) vibratoRate += t.value;
          else vibratoRate = t.value;
          break;
        case 'aspiration':
          if (t.reset) aspiration = initialAspiration;
          else if (t.relative) aspiration += t.value;
          else aspiration = t.value;
          break;
        case 'tilt':
          if (t.reset) tilt = initialTilt;
          else if (t.relative) tilt += t.value;
          else tilt = t.value;
          break;
        case 'effort':
          if (t.reset) effort = initialEffort;
          else if (t.relative) effort += t.value;
          else effort = t.value;
          break;
        case 'pause':
          silence();
          timeMs += Math.abs(t.value);
          break;
        default:
          warnings.push(`unknown directive: ${t.key}`);
      }
      continue;
    }

    if (t.type === 'pause') {
      silence();
      timeMs += t.ms;
      continue;
    }

    // phoneme: defer to the group buffer if inside (...), otherwise render
    // straight to the schedule
    if (inSyllable) {
      syllableQueue.push(t);
      continue;
    }

    const phoneRate = t.stressed ? rate * DEFAULTS.stressDurationFactor : rate;
    renderPhoneme(t, phoneRate);

    if (!t.transient) f0 += t.pitchDelta;
  }

  if (inSyllable) {
    warnings.push('unclosed (');
    flushSyllable();
  }

  timeMs += DEFAULTS.sentenceFinalHoldMs;
  silence(DEFAULTS.fadeOutMs);
  timeMs += DEFAULTS.trailOffMs;

  return { schedule, totalMs: timeMs, warnings };
}

export function compileString(input, opts) {
  return compile(tokenize(input), opts);
}
