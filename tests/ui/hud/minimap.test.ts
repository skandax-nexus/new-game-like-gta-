/**
 * Minimap projection + layers (src/ui/services/minimapModel.ts): north-up and rotating projections round-trip,
 * the camera heading points up, facing ticks follow the CLAUDE.md convention, fog hides unseen enemy armies, borders
 * and roads come from the world, battle layers show own + spotted enemy formations; the battle map fits the action
 * (deploy zones + 25% margin, grow-only) so formations draw at least 6 x 3 px on a 220 px minimap.
 * OWNER: UI Engineer - In-game HUD, Command Card, Minimap & Input (UI-02).
 */
import { describe, expect, it } from 'vitest';
import { battleBounds, battleFitBounds, battleLayers, facingToMap, makeProjection, mapToWorld, relationOf, worldLayers, worldToMap } from '../../../src/ui/services/minimapModel';
import { campaign } from '../../sim/strategic/helpers';
import { testBattle } from '../../sim/tactical/helpers';

const bounds = { minX: -1000, minZ: -500, maxX: 1000, maxZ: 1500 };

describe('projection', () => {
  it('north-up: +X right, +Z down, bounds fill the square', () => {
    const p = makeProjection(bounds, 200, true, 0);
    expect(p.rotation).toBe(0);
    expect(worldToMap(p, 0, 500)).toEqual([100, 100]);
    expect(worldToMap(p, -1000, -500)).toEqual([0, 0]);
    expect(worldToMap(p, 1000, 1500)).toEqual([200, 200]);
    const [u, v] = worldToMap(p, 500, 500);
    expect(u).toBeGreaterThan(100);
    expect(v).toBeCloseTo(100);
  });

  it('round-trips at any camera heading', () => {
    for (const heading of [0, 0.7, Math.PI / 2, Math.PI, 4.1]) {
      const p = makeProjection(bounds, 220, false, heading);
      for (const [x, z] of [
        [0, 0],
        [-730, 1320],
        [999, -480],
      ] as const) {
        const [u, v] = worldToMap(p, x, z);
        const [x2, z2] = mapToWorld(p, u, v);
        expect(x2).toBeCloseTo(x, 6);
        expect(z2).toBeCloseTo(z, 6);
      }
    }
  });

  it('rotating: the camera heading points up (PI = looking north = north-up)', () => {
    const north = makeProjection(bounds, 200, false, Math.PI);
    expect(north.rotation).toBeCloseTo(0);
    // Looking east (forward = (sin h, cos h) = (1, 0)): a point east of the centre is drawn above it.
    const east = makeProjection(bounds, 200, false, Math.PI / 2);
    const [u, v] = worldToMap(east, 300, 500);
    expect(v).toBeLessThan(100);
    expect(u).toBeCloseTo(100, 6);
    // Looking south: south is up.
    const south = makeProjection(bounds, 200, false, 0);
    expect(worldToMap(south, 0, 900)[1]).toBeLessThan(100);
  });

  it('facing ticks: north-up facing PI points up, PI/2 (east) points right', () => {
    const p = makeProjection(bounds, 200, true, 0);
    const [nu, nv] = facingToMap(p, Math.PI);
    expect(nu).toBeCloseTo(0);
    expect(nv).toBeCloseTo(-1);
    const [eu, ev] = facingToMap(p, Math.PI / 2);
    expect(eu).toBeCloseTo(1);
    expect(ev).toBeCloseTo(0);
  });
});

describe('world layers', () => {
  const world = campaign(7);
  const me = world.playerFactionId;
  const cap = world.factions[me]!.capitalSettlementId!;
  const L = worldLayers(world, { kind: 'settlement', id: cap });

  it('every settlement, by relation, capitals starred, selection flagged', () => {
    expect(L.settlements).toHaveLength(Object.keys(world.settlements).length);
    const c = L.settlements.find((s) => s.id === cap)!;
    expect(c.relation).toBe('own');
    expect(c.capital).toBe(true);
    expect(c.selected).toBe(true);
    for (const s of L.settlements) expect(s.relation).toBe(relationOf(world, me, s.owner));
  });

  it('fog: enemy armies only when seen (visibility >= 0.5); own armies always', () => {
    for (const a of L.armies) {
      if (a.ghost) continue;
      const army = world.armies[a.id]!;
      if (army.factionId !== me) expect(army.visibility[me] ?? 0).toBeGreaterThanOrEqual(0.5);
    }
    const own = Object.values(world.armies).filter((a) => a.factionId === me && a.status !== 'garrisoned' && a.status !== 'disbanded');
    for (const a of own) expect(L.armies.some((m) => m.id === a.id && m.relation === 'own')).toBe(true);
    // Hide every enemy: none drawn (ghosts excepted).
    const blind = structuredClone(world);
    for (const a of Object.values(blind.armies)) if (a.factionId !== me) a.visibility[me] = 0;
    blind.factions[me]!.ghosts = {};
    expect(worldLayers(blind, { kind: 'none', id: null }).armies.every((a) => a.relation === 'own')).toBe(true);
  });

  it('borders per province and roads per edge; settlements and province centres project inside the map', () => {
    expect(L.borders.length).toBeGreaterThan(0);
    expect(L.roads.length).toBe(Object.keys(world.roads.edges).length);
    const p = makeProjection(world.region.bounds, 220, true, 0);
    const inside = (x: number, z: number): boolean => {
      const [u, v] = worldToMap(p, x, z);
      return u >= 0 && v >= 0 && u <= 220 && v <= 220;
    };
    for (const st of L.settlements) expect(inside(st.x, st.z), st.id).toBe(true);
    // Province polygons may overhang the region edge (the canvas clips them); their centres lie inside.
    for (const b of L.borders) {
      const cx = b.points.reduce((a, q) => a + q[0], 0) / b.points.length;
      const cz = b.points.reduce((a, q) => a + q[1], 0) / b.points.length;
      expect(inside(cx, cz), b.provinceId).toBe(true);
    }
  });
});

