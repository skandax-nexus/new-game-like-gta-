/**
 * Music theory for the procedural score: swaras in just intonation, raga grammars (aroha / avaroha,
 * vadi / samvadi, pakad phrases, resting notes, andolan and intonation details) and talas with their
 * thekas. "Raga-inspired": the grammars drive a generative composer; they are not transcriptions.
 * Period note (Creative Director): instruments are named after their ancient forms - vamsha (bansuri),
 * vina (plucked), mridanga / pakhawaj, bheri / nagara, shankha, ghanta - no tabla, sitar or harmonium.
 * OWNER: Audio Developer (AUD-01).
 */

/** Sa of the whole score (C#3 ~ 138.6 Hz): one tonic everywhere, so mood changes never clash. */
export const SA_HZ = 138.59;

/** Just ratios for the 12 swara positions (S r R g G m M P d D n N). */
export const JUST_RATIOS = [1, 16 / 15, 9 / 8, 6 / 5, 5 / 4, 4 / 3, 45 / 32, 3 / 2, 8 / 5, 5 / 3, 9 / 5, 15 / 8] as const;

export const SWARA_NAMES = ['S', 'r', 'R', 'g', 'G', 'm', 'M', 'P', 'd', 'D', 'n', 'N'] as const;

export type RagaId = 'yaman' | 'bhairav' | 'kafi' | 'bhairavi' | 'darbari' | 'kirwani' | 'marwa' | 'malkauns' | 'bhupali' | 'megh' | 'sarang';

export interface RagaDef {
  id: RagaId;
  name: string;
  /** Prahar (time of day) and rasa, for documentation and mood selection. */
  time: string;
  rasa: string;
  /** Pitch classes used (semitones from Sa). */
  notes: readonly number[];
  /** Ascent in semitones (may start below Sa, e.g. -1 = mandra Ni); used as a cyclic template per octave. */
  aroha: readonly number[];
  /** Descent in semitones from taar Sa (12) down. */
  avaroha: readonly number[];
  vadi: number;
  samvadi: number;
  /** Nyas (resting) notes: where phrases may end. */
  rest: readonly number[];
  /** Characteristic phrases (semitones relative to Sa, octave-explicit). */
  pakad: readonly (readonly number[])[];
  /** Notes sung / played with a slow oscillation. */
  andolan?: readonly number[];
  /** Intonation overrides in cents (pitch class -> cents above Sa). */
  cents?: Readonly<Record<number, number>>;
  /** Tanpura first string (pitch class): Pa normally; Ma or Ni for ragas that omit Pa. */
  tanpura: number;
}

