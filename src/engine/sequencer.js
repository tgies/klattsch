// Phoneme-string parser and schedule compiler

import { banks, resolveBank } from './banks/index.js';

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

const HOMOGLYPH_MAP = {
  // Greek uppercase that look like Latin uppercase
  'Α':'A', 'Β':'B', 'Ε':'E', 'Η':'H', 'Ι':'I', 'Κ':'K',
  'Μ':'M', 'Ν':'N', 'Ο':'O', 'Ρ':'P', 'Τ':'T', 'Υ':'Y', 'Ζ':'Z',
  // Cyrillic uppercase that look like Latin uppercase
  'А':'A', 'В':'B', 'С':'C', 'Е':'E', 'Н':'H', 'К':'K',
  'М':'M', 'О':'O', 'Р':'P', 'Т':'T',
  // Cyrillic lowercase
  'а':'a', 'с':'c', 'е':'e', 'о':'o', 'р':'p',
};
const HOMOGLYPH_RE = new RegExp('[' + Object.keys(HOMOGLYPH_MAP).join('') + ']', 'g');
const ZERO_WIDTH_RE = new RegExp(
  '[' + [0x200B, 0x200C, 0x200D, 0x2060, 0xFEFF].map(c => String.fromCharCode(c)).join('') + ']',
  'g',
);

function normalize(input) {
  return input
    .normalize('NFKC')
    .replace(ZERO_WIDTH_RE, '')
    .replace(HOMOGLYPH_RE, ch => HOMOGLYPH_MAP[ch] ?? ch);
}

