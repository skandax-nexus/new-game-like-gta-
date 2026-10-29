/**
 * OWNER: Engine Developer - Contracts & Save Schema (CORE-01). Contracts v2 invariants other tickets rely on:
 * action / SFX / screen id lists, default settings, quality presets per ART_BIBLE §13, URL params, the reserved
 * rebel faction id and the typed bus events.
 */
import { describe, expect, it } from 'vitest';
import type { GameSettings, QualitySettings } from '../../src/core/types';
import { AGE_IDS, HERO_MOODS, INPUT_ACTIONS, isRebelFaction, KEY_PRESETS, QUALITY_TIERS, REBEL_FACTION_ID, SCENE_IDS, SOLDIER_ANIM, SOLDIER_FLAG } from '../../src/core/types';
import { AUDIO_MOODS, AUDIO_STINGERS, createGameBus, SFX_KINDS } from '../../src/core/events';
import { DEFAULT_SETTINGS, defaultSettings, normalizeSettings } from '../../src/core/settings';
import { buildQualitySettings, QUALITY_PRESETS } from '../../src/core/quality';
import { parseUrlParams } from '../../src/core/params';
import { isScreenId, SCREEN_IDS } from '../../src/app/contracts';
import { FACTIONS } from '../../src/data/factions';
import { HERO_DISTRICTS } from '../../src/data/hero';

function dupes(list: readonly string[]): string[] {
  const seen = new Set<string>();
  return list.filter((x) => (seen.has(x) ? true : (seen.add(x), false)));
}

/** Deep key paths of a plain object ('shadows.pcss', 'crowdLod.vat0', ...). */
function paths(o: Record<string, unknown>, prefix = ''): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(o)) {
    const p = prefix ? `${prefix}.${k}` : k;
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) out.push(...paths(v as Record<string, unknown>, p));
    else out.push(p);
  }
  return out.sort();
}

describe('id lists', () => {
  it('INPUT_ACTIONS are unique and include the v2 actions', () => {
    expect(dupes(INPUT_ACTIONS)).toEqual([]);
    const v2 = ['shape_loose', 'shape_circle', 'order_stance', 'commander_rally', 'idle_builders_next', 'idle_army_next', 'select_capital', 'placement_rotate', 'card_next_tab', 'camera_rotate_left', 'camera_rotate_right', 'hero_attack_light', 'hero_attack_heavy', 'hero_roll', 'hero_guard', 'hero_salve', 'hero_lock_on', 'hero_skip_cinematic'];
    for (let i = 0; i < 15; i++) v2.push(`card_slot_${i}`);
    for (let i = 1; i <= 5; i++) v2.push(`dialogue_choice_${i}`);
    for (const a of v2) expect(INPUT_ACTIONS as readonly string[]).toContain(a);
  });

  it('SFX_KINDS are unique and include the melee and world additions', () => {
    expect(dupes(SFX_KINDS)).toEqual([]);
    for (const s of ['sword_light', 'sword_heavy', 'parry_ring', 'block_thud', 'roll_cloth', 'body_hit', 'stagger_grunt', 'salve', 'bell_temple', 'construction_complete', 'landmark_complete', 'age_up_fanfare', 'market_coins', 'gate_break', 'wall_crumble', 'ram_hit', 'fire_crackle', 'river_splash', 'footstep_stone', 'footstep_dirt']) {
      expect(SFX_KINDS as readonly string[]).toContain(s);
    }
  });

  it('screens, scenes, moods, stingers, presets and anim ids are unique', () => {
    for (const list of [SCREEN_IDS, SCENE_IDS, HERO_MOODS, AUDIO_MOODS, AUDIO_STINGERS, KEY_PRESETS, Object.keys(SOLDIER_ANIM)] as readonly (readonly string[])[]) expect(dupes(list)).toEqual([]);
    expect(dupes(Object.values(SOLDIER_ANIM).map(String))).toEqual([]);
    const flags = Object.values(SOLDIER_FLAG);
    expect(flags.every((f) => (f & (f - 1)) === 0)).toBe(true); // single bits
    expect(dupes(flags.map(String))).toEqual([]);
    expect(SCENE_IDS).toContain('lab');
    expect(SCREEN_IDS).toHaveLength(28);
    expect(isScreenId('market')).toBe(true);
    expect(isScreenId('nope')).toBe(false);
    for (const m of ['hero_explore', 'hero_combat', 'duel', 'siege']) expect(AUDIO_MOODS as readonly string[]).toContain(m);
  });

  it('every hero district mood is a HERO_MOODS id', () => {
    for (const d of HERO_DISTRICTS) expect(HERO_MOODS as readonly string[]).toContain(d.mood);
  });
});