export const RAGAS: Record<RagaId, RagaDef> = {
  yaman: {
    id: 'yaman', name: 'Yaman', time: 'first prahar of night (evening)', rasa: 'shanta / shringara - serene majesty',
    notes: [0, 2, 4, 6, 7, 9, 11], aroha: [-1, 2, 4, 6, 9, 11, 12], avaroha: [12, 11, 9, 7, 6, 4, 2, 0],
    vadi: 4, samvadi: 11, rest: [4, 7, 11, 0, 2],
    pakad: [[-1, 2, 4, 2, 0], [-1, 2, 4, 6, 7], [4, 6, 9, 11, 9, 7], [6, 4, 2, 0], [7, 6, 4, 6, 2, 0]],
    tanpura: 7,
  },
  bhairav: {
    id: 'bhairav', name: 'Bhairav', time: 'dawn', rasa: 'bhakti / shanta - grave devotion',
    notes: [0, 1, 4, 5, 7, 8, 11], aroha: [0, 1, 4, 5, 7, 8, 11, 12], avaroha: [12, 11, 8, 7, 5, 4, 1, 0],
    vadi: 8, samvadi: 1, rest: [0, 8, 7, 4, 5],
    pakad: [[0, 4, 5, 7, 8, 7], [4, 5, 1, 0], [8, 8, 7], [4, 5, 8, 11, 12], [11, 8, 7, 5, 4, 1, 0]],
    andolan: [1, 8], cents: { 1: 90, 8: 792 },
    tanpura: 7,
  },
  kafi: {
    id: 'kafi', name: 'Kafi', time: 'late night / spring, folk-tinged', rasa: 'shringara - tender, open-air calm',
    notes: [0, 2, 3, 5, 7, 9, 10], aroha: [0, 2, 3, 5, 7, 9, 10, 12], avaroha: [12, 10, 9, 7, 5, 3, 2, 0],
    vadi: 7, samvadi: 0, rest: [7, 0, 2, 5],
    pakad: [[0, 0, 2, 2, 3, 3, 5, 5, 7], [5, 7, 9, 7, 5, 3, 2], [2, 3, 5, 7], [10, 9, 7, 5, 3, 2, 0]],
    tanpura: 7,
  },
  bhairavi: {
    id: 'bhairavi', name: 'Bhairavi', time: 'morning / concert close', rasa: 'karuna - pathos, farewell',
    notes: [0, 1, 3, 5, 7, 8, 10], aroha: [0, 1, 3, 5, 7, 8, 10, 12], avaroha: [12, 10, 8, 7, 5, 3, 1, 0],
    vadi: 5, samvadi: 0, rest: [0, 7, 5, 3],
    pakad: [[5, 3, 1, 3, 0, 1, 0], [8, 7, 3, 5, 1, 0], [3, 5, 7, 8, 7], [10, 8, 7, 5, 3, 1, 0]],
    cents: { 1: 90 },
    tanpura: 7,
  },
  darbari: {
    id: 'darbari', name: 'Darbari Kanada', time: 'midnight, royal court', rasa: 'vira / gambhira - grave majesty',
    notes: [0, 2, 3, 5, 7, 8, 10], aroha: [-2, 0, 2, 3, 5, 7, 8, 10, 12], avaroha: [12, 8, 10, 7, 5, 7, 3, 5, 2, 0],
    vadi: 2, samvadi: 7, rest: [2, 7, 0, -4],
    pakad: [[3, 5, 2, 0], [8, 10, 7], [-2, 0, 2, 3, 5, 2, 0], [-4, -2, 0], [7, 8, 10, 7, 3, 5, 2, 0]],
    andolan: [3, 8], cents: { 3: 294, 8: 792 },
    tanpura: 7,
  },
  kirwani: {
    id: 'kirwani', name: 'Kirwani', time: 'night', rasa: 'vira / karuna - fierce longing',
    notes: [0, 2, 3, 5, 7, 8, 11], aroha: [0, 2, 3, 5, 7, 8, 11, 12], avaroha: [12, 11, 8, 7, 5, 3, 2, 0],
    vadi: 7, samvadi: 0, rest: [7, 0, 3, 8],
    pakad: [[3, 5, 7, 8, 11, 12], [8, 7, 5, 3, 2, 0], [2, 3, 5, 7], [11, 8, 7, 3, 5, 2, 0]],
    tanpura: 7,
  },
  marwa: {
    id: 'marwa', name: 'Marwa', time: 'sunset', rasa: 'restless anticipation (no Pa)',
    notes: [0, 1, 4, 6, 9, 11], aroha: [-1, 1, 4, 6, 9, 11, 12], avaroha: [12, 11, 9, 6, 4, 1, 0],
    vadi: 1, samvadi: 9, rest: [1, 9, -3, -1],
    pakad: [[-3, -1, 1, 0], [-1, 1, 4, 6, 9], [6, 4, 1], [9, 6, 4, 1, 0], [11, 9, 6, 9, 11, 12]],
    cents: { 1: 90 },
    tanpura: 11,
  },
  malkauns: {
    id: 'malkauns', name: 'Malkauns', time: 'deep night', rasa: 'shanta / gambhira - meditative depth',
    notes: [0, 3, 5, 8, 10], aroha: [-2, 0, 3, 5, 8, 10, 12], avaroha: [12, 10, 8, 5, 3, 0],
    vadi: 5, samvadi: 0, rest: [5, 0, 8, 3],
    pakad: [[5, 3, 5, 8, 5, 3, 0], [-2, 0, 3, 5], [8, 10, 12, 10, 8, 5], [3, 5, 3, 0]],
    andolan: [3],
    tanpura: 5,
  },
  bhupali: {
    id: 'bhupali', name: 'Bhupali', time: 'evening', rasa: 'shringara / vira - radiant joy',
    notes: [0, 2, 4, 7, 9], aroha: [0, 2, 4, 7, 9, 12], avaroha: [12, 9, 7, 4, 2, 0],
    vadi: 4, samvadi: 9, rest: [4, 7, 0, 9],
    pakad: [[4, 2, 0, -3, 0, 2, 4], [7, 4, 9, 7, 4, 2, 0], [4, 7, 9, 12], [9, 7, 4, 2, 4]],
    tanpura: 7,
  },
  megh: {
    id: 'megh', name: 'Megh', time: 'monsoon', rasa: 'shringara - the gathering rain clouds',
    notes: [0, 2, 5, 7, 10], aroha: [0, 2, 5, 7, 10, 12], avaroha: [12, 10, 7, 5, 2, 0],
    vadi: 0, samvadi: 7, rest: [2, 7, 0, 5],
    pakad: [[2, 5, 2, -2, 0], [5, 7, 10, 7], [10, 7, 5, 2], [7, 10, 12, 10, 7, 5, 2, 0]],
    andolan: [2],
    tanpura: 7,
  },
  sarang: {
    id: 'sarang', name: 'Brindavani Sarang', time: 'midday heat', rasa: 'shringara - bright, sun-struck',
    notes: [0, 2, 5, 7, 10, 11], aroha: [-1, 0, 2, 5, 7, 11, 12], avaroha: [12, 10, 7, 5, 2, 0],
    vadi: 2, samvadi: 7, rest: [2, 7, 0],
    pakad: [[-1, 0, 2, 5, 2, 0], [2, 5, 7, 11, 12], [10, 7, 5, 2], [7, 5, 2, 0]],
    tanpura: 7,
  },
};

