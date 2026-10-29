/**
 * Melody composer: generates raga phrases from the grammar in theory.ts. Phrases walk the aroha going
 * up and the avaroha going down, rest on nyas notes (vadi / samvadi weighted), quote the pakad, rise
 * through the registers over time (vistar), and use section-dependent rhythm: long meend-laden notes in
 * alap, an even pulse in jor, rhythmic cells and fast tans in gat. Seeded: never repeats a loop.
 * OWNER: Audio Developer (AUD-01).
 */
import type { Rand } from '../synth/core';
import { nextDown, nextUp, type RagaDef } from './theory';

export type Section = 'alap' | 'jor' | 'gat';

export interface PhraseNote {
  /** Onset in beats from the phrase start. */
  beat: number;
  beats: number;
  /** Semitones from Sa (melody octave included). */
  semis: number;
  /** Glide in from the previous note. */
  meend: boolean;
  /** Grace note (semitones) flicked before the note, or null. */
  kan: number | null;
  andolan: boolean;
  vel: number;
}

export interface Phrase {
  notes: PhraseNote[];
  /** Beats including the rest after the last note. */
  totalBeats: number;
  kind: 'pakad' | 'arc' | 'descent' | 'tan' | 'answer' | 'hover';
}

const GAT_CELLS: readonly (readonly number[])[] = [[1], [0.5, 0.5], [0.75, 0.25], [0.5, 0.25, 0.25], [0.25, 0.25, 0.5], [1.5, 0.5], [0.5, 1], [1, 1]];

export class Composer {
  private cur: number;
  private center: number;
  private vistar = 0;
  private lastPhrase: number[] = [];

  constructor(
    private raga: RagaDef,
    private readonly rng: Rand,
    private register: number,
  ) {
    this.cur = register;
    this.center = register - 2;
  }

  setRaga(raga: RagaDef, register: number): void {
    this.raga = raga;
    this.register = register;
    this.cur = this.snap(this.cur);
  }

  /** Nearest raga note to `s`. */
  snap(s: number): number {
    for (let d = 0; d < 7; d++) {
      for (const c of [s - d, s + d]) if (this.raga.notes.includes(((c % 12) + 12) % 12)) return c;
    }
    return s;
  }

  private pickRest(): number {
    const r = this.raga;
    const weights = r.rest.map((pc) => (pc === r.vadi || pc === ((r.vadi % 12) + 12) % 12 ? 3 : pc === r.samvadi ? 2 : pc === 0 ? 2 : 1));
    const pc = r.rest[this.rng.weighted(weights)] as number;
    // Choose the octave of that pitch class closest to the drifting centre.
    const c = this.center + this.rng.bi() * 3;
    let best = pc;
    let bd = Infinity;
    for (let o = -2; o <= 2; o++) {
      const s = pc + 12 * o;
      const d = Math.abs(s - c);
      if (d < bd) {
        bd = d;
        best = s;
      }
    }
    while (best > this.register + 14) best -= 12;
    while (best < this.register - 13) best += 12;
    return best;
  }

  private walk(from: number, to: number): number[] {
    const path: number[] = [];
    let s = from;
    let guard = 0;
    while (s !== to && guard++ < 24) {
      s = to > s ? nextUp(this.raga, s) : nextDown(this.raga, s);
      if ((to > from && s > to) || (to < from && s < to)) s = to;
      path.push(s);
    }
    return path;
  }

  /** Advance the slow register plan (vistar): explore upward over minutes, then fall back to mandra/madhya. */
  private drift(section: Section): void {
    this.vistar += section === 'alap' ? 0.06 : 0.1;
    const plan = Math.sin(this.vistar * 0.35) * 0.5 + 0.5;
    this.center = this.register - 4 + plan * 12 + this.rng.bi() * 1.5;
  }