describe('reserved rebel faction', () => {
  it('is never a playable or data faction', () => {
    expect(REBEL_FACTION_ID).toBe('rebels');
    expect(isRebelFaction('rebels')).toBe(true);
    expect(isRebelFaction('heartland')).toBe(false);
    expect(isRebelFaction(null)).toBe(false);
    expect(FACTIONS[REBEL_FACTION_ID]).toBeUndefined();
  });
});

describe('default settings', () => {
  const V2: (keyof GameSettings)[] = ['keyPreset', 'autoPause', 'hintsSeen', 'simpleMode', 'relationColoring', 'minimapNorthUp', 'holdToToggle', 'subtitles'];

  it('contain every new field with the documented defaults', () => {
    for (const k of V2) expect(DEFAULT_SETTINGS, k).toHaveProperty(k);
    expect(DEFAULT_SETTINGS.keyPreset).toBe('classic');
    expect(DEFAULT_SETTINGS.autoPause).toEqual({ battleStart: true, commanderFallen: true, formationRouted: true, narrativeEvents: true });
    expect(DEFAULT_SETTINGS.hintsSeen).toEqual([]);
    expect(DEFAULT_SETTINGS.simpleMode).toBe('auto');
    expect(DEFAULT_SETTINGS.holdToToggle).toEqual({ guard: false, run: false });
    expect(DEFAULT_SETTINGS.subtitles).toBe(true);
    expect(DEFAULT_SETTINGS.relationColoring).toBe(false);
    expect(DEFAULT_SETTINGS.minimapNorthUp).toBe(false);
  });

  it('settings stored by an older build gain the new fields; bad types are dropped', () => {
    const old = { quality: 'high', masterVolume: 0.3, colorblind: 'protan', keybindings: { order_hold: ['KeyQ'] } };
    const s = normalizeSettings(old);
    expect(s.quality).toBe('high');
    expect(s.masterVolume).toBe(0.3);
    expect(s.colorblind).toBe('protan');
    expect(s.keybindings).toEqual({ order_hold: ['KeyQ'] });
    expect(paths(s as unknown as Record<string, unknown>)).toEqual(paths(defaultSettings() as unknown as Record<string, unknown>).filter((p) => !p.startsWith('keybindings')).concat('keybindings.order_hold').sort());
    const partial = normalizeSettings({ autoPause: { battleStart: false }, holdToToggle: 'yes', hintsSeen: ['world.start', 3], keyPreset: 'qwerty', simpleMode: true, uiScale: '2' });
    expect(partial.autoPause).toEqual({ battleStart: false, commanderFallen: true, formationRouted: true, narrativeEvents: true });
    expect(partial.holdToToggle).toEqual({ guard: false, run: false });
    expect(partial.hintsSeen).toEqual(['world.start']);
    expect(partial.keyPreset).toBe('classic');
    expect(partial.simpleMode).toBe(true);
    expect(partial.uiScale).toBe(1);
    expect(normalizeSettings('garbage')).toEqual(defaultSettings());
  });

  it('defaultSettings() copies never share nested state', () => {
    const a = defaultSettings();
    a.autoPause.battleStart = false;
    a.hintsSeen.push('x');
    expect(DEFAULT_SETTINGS.autoPause.battleStart).toBe(true);
    expect(defaultSettings().hintsSeen).toEqual([]);
  });
});