describe('battle layers', () => {
  it('own formations always, enemies only when spotted; deploy zones during deployment', () => {
    const tb = testBattle({
      factions: ['heartland', 'highland'],
      deploymentSec: 60,
      sides: [[{ cls: 'spearmen', x: 0, z: 200 }, { cls: 'archers', x: 60, z: 220 }], [{ cls: 'spearmen', x: 0, z: -200 }]],
    });
    const b = tb.state;
    const enemy = b.formations.find((f) => f.side === 1)!;
    enemy.spotted = false;
    let L = battleLayers(b, 0, [0]);
    expect(L.formations.map((f) => f.index)).toEqual(b.formations.filter((f) => f.side === 0).map((f) => f.index));
    expect(L.formations[0]!.selected).toBe(true);
    enemy.spotted = true;
    enemy.hidden = false;
    L = battleLayers(b, 0, []);
    expect(L.formations.some((f) => f.relation === 'enemy')).toBe(true);
    if (b.phase === 'deployment') expect(L.zones.filter((z) => z.own)).toHaveLength(1);
  });
});

describe('battle fit bounds', () => {
  const tb = testBattle({
    factions: ['heartland', 'highland'],
    deploymentSec: 60,
    sides: [[{ cls: 'spearmen', x: 0, z: 200 }, { cls: 'archers', x: 60, z: 220 }], [{ cls: 'spearmen', x: 0, z: -200 }]],
  });
  const b = tb.state;

  it('covers both deploy zones and every formation with a 25% margin, square, inside the terrain', () => {
    const full = battleBounds(b);
    const fit = battleFitBounds(b);
    expect(fit.maxX - fit.minX).toBeCloseTo(fit.maxZ - fit.minZ, 6);
    expect(fit.maxX - fit.minX).toBeLessThan(full.maxX - full.minX);
    expect(fit.minX).toBeGreaterThanOrEqual(full.minX - 1e-6);
    expect(fit.maxZ).toBeLessThanOrEqual(full.maxZ + 1e-6);
    for (const sd of b.setup.sides) {
      expect(fit.minX).toBeLessThanOrEqual(sd.deployZone.minX);
      expect(fit.maxX).toBeGreaterThanOrEqual(sd.deployZone.maxX);
      expect(fit.minZ).toBeLessThanOrEqual(sd.deployZone.minZ);
      expect(fit.maxZ).toBeGreaterThanOrEqual(sd.deployZone.maxZ);
    }
    for (const f of b.formations) {
      expect(f.x).toBeGreaterThan(fit.minX);
      expect(f.x).toBeLessThan(fit.maxX);
    }
    // A spearman block (tens of metres wide) maps to at least 6 px on a 220 px map.
    const p = makeProjection(fit, 220, true, 0);
    expect(b.formations[0]!.width / p.scale).toBeGreaterThanOrEqual(6);
  });

  it('grows (never shrinks) when a formation leaves the view; unchanged otherwise', () => {
    const fit = battleFitBounds(b);
    expect(battleFitBounds(b, fit)).toBe(fit);
    const moved = { ...b, formations: b.formations.map((f, i) => (i === 0 ? { ...f, x: fit.maxX + 150 } : f)) } as typeof b;
    const grown = battleFitBounds(moved, fit);
    expect(grown.maxX).toBeGreaterThan(fit.maxX);
    expect(grown.maxX - grown.minX).toBeGreaterThanOrEqual(fit.maxX - fit.minX);
  });
});