function classifyPart(part) {
  if (part === '(') return { type: 'syllable_open' };
  if (part === ')') return { type: 'syllable_close' };
  if (part in PAUSE_MS) return { type: 'pause', ms: PAUSE_MS[part] };
  if (part === '!' || part === "'") return { type: 'stress_mark' };

  const bankSwitch = part.match(/^\[bank=([A-Za-z0-9_.\-]+)\]$/);
  if (bankSwitch) return { type: 'bank_switch', name: bankSwitch[1] };
  if (part === '[bank]') return { type: 'bank_reset' };

  const bracket = part.match(/^\[(\w+)=(-?\d+(?:\.\d+)?)\]$/);
  if (bracket) {
    return { type: 'directive', key: bracket[1], value: Number(bracket[2]), relative: false };
  }

  const noteForm = part.match(/^(b)(=)?([A-G][b#]?-?\d+)$/);
  if (noteForm) {
    const hz = noteToHz(noteForm[3]);
    if (hz != null) return { type: 'directive', key: 'base', value: hz, relative: false };
  }

  const compact = part.match(/^([a-z])(?:(=)?(([+-])?\d+(?:\.\d+)?))?$/);
  if (compact) {
    const [, letter, eq, full, sign] = compact;
    const keyMap = {
      b: 'base', r: 'rate', p: 'pause', s: 'scale',
      v: 'vibrato', w: 'vibratoRate',
      m: 'tremolo', n: 'tremoloRate',
      h: 'aspiration', t: 'tilt', g: 'effort',
    };
    const key = keyMap[letter];
    if (key) {
      if (full === undefined) {
        // Bare letter reset to initial value, drop bare `p`
        if (key !== 'pause') return { type: 'directive', key, reset: true };
        return null;
      }
      const value = Number(full);
      const relative = !eq && (sign === '+' || sign === '-');
      return { type: 'directive', key, value, relative };
    }
  }

  const phoneme = part.match(/^([A-Z]+)(['!])?(?:\(([+-]\d+(?:\.\d+)?)\)|([+-]\d+(?:\.\d+)?))?$/);
  if (phoneme) {
    const transientDelta = phoneme[3] !== undefined ? Number(phoneme[3]) : null;
    const stickyDelta = phoneme[4] !== undefined ? Number(phoneme[4]) : null;
    return {
      type: 'phoneme',
      code: phoneme[1],
      stressed: phoneme[2] !== undefined,
      pitchDelta: transientDelta ?? stickyDelta ?? 0,
      transient: transientDelta !== null,
    };
  }

  return { type: 'unknown', text: part };
}

export function tokenize(rawInput) {
  const source = normalize(rawInput);
  const len = source.length;
  const tokens = [];
  let i = 0;

  const findBlockEnd = (start) => {
    const end = source.indexOf('*/', start + 2);
    return end === -1 ? len : end + 2;
  };

  while (i < len) {
    const c = source[i];
    if (/\s/.test(c)) { i++; continue; }
    // Line comment: # only at boundary (start of input or after whitespace).
    if (c === '#' && (i === 0 || /\s/.test(source[i - 1]))) {
      while (i < len && source[i] !== '\n') i++;
      continue;
    }
    // Block comment
    if (c === '/' && source[i + 1] === '*') {
      i = findBlockEnd(i);
      continue;
    }

    const srcStart = i;
    let part = '';
    while (i < len && !/\s/.test(source[i])) {
      if (source[i] === '/' && source[i + 1] === '*') {
        i = findBlockEnd(i);
        continue;
      }
      part += source[i];
      i++;
    }
    const srcEnd = i;
    if (!part) continue;

    // Split consecutive directives like [sr=8000][bit=8]
    if (part.startsWith('[')) {
      const directiveMatches = part.match(/\[[^\]]+\]/g);
      if (directiveMatches && directiveMatches.length > 1) {
        // Multiple directives back-to-back
        for (let j = 0; j < directiveMatches.length; j++) {
          const match = directiveMatches[j];
          const tok = classifyPart(match);
          if (!tok) continue;
          // For proper source tracking, estimate positions
          const offset = j > 0 ? part.indexOf(match, directiveMatches[j-1].length) : 0;
          tok.srcStart = srcStart + offset;
          tok.srcEnd = srcStart + offset + match.length;

          if (tok.type === 'stress_mark') {
            for (let k = tokens.length - 1; k >= 0; k--) {
              if (tokens[k].type === 'phoneme') { tokens[k].stressed = true; break; }
            }
            continue;
          }
          tokens.push(tok);
        }
        continue;
      }
    }

    const tok = classifyPart(part);
    if (!tok) continue;
    tok.srcStart = srcStart;
    tok.srcEnd = srcEnd;

    if (tok.type === 'stress_mark') {
      for (let j = tokens.length - 1; j >= 0; j--) {
        if (tokens[j].type === 'phoneme') { tokens[j].stressed = true; break; }
      }
      continue;
    }
    tokens.push(tok);
  }

  return { tokens, source };
}

export function compile(parsed, opts = {}) {
  // accept { tokens, source } shape from tokenize()
  // fallback to legacy otherwise
  const tokens = Array.isArray(parsed) ? parsed : parsed.tokens;
  const source = Array.isArray(parsed) ? '' : (parsed.source ?? '');
  const initialBaseF0      = opts.baseF0 ?? DEFAULTS.baseF0;
  const initialRate        = opts.rate ?? DEFAULTS.rate;
  const initialScale       = opts.scale ?? 1.0;
  const initialVibrato     = opts.vibratoDepth ?? 0;
  const initialVibratoRate = opts.vibratoRate ?? 5;
  const initialTremolo     = opts.tremoloDepth ?? 0;
  const initialTremoloRate = opts.tremoloRate ?? 5;
  const initialAspiration  = opts.aspiration ?? 0;
  const initialTilt        = opts.tilt ?? 0;
  const initialEffort      = opts.effort ?? 0.5;
  const initialBitDepth    = opts.bitDepth ?? 0;
  const initialSampleRate  = opts.sampleRate ?? null; // null means use native
  const registry           = opts.registry ?? banks;
  const initialPhonemes    = resolveBank(opts.bank, registry).phonemes;
  let phonemes             = initialPhonemes;
  let f0           = initialBaseF0;
  let rate         = initialRate;
  let scale        = initialScale;
  let vibrato      = initialVibrato;
  let vibratoRate  = initialVibratoRate;
  let tremolo      = initialTremolo;
  let tremoloRate  = initialTremoloRate;
  let aspiration   = initialAspiration;
  let tilt         = initialTilt;
  let effort       = initialEffort;
  let bitDepth     = initialBitDepth;
  let sampleRate   = initialSampleRate;
  // Bare `b` / `r` / `s` / `v` / `h` / `t` / `g` reset to opts values
  const schedule = [];
  const warnings = [];
  const phrases = [];
  let timeMs = 0;
  // phrase covers [phraseSrcStart .. token.srcEnd) of source and time
  // [phraseTimeStart .. timeMs] when the next sound finishes
  let phraseSrcStart = 0;
  let phraseTimeStart = 0;
  const emitPhrase = (t) => {
    phrases.push({
      srcStart: phraseSrcStart,
      srcEnd: t.srcEnd,
      // the audible token
      tokenSrcStart: t.srcStart,
      tStartMs: phraseTimeStart,
      tEndMs: timeMs,
      kind: t.type,
      phoneme: t.type === 'phoneme' ? t.code : null,
    });
    phraseSrcStart = t.srcEnd;
    phraseTimeStart = timeMs;
  };

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
      emitPhrase(t);
      if (!t.transient) f0 += t.pitchDelta;
    }
    syllableQueue = [];
    inSyllable = false;
  };

  const stateExtras = () => ({
    vibratoDepth: vibrato,
    vibratoRate,
    tremoloDepth: tremolo,
    tremoloRate,
    aspiration,
    tilt,
    effort,
    bitDepth,
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

    if (t.type === 'bank_switch') {
      const target = registry.get(t.name);
      if (!target) {
        warnings.push(`unknown bank: ${t.name}`);
        continue;
      }
      phonemes = target.phonemes;
      continue;
    }
    if (t.type === 'bank_reset') {
      phonemes = initialPhonemes;
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
        case 'tremolo':
          if (t.reset) tremolo = initialTremolo;
          else if (t.relative) tremolo += t.value;
          else tremolo = t.value;
          break;
        case 'tremoloRate':
          if (t.reset) tremoloRate = initialTremoloRate;
          else if (t.relative) tremoloRate += t.value;
          else tremoloRate = t.value;
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
          emitPhrase(t);
          break;
        case 'sr':
        case 'sampleRate':
          sampleRate = t.value > 0 ? t.value : null;
          // Emit meta-parameter change as immediate event (transitionMs: 0)
          // Only emit if value is not null (using default)
          if (sampleRate !== null) {
            emit({ sampleRate }, 0);
          }
          break;
        case 'bit':
        case 'bitDepth':
          bitDepth = t.value >= 0 ? t.value : 0;
          // Always emit bitDepth change (including 0 for reset)
          emit({ bitDepth }, 0);
          break;
        default:
          warnings.push(`unknown directive: ${t.key}`);
      }
      continue;
    }

    if (t.type === 'pause') {
      silence();
      timeMs += t.ms;
      emitPhrase(t);
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
    emitPhrase(t);

    if (!t.transient) f0 += t.pitchDelta;
  }

  if (inSyllable) {
    warnings.push('unclosed (');
    flushSyllable();
  }

  timeMs += DEFAULTS.sentenceFinalHoldMs;
  silence(DEFAULTS.fadeOutMs);
  timeMs += DEFAULTS.trailOffMs;

  // Hold the final phrase highlighted
  if (phrases.length) phrases[phrases.length - 1].tEndMs = timeMs;

  return { schedule, totalMs: timeMs, warnings, phrases, source };
}

export function compileString(input, opts) {
  return compile(tokenize(input), opts);
}
