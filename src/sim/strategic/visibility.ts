/**
 * Strategic visibility, ghost markers and intel-tier views (DESIGN_SPEC §7.7 "Visibility", §7.11 intel tiers).
 * OWNER: Simulation Engineer - Strategic World Simulation (SIM-01).
 *
 * An army is visible to faction F when it is within (350 + 250 if F's army has scouts) x F's scoutRange map m of any
 * of F's armies, within 350 x scoutRange of one of F's settlements (+ its radius), within 900 m of a settlement of F with
 * a Watchtower, or F's intel on its owner is >= 0.6, or F's gather_intel reveal is running. ArmyState.visibility[F] is
 * 1 / 0. When F loses sight of an army it keeps a ghost (last seen position - an hour back along a marching army's
 * heading - and soldiers estimated by its intel tier) for 5 days; regaining sight clears it (`army_sighted` for the
 * player). Updated every hour without allocations in the steady state.
 */
import type { ArmyGhost, ArmyState, FactionId, SimEvent, WorldState } from '../../core/types';
import { isRebelFaction } from '../../core/types';
import { deriveSeed, Rng } from '../../core/rng';
import { sortedKeys } from '../../core/ids';
import { dcos, dsin } from '../../core/math';
import { BALANCE } from '../../data/balance';
import { RULES } from '../../data/rules';
import { factionMod } from './modifiers';
import { stableKeys, today } from './state';

const A = RULES.armies;
/** Ghost markers are kept this many days. */
export const GHOST_DAYS = 5;
export const INTEL_SEE_ALL = 0.6;

function hasScouts(a: ArmyState): boolean {
  for (const u of a.units) if (u.unitClass === 'scouts' && u.soldiers > 0) return true;
  return false;
}

/** Intel level of observer on target (1 for itself; 0 for rebels / unknown). */
export function intelOn(world: WorldState, observer: FactionId, target: FactionId): number {
  if (observer === target) return 1;
  return world.espionage.intel[observer]?.[target]?.level ?? 0;
}

function revealed(world: WorldState, observer: FactionId, target: FactionId): boolean {
  if (isRebelFaction(target)) return false;
  const st = world.espionage.intel[observer]?.[target];
  if (!st) return false;
  return st.level >= INTEL_SEE_ALL || (st.armiesVisibleUntilDay !== null && st.armiesVisibleUntilDay > today(world));
}

/** Does faction `f` see army `a` right now? */
export function sees(world: WorldState, f: FactionId, a: ArmyState): boolean {
  if (a.factionId === f) return true;
  if (revealed(world, f, a.factionId)) return true;
  const range = factionMod(world, f, 'scoutRange');
  const armyIds = stableKeys('armies', world.armies as Record<string, unknown>);
  for (let i = 0; i < armyIds.length; i++) {
    const o = world.armies[armyIds[i] as string];
    if (!o || o.factionId !== f || o.units.length === 0) continue;
    const r = (A.scoutRadius + (hasScouts(o) ? A.scoutsBonusRadius : 0)) * range;
    if ((o.x - a.x) * (o.x - a.x) + (o.z - a.z) * (o.z - a.z) <= r * r) return true;
  }
  const sIds = stableKeys('settlements', world.settlements as Record<string, unknown>);
  for (let i = 0; i < sIds.length; i++) {
    const s = world.settlements[sIds[i] as string]!;
    if (s.ownerFactionId !== f) continue;
    const d2 = (s.x - a.x) * (s.x - a.x) + (s.z - a.z) * (s.z - a.z);
    const r = A.scoutRadius * range + s.radius;
    if (d2 <= r * r) return true;
    let tower = false;
    for (const b of s.buildings) if (b.type === 'watchtower' && b.level > 0) tower = true;
    if (tower && d2 <= A.watchtowerRadius * A.watchtowerRadius) return true;
  }
  return false;
}

/** Soldiers an observer believes an army has: exact at intel >= 0.6 or in sight, +-25% at 0.3-0.6, else a rough guess. */
export function estimatedSoldiers(world: WorldState, observer: FactionId, a: ArmyState): number {
  let n = 0;
  for (const u of a.units) n += u.soldiers;
  const intel = intelOn(world, observer, a.factionId);
  if (intel >= INTEL_SEE_ALL || a.factionId === observer) return n;
  // Deterministic per (army, observer, month) noise so the estimate does not flicker.
  const rng = new Rng(deriveSeed(world.seed, a.id, observer, Math.floor(today(world) / 30)));
  const spread = intel >= 0.3 ? 0.25 : 0.5;
  return Math.max(1, Math.round((n * (1 + rng.range(-spread, spread))) / 10) * 10);
}