  /** Next phrase for the given section and intensity (0..1). */
  phrase(section: Section, intensity: number): Phrase {
    this.drift(section);
    const r = this.raga;
    const rng = this.rng;
    const kinds: Phrase['kind'][] = ['pakad', 'arc', 'descent', 'hover', 'tan'];
    // Tans (fast runs) are the climax spice of gat, not its staple.
    const w = [3, 4, 2.5, section === 'alap' ? 2 : 1, section === 'gat' ? 0.3 + 1.4 * intensity * intensity : section === 'jor' ? 0.2 : 0];
    const kind = kinds[rng.weighted(w)] as Phrase['kind'];
    let path: number[];
    const target = this.pickRest();
    switch (kind) {
      case 'pakad': {
        const p = rng.pick(r.pakad);
        const first = p[0] as number;
        const shift = Math.round((this.center - first) / 12) * 12;
        path = p.map((x) => x + shift);
        if (Math.abs((path[0] as number) - this.cur) > 7) path.unshift(...this.walk(this.cur, path[0] as number).slice(-2));
        break;
      }
      case 'arc': {
        const peakSteps = 2 + rng.int(4);
        let peak = Math.max(this.cur, target);
        for (let k = 0; k < peakSteps; k++) peak = nextUp(r, peak);
        path = [...this.walk(this.cur, peak), ...this.walk(peak, target)];
        break;
      }
      case 'descent': {
        // Start a few steps above both the current note and the target, then fall to the target.
        let top = Math.max(this.cur, target);
        for (let k = 0; k < 3 + rng.int(3); k++) top = nextUp(r, top);
        path = [top, ...this.walk(top, target)];
        break;
      }
      case 'hover': {
        // Dwell around the target: neighbour notes and back (andolan territory in slow sections).
        const up = nextUp(r, target);
        const dn = nextDown(r, target);
        path = [...this.walk(this.cur, target).slice(-2), up, target, dn, target];
        break;
      }
      case 'tan': {
        let s = this.cur;
        path = [];
        const upN = 5 + rng.int(6);
        for (let k = 0; k < upN; k++) path.push((s = nextUp(r, s)));
        const dnN = upN + rng.int(4);
        for (let k = 0; k < dnN; k++) path.push((s = nextDown(r, s)));
        path.push(...this.walk(s, target));
        break;
      }
      default:
        path = this.walk(this.cur, target);
    }
    if (path.length === 0) path = [target];
    // Keep inside a playable range around the register by transposing the WHOLE phrase (never folding
    // single notes, which would break the melodic line with octave leaps).
    const lo = this.register - 14;
    const hi = this.register + 15;
    let mx = -Infinity;
    let mn = Infinity;
    for (const x of path) {
      mx = Math.max(mx, x);
      mn = Math.min(mn, x);
    }
    let shift = 0;
    while (mx + shift > hi && mn + shift - 12 >= lo - 5) shift -= 12;
    while (mn + shift < lo && mx + shift + 12 <= hi + 5) shift += 12;
    // Pitch classes are preserved (octave moves only), so phrase endings stay on their nyas.
    path = path.map((x) => {
      let y = x + shift;
      while (y > hi + 5) y -= 12;
      while (y < lo - 5) y += 12;
      return y;
    });
    const notes = this.rhythm(path, section, intensity, kind);
    this.cur = path[path.length - 1] as number;
    this.lastPhrase = path;
    const last = notes[notes.length - 1] as PhraseNote;
    const rest = section === 'alap' ? 1.5 + rng.next() * 3 : section === 'jor' ? 1 + rng.int(2) : rng.chance(0.5) ? 1 : 0.5;
    return { notes, totalBeats: last.beat + last.beats + rest, kind };
  }

  /** A shorter answer (jawab) to the last phrase: its tail transposed to a nearby nyas, for the second voice. */
  answer(section: Section, intensity: number): Phrase {
    const src = this.lastPhrase.length ? this.lastPhrase.slice(-Math.min(4, this.lastPhrase.length)) : [this.cur];
    const shift = this.rng.chance(0.5) ? 0 : this.rng.chance(0.5) ? 12 : -12;
    const path = src.map((s) => this.snap(s + shift));
    const notes = this.rhythm(path, section, intensity, 'answer');
    const last = notes[notes.length - 1] as PhraseNote;
    return { notes, totalBeats: last.beat + last.beats + 1, kind: 'answer' };
  }

  private rhythm(path: number[], section: Section, intensity: number, kind: Phrase['kind']): PhraseNote[] {
    const rng = this.rng;
    const r = this.raga;
    const out: PhraseNote[] = [];
    let beat = 0;
    let prev = this.cur;
    const n = path.length;
    let cell: readonly number[] = [];
    let ci = 0;
    for (let i = 0; i < n; i++) {
      const s = path[i] as number;
      const lastNote = i === n - 1;
      let beats: number;
      if (kind === 'tan') beats = lastNote ? 2 : intensity > 0.75 ? 0.25 : 0.5;
      else if (section === 'alap') beats = lastNote ? 3 + rng.next() * 3 : rng.pick([1, 1.5, 2, 2, 3]);
      else if (section === 'jor') beats = lastNote ? 2 + rng.int(3) : rng.chance(0.25) ? 2 : 1;
      else {
        if (ci >= cell.length) {
          cell = rng.pick(GAT_CELLS);
          ci = 0;
        }
        beats = lastNote ? 1 + rng.int(2) : (cell[ci++] as number);
      }
      const interval = Math.abs(s - prev);
      const pc = ((s % 12) + 12) % 12;
      const meendP = section === 'alap' ? 0.55 : section === 'jor' ? 0.3 : 0.12;
      const meend = i > 0 && interval > 0 && interval <= 5 && beats >= 0.75 && rng.chance(meendP);
      const kan = !meend && beats >= 1 && rng.chance(section === 'gat' ? 0.1 : 0.2) ? nextUp(r, s) : null;
      const andolan = (r.andolan?.includes(pc) ?? false) && beats >= 1.5;
      const arch = Math.sin((Math.PI * (i + 0.5)) / n);
      out.push({ beat, beats, semis: s, meend, kan, andolan, vel: 0.7 + 0.25 * arch + rng.bi() * 0.05 });
      beat += beats;
      prev = s;
    }
    return out;
  }
}
