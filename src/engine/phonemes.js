// ARPABET-keyed phoneme table.
//
// Constants source: Klatt, D.H. (1980), "Software for a cascade/parallel
// formant synthesizer," J. Acoust. Soc. Am. 67(3), Tables II (vowels) and
// III (consonants). When Klatt gives two rows for a vowel, the second row
// is the offglide / diphthong endpoint and is captured here as `glideTo`.
// Bandwidths and frequencies are verbatim from Klatt; amplitudes are
// approximated for our 3-formant parallel synth (Klatt uses six formants
// plus a bypass path for fricative spectra)
//
// Where Klatt's table places fricative energy in A3-A6 (~3-5 kHz parallel
// formants), we move our F3 channel up into that band to capture the hiss.

function vowel(F1, F2, F3, B1, B2, B3, glideTo = null) {
  const base = {
    voicing: 1,
    F1, F2, F3,
    BW1: B1, BW2: B2, BW3: B3,
    A1: 1.0, A2: 0.9, A3: 0.7,
  };
  if (glideTo) base.glideTo = glideTo;
  return base;
}

function sonorant(F1, F2, F3, B1, B2, B3) {
  return {
    voicing: 1,
    F1, F2, F3,
    BW1: B1, BW2: B2, BW3: B3,
    A1: 0.8, A2: 0.7, A3: 0.5,
  };
}

// Voiceless fricative: noise excitation, lower formants suppressed
function fricative(F1, F2, F3hi, A1, A2, A3) {
  return {
    voicing: 0,
    F1, F2, F3: F3hi,
    BW1: 200, BW2: 200, BW3: 1000,
    A1, A2, A3,
  };
}

// Voiced fricative: same spectrum as voiceless counterpart but with voicing
function voicedFric(F1, F2, F3hi, A1, A2, A3, voicedAmp = 0.5) {
  return {
    voicing: 0.45,
    F1, F2, F3: F3hi,
    BW1: 80, BW2: 100, BW3: 800,
    A1: A1 + voicedAmp * 0.8,
    A2, A3,
  };
}