/** Frequency of a swara position (semitones from Sa, any octave) in a raga. */
export function swaraHz(raga: RagaDef, semis: number, sa = SA_HZ): number {
  const pc = ((semis % 12) + 12) % 12;
  const oct = Math.floor(semis / 12);
  const c = raga.cents?.[pc];
  const ratio = c !== undefined ? Math.pow(2, c / 1200) : (JUST_RATIOS[pc] as number);
  return sa * ratio * Math.pow(2, oct);
}

/** All raga notes in [lo, hi] semitones, ascending. */
export function ragaScale(raga: RagaDef, lo: number, hi: number): number[] {
  const out: number[] = [];
  for (let s = lo; s <= hi; s++) if (raga.notes.includes(((s % 12) + 12) % 12)) out.push(s);
  return out;
}

/** Next note above `from` allowed by the aroha (cyclic per octave), or the next scale note. */
export function nextUp(raga: RagaDef, from: number): number {
  const pcs = raga.aroha.map((x) => ((x % 12) + 12) % 12);
  for (let s = from + 1; s <= from + 12; s++) if (pcs.includes(((s % 12) + 12) % 12)) return s;
  return from + 12;
}

/** Next note below `from` allowed by the avaroha. */
export function nextDown(raga: RagaDef, from: number): number {
  const pcs = raga.avaroha.map((x) => ((x % 12) + 12) % 12);
  for (let s = from - 1; s >= from - 12; s--) if (pcs.includes(((s % 12) + 12) % 12)) return s;
  return from - 12;
}

// ------------------------------------------------------------------------------------------------ talas

export type TalaId = 'teental' | 'rupak' | 'jhaptal' | 'keherwa' | 'dadra' | 'chautal' | 'war';

/** One matra of a theka: one or more strokes subdividing the beat ('-' = rest). */
export type Bol = string;

export interface TalaDef {
  id: TalaId;
  name: string;
  matras: number;
  /** Vibhag (section) sizes. */
  vibhags: readonly number[];
  /** Theka: per matra, space-separated strokes subdividing that beat. */
  theka: readonly Bol[];
  /** Matra index of the khali (empty) vibhag start, or -1. */
  khali: number;
}

export const TALAS: Record<TalaId, TalaDef> = {
  teental: {
    id: 'teental', name: 'Tintal (16)', matras: 16, vibhags: [4, 4, 4, 4], khali: 8,
    theka: ['dha', 'dhin', 'dhin', 'dha', 'dha', 'dhin', 'dhin', 'dha', 'dha', 'tin', 'tin', 'na', 'na', 'dhin', 'dhin', 'dha'],
  },
  rupak: {
    id: 'rupak', name: 'Rupak (7)', matras: 7, vibhags: [3, 2, 2], khali: 0,
    theka: ['tin', 'tin', 'na', 'dhi', 'na', 'dhi', 'na'],
  },
  jhaptal: {
    id: 'jhaptal', name: 'Jhaptal (10)', matras: 10, vibhags: [2, 3, 2, 3], khali: 5,
    theka: ['dhi', 'na', 'dhi', 'dhi', 'na', 'tin', 'na', 'dhi', 'dhi', 'na'],
  },
  keherwa: {
    id: 'keherwa', name: 'Keherwa (8)', matras: 8, vibhags: [4, 4], khali: 4,
    theka: ['dha', 'ge', 'na', 'tin', 'na', 'ke', 'dhi', 'na'],
  },
  dadra: {
    id: 'dadra', name: 'Dadra (6)', matras: 6, vibhags: [3, 3], khali: 3,
    theka: ['dha', 'dhi', 'na', 'dha', 'tin', 'na'],
  },
  chautal: {
    id: 'chautal', name: 'Chautal (12, pakhawaj)', matras: 12, vibhags: [2, 2, 2, 2, 2, 2], khali: 4,
    theka: ['dha', 'dha', 'dhin', 'na', 'te te', 'dha', 'dhin', 'na', 'te na', 'ke na', 'ge dhi', 'ge na'],
  },
  war: {
    id: 'war', name: 'War march (8, dhol / nagara)', matras: 8, vibhags: [4, 4], khali: -1,
    theka: ['boom', '- rim', 'boom', 'rim', 'boom', '- rim', 'boom boom', 'rim rim'],
  },
};