describe('quality presets', () => {
  const REQUIRED_V2 = ['shadows.contact', 'shadows.pcss', 'ssr', 'dof', 'shaftsSamples', 'shaftsHalfRes', 'heightFog', 'lensEffects', 'grassDensity', 'practicalLights', 'treeImpostorDistance', 'villagerCap', 'crowdLod.vat0', 'crowdLod.vat1', 'crowdLod.impostor', 'emissiveBoost', 'bakedAoBoost', 'postMerged', 'audio.voices', 'audio.hrtf'];

  it('define every QualitySettings field for all 4 tiers (same structure, no holes)', () => {
    const ref = paths(QUALITY_PRESETS.ultra as unknown as Record<string, unknown>);
    for (const p of REQUIRED_V2) expect(ref).toContain(p);
    for (const tier of QUALITY_TIERS) {
      const q = QUALITY_PRESETS[tier] as unknown as Record<string, unknown>;
      expect(paths(q), tier).toEqual(ref);
      for (const p of ref) {
        const v = p.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown>)[k], q);
        expect(v, `${tier}.${p}`).not.toBeUndefined();
        if (typeof v === 'number') expect(Number.isFinite(v), `${tier}.${p}`).toBe(true);
      }
    }
  });

  it('follow ART_BIBLE §13 / DESIGN_SPEC §8.3 per tier', () => {
    const pick = <T>(f: (q: QualitySettings) => T): T[] => QUALITY_TIERS.map((t) => f(QUALITY_PRESETS[t]));
    expect(pick((q) => q.shadows.cascades)).toEqual([1, 2, 3, 4]);
    expect(pick((q) => q.shadows.mapSize)).toEqual([1024, 2048, 4096, 4096]);
    expect(pick((q) => q.shadows.pcss)).toEqual([false, false, true, true]);
    expect(pick((q) => q.shadows.contact)).toEqual([false, false, false, true]);
    expect(pick((q) => q.ssr)).toEqual([false, false, false, true]);
    expect(pick((q) => q.dof)).toEqual(['off', 'off', 'hero', 'close']);
    expect(pick((q) => q.shaftsSamples)).toEqual([0, 24, 32, 48]);
    expect(pick((q) => q.shaftsHalfRes)).toEqual([true, true, true, false]);
    expect(pick((q) => q.heightFog)).toEqual(['exp2', 'height', 'height_mist', 'height_mist']);
    expect(pick((q) => q.lensEffects)).toEqual([false, false, false, true]);
    expect(pick((q) => q.grassDensity)).toEqual([0, 18, 40, 70]);
    expect(pick((q) => q.practicalLights)).toEqual([1, 4, 8, 16]);
    expect(pick((q) => q.villagerCap)).toEqual([30, 60, 120, 200]);
    expect(pick((q) => q.treeImpostorDistance)[0]).toBe(90);
    expect(pick((q) => q.crowdLod.vat0)[0]).toBe(0); // low: VAT LOD1 + impostors only
    expect(pick((q) => q.particles)).toEqual([400, 1200, 3000, 6000]);
    expect(pick((q) => q.emissiveBoost)).toEqual([1.3, 1, 1, 1]);
    expect(pick((q) => q.bakedAoBoost)).toEqual([1.2, 1, 1, 1]);
    expect(pick((q) => q.postMerged)).toEqual([true, false, false, false]);
    expect(pick((q) => q.audio.voices)).toEqual([16, 32, 48, 48]);
    expect(pick((q) => q.audio.hrtf)).toEqual([false, false, true, true]);
    for (const t of QUALITY_TIERS) {
      const c = QUALITY_PRESETS[t].crowdLod;
      expect(c.vat0 <= c.vat1 && c.vat1 <= c.impostor, t).toBe(true);
    }
  });

  it('merge nested overrides of the new groups', () => {
    const s = buildQualitySettings('high', { crowdLod: { vat0: 10, vat1: 20, impostor: 30 } });
    expect(s.crowdLod).toEqual({ vat0: 10, vat1: 20, impostor: 30 });
    expect(s.shadows.pcss).toBe(true);
  });
});