// Observer scratch (reused every hour; transient, not state): per faction a run of circles (x, z, r^2).
let obsX = new Float64Array(64);
let obsZ = new Float64Array(64);
let obsR2 = new Float64Array(64);
let obsCount = 0;

function pushObserver(x: number, z: number, r: number): void {
  if (obsCount >= obsX.length) {
    const n = obsX.length * 2;
    const nx = new Float64Array(n);
    const nz = new Float64Array(n);
    const nr = new Float64Array(n);
    nx.set(obsX);
    nz.set(obsZ);
    nr.set(obsR2);
    obsX = nx;
    obsZ = nz;
    obsR2 = nr;
  }
  obsX[obsCount] = x;
  obsZ[obsCount] = z;
  obsR2[obsCount] = r * r;
  obsCount++;
}

/** Fill the observer circles of faction `fid` (its armies, settlements and watchtowers) - same rules as `sees`. */
function collectObservers(world: WorldState, fid: FactionId, armyIds: readonly string[], sIds: readonly string[]): void {
  obsCount = 0;
  const range = factionMod(world, fid, 'scoutRange');
  for (let i = 0; i < armyIds.length; i++) {
    const o = world.armies[armyIds[i] as string];
    if (!o || o.factionId !== fid || o.units.length === 0) continue;
    pushObserver(o.x, o.z, (A.scoutRadius + (hasScouts(o) ? A.scoutsBonusRadius : 0)) * range);
  }
  for (let i = 0; i < sIds.length; i++) {
    const s = world.settlements[sIds[i] as string]!;
    if (s.ownerFactionId !== fid) continue;
    pushObserver(s.x, s.z, A.scoutRadius * range + s.radius);
    for (const b of s.buildings) {
      if (b.type === 'watchtower' && b.level > 0) {
        pushObserver(s.x, s.z, A.watchtowerRadius);
        break;
      }
    }
  }
}

function observed(x: number, z: number): boolean {
  for (let k = 0; k < obsCount; k++) {
    const dx = (obsX[k] as number) - x;
    const dz = (obsZ[k] as number) - z;
    if (dx * dx + dz * dz <= (obsR2[k] as number)) return true;
  }
  return false;
}

/** Hourly visibility + ghosts for every faction (observer circles gathered once per faction). */
export function updateVisibilityHourly(world: WorldState, out: SimEvent[]): void {
  const fIds = stableKeys('factions', world.factions as Record<string, unknown>);
  const aIds = stableKeys('armies', world.armies as Record<string, unknown>);
  const sIds = stableKeys('settlements', world.settlements as Record<string, unknown>);
  const d = today(world);
  for (let k = 0; k < fIds.length; k++) {
    const fid = fIds[k] as string;
    const f = world.factions[fid];
    if (!f || !f.alive) continue;
    collectObservers(world, fid, aIds, sIds);
    for (let i = 0; i < aIds.length; i++) {
      const a = world.armies[aIds[i] as string];
      if (!a) continue;
      const prev = a.visibility[fid] ?? 0;
      const now = a.units.length > 0 && (a.factionId === fid || revealed(world, fid, a.factionId) || observed(a.x, a.z)) ? 1 : 0;
      if (prev !== now || a.visibility[fid] === undefined) a.visibility[fid] = now;
      if (a.factionId === fid) continue;
      if (prev > 0 && now === 0) {
        // Last seen an hour ago: step a marching army back along its heading by one hour of its march.
        const back = a.status === 'marching' ? (a.speedKmh * 1000) / BALANCE.military.travelScale : 0;
        const g: ArmyGhost = { armyId: a.id, factionId: a.factionId, x: a.x - dsin(a.facing) * back, z: a.z - dcos(a.facing) * back, facing: a.facing, soldiers: estimatedSoldiers(world, fid, a), day: d };
        f.ghosts[a.id] = g;
      } else if (prev === 0 && now > 0) {
        if (f.ghosts[a.id]) delete f.ghosts[a.id];
        if (f.isPlayer && a.factionId !== fid) out.push({ kind: 'army_sighted', armyId: a.id, factionId: a.factionId, observerFactionId: fid, x: a.x, z: a.z });
      }
    }
  }
}

/** Daily: drop ghosts older than 5 days or of armies that no longer exist (they are gone, not hidden). */
export function expireGhostsDaily(world: WorldState): void {
  const d = today(world);
  for (const fid of stableKeys('factions', world.factions as Record<string, unknown>)) {
    const g = world.factions[fid]!.ghosts;
    for (const id of sortedKeys(g)) if (d - g[id]!.day > GHOST_DAYS) delete g[id];
  }
}