export const phonemes = {
  // Vowels (Klatt 1980 Table II)
  IY: vowel(310, 2020, 2960, 45, 200, 400, { F1: 290, F2: 2070, F3: 2960 }),
  IH: vowel(400, 1800, 2570, 50, 100, 140, { F1: 470, F2: 1600, F3: 2600 }),
  EH: vowel(530, 1680, 2500, 60,  90, 200, { F1: 620, F2: 1530, F3: 2530 }),
  AE: vowel(620, 1660, 2430, 70, 150, 320, { F1: 650, F2: 1490, F3: 2470 }),
  AA: vowel(700, 1220, 2600, 130, 70, 160),
  AO: vowel(600,  990, 2570, 90, 100,  80, { F1: 630, F2: 1040, F3: 2600 }),
  AH: vowel(620, 1220, 2550, 80,  50, 140),
  UH: vowel(450, 1100, 2350, 80, 100,  80, { F1: 500, F2: 1180, F3: 2390 }),
  UW: vowel(350, 1250, 2200, 65, 110, 140, { F1: 320,  F2: 900, F3: 2200 }),
  ER: vowel(470, 1270, 1540, 100, 60, 110, { F1: 420, F2: 1310, F3: 1540 }),

  // Diphthongs (Klatt 1980 Table II)
  AY: vowel(660, 1200, 2550, 100, 70, 200, { F1: 400, F2: 1880, F3: 2500 }),
  AW: vowel(640, 1230, 2550,  80, 70, 140, { F1: 420, F2:  940, F3: 2350 }),
  EY: vowel(480, 1720, 2520,  70, 100, 200, { F1: 330, F2: 2020, F3: 2600 }),
  OW: vowel(540, 1100, 2300,  80, 70,  70, { F1: 450, F2:  900, F3: 2300 }),
  OY: vowel(550,  960, 2400,  80, 50, 130, { F1: 360, F2: 1820, F3: 2450 }),

  // Sonorant consonants (Klatt 1980 Table III)
  W: sonorant(290,  610, 2150, 50,  80,  60),
  Y: sonorant(260, 2070, 3020, 40, 250, 500),
  R: sonorant(310, 1060, 1380, 70, 100, 120),
  L: sonorant(310, 1050, 2880, 50, 100, 280),

  // Nasals (Klatt 1980 Table III, approximated)
  M: { voicing: 1, F1: 270, F2: 1270, F3: 2130, BW1: 40, BW2: 200, BW3: 200,
       A1: 0.7, A2: 0.18, A3: 0.10 },
  N: { voicing: 1, F1: 270, F2: 1340, F3: 2470, BW1: 40, BW2: 300, BW3: 300,
       A1: 0.7, A2: 0.20, A3: 0.12 },
  NG: { voicing: 1, F1: 270, F2: 2000, F3: 2700, BW1: 40, BW2: 300, BW3: 300,
        A1: 0.7, A2: 0.20, A3: 0.12 },

  // Voiceless fricatives (Klatt 1980 Table III)
  F:  fricative(340, 1100, 2080, 0.0, 0.10, 0.15),
  TH: fricative(320, 1290, 2540, 0.0, 0.08, 0.18),
  S:  fricative(320, 1390, 5500, 0.0, 0.0, 0.95),
  SH: fricative(300, 1840, 2750, 0.0, 0.55, 0.65),

  // Voiced fricatives
  V:  voicedFric(220, 1100, 2080, 0.0, 0.12, 0.18),
  DH: voicedFric(270, 1290, 2540, 0.0, 0.10, 0.20),
  Z:  voicedFric(240, 1390, 5500, 0.0, 0.0,  0.65),
  ZH: voicedFric(270, 1840, 2750, 0.0, 0.45, 0.55),

  // /h/ aspirated fricative
  HH: { voicing: 0, F1: 500, F2: 1500, F3: 2500, BW1: 300, BW2: 200, BW3: 300,
        A1: 0.4, A2: 0.4, A3: 0.3 },

  // Plosives (burst spectra from Klatt 1980 Table III)
  P:  { isStop: true, voicing: 0,   F1: 400, F2: 1100, F3: 2150,
        BW1: 300, BW2: 150, BW3: 220, A1: 0.10, A2: 0.20, A3: 0.25 },
  B:  { isStop: true, voicing: 0.6, F1: 200, F2: 1100, F3: 2150,
        BW1:  60, BW2: 110, BW3: 130, A1: 0.50, A2: 0.20, A3: 0.20 },
  T:  { isStop: true, voicing: 0,   F1: 400, F2: 1600, F3: 2600,
        BW1: 300, BW2: 120, BW3: 250, A1: 0.0,  A2: 0.30, A3: 0.55 },
  D:  { isStop: true, voicing: 0.6, F1: 200, F2: 1600, F3: 2600,
        BW1:  60, BW2: 100, BW3: 170, A1: 0.50, A2: 0.40, A3: 0.50 },
  K:  { isStop: true, voicing: 0,   F1: 300, F2: 1990, F3: 2850,
        BW1: 250, BW2: 160, BW3: 330, A1: 0.0,  A2: 0.50, A3: 0.40 },
  G:  { isStop: true, voicing: 0.6, F1: 200, F2: 1990, F3: 2850,
        BW1:  60, BW2: 150, BW3: 280, A1: 0.50, A2: 0.50, A3: 0.40 },

  // Affricates
  CH: { isStop: true, voicing: 0,   F1: 350, F2: 1800, F3: 2820,
        BW1: 200, BW2:  90, BW3: 300, A1: 0.0,  A2: 0.40, A3: 0.55 },
  JH: { isStop: true, voicing: 0.5, F1: 260, F2: 1800, F3: 2820,
        BW1:  60, BW2:  80, BW3: 270, A1: 0.40, A2: 0.40, A3: 0.50 },

  // Silence
  _:  { voicing: 0, F1: 500, F2: 1500, F3: 2500, BW1: 80, BW2: 120, BW3: 160,
        A1: 0, A2: 0, A3: 0 },
};

export const PHONEME_KEYS = Object.keys(phonemes).filter(k => !k.startsWith('_'));