describe('URL params (v2)', () => {
  it('parse every new deep-link parameter', () => {
    const p = parseUrlParams(
      '?scene=lab&lab=example&mission=walk_to_hall&mood=dawn_mist&district=ghats&camdist=2600&cine=c3&colorblind=protan&reducedmotion=1&keypreset=grid&bench=1&age=samrajya&deploy=0&csm=1&splat=a,b,c,d,e&clip=walk&count=500&kit=arch_a,arch_b',
    );
    expect(p.scene).toBe('lab');
    expect(p.lab).toBe('example');
    expect(p.mission).toBe('walk_to_hall');
    expect(p.mood).toBe('dawn_mist');
    expect(p.district).toBe('ghats');
    expect(p.camdist).toBe(2600);
    expect(p.cine).toBe('c3');
    expect(p.colorblind).toBe('protan');
    expect(p.reducedMotion).toBe(true);
    expect(p.keyPreset).toBe('grid');
    expect(p.bench).toBe(true);
    expect(p.age).toBe('samrajya');
    expect(p.deploy).toBe(0);
    expect(p.csm).toBe(true);
    expect(p.splat).toEqual(['a', 'b', 'c', 'd']);
    expect(p.clip).toBe('walk');
    expect(p.count).toBe(500);
    expect(p.kit).toEqual(['arch_a', 'arch_b']);
  });

  it('default / reject invalid values', () => {
    const p = parseUrlParams('?mood=sunny&age=iron&keypreset=x&colorblind=red&camdist=-4&count=0&deploy=abc&kit=,,&reducedmotion=0');
    expect(p.mood).toBeNull();
    expect(p.age).toBeNull();
    expect(p.keyPreset).toBeNull();
    expect(p.colorblind).toBeNull();
    expect(p.camdist).toBe(5);
    expect(p.count).toBe(1);
    expect(p.deploy).toBeNull();
    expect(p.kit).toBeNull();
    expect(p.reducedMotion).toBe(false);
    const none = parseUrlParams('');
    expect([none.lab, none.mission, none.reducedMotion, none.splat, none.bench, none.csm]).toEqual([null, null, null, null, false, false]);
    expect(AGE_IDS).toContain('janapada');
  });
});

describe('bus (v2 events)', () => {
  it('carries the new typed events', () => {
    const bus = createGameBus();
    const got: string[] = [];
    bus.on('ui:hint', (e) => got.push(`hint:${e.key}`));
    bus.on('hero:combat', (e) => got.push(`combat:${e.kind}:${e.strength}`));
    bus.on('world:alert', (e) => got.push(`alert:${e.kind}:${e.severity}`));
    bus.on('camera:shake', (e) => got.push(`shake:${e.amplitude}`));
    bus.on('audio:stinger', (e) => got.push(`stinger:${e.stinger}`));
    bus.on('audio:sfx', (e) => got.push(`sfx:${e.sfx}:${e.position?.x ?? '-'}`));
    bus.emit('ui:hint', { key: 'world.build_mode' });
    bus.emit('hero:combat', { kind: 'parry', x: 0, y: 1, z: 2, strength: 1 });
    bus.emit('world:alert', { kind: 'siege', x: 10, z: 20, severity: 'danger' });
    bus.emit('camera:shake', { amplitude: 0.05, durationSec: 0.2 });
    bus.emit('audio:stinger', { stinger: 'age_up' });
    bus.emit('audio:sfx', { sfx: 'parry_ring', position: { x: 3, y: 0, z: 1 } });
    bus.emit('audio:mood', { mood: 'duel', intensity: 1 });
    bus.emit('audio:listener', { x: 0, y: 2, z: 0, fx: 0, fy: 0, fz: 1 });
    bus.emit('audio:ambience', { layers: [{ key: 'river', gain: 0.6 }] });
    bus.emit('hero:mission_end', { missionId: 'duel_oath_stone', success: true });
    expect(got).toEqual(['hint:world.build_mode', 'combat:parry:1', 'alert:siege:danger', 'shake:0.05', 'stinger:age_up', 'sfx:parry_ring:3']);
  });
});
