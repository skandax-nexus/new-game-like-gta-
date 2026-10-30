/**
 * Hero HUD lab: `?scene=lab&lab=hero-hud`. OWNER: UI Engineer - In-game HUD, Command Card, Minimap & Input (UI-02).
 *
 * The hero HUD anchors (prompt bubble, lock-on reticle, enemy bars) placed on REAL 3D targets: a small staged
 * courtyard at golden hour with the hero seen from behind (third person), a potter to talk to, and a bandit captain
 * with two bandits. Every frame the lab projects each figure's head through the lab camera and pushes hero_hud props
 * exactly as GP-02's HeroScene will (promptAnchor / combat.lockOn / combat.enemies[].x,y in CSS px), so the HUD
 * follows the camera at frame rate (Screen.track) and the evidence shows the bubble and reticle on their targets,
 * not over the hero's head. Vitals / enemy health values are staged; the anchors are real projections.
 *
 *   __SAMRAJYA__.call('hero-hud.mode', 'explore' | 'combat')   switch the staged situation
 *   __SAMRAJYA__.call('hero-hud.clean', true)                   hide the lab title panel (captures)
 *   __SAMRAJYA__.call('hero-hud.state')                         { mode, anchors }
 */
import * as THREE from 'three';
import type { AppContext, HeroEnemyBar, ScreenPropsMap } from '../../../app/contracts';
import { DEBUG_UNHANDLED } from '../../../app/contracts';
import { SOLDIER_ANIM, UNIT_CLASS_INDEX, type UnitClass } from '../../../core/types';
import { createSoldierBuffers } from '../../../sim/tactical/soldiers';
import { SoldierRenderer } from '../../../render/units/soldierRenderer';
import { MATERIALS } from '../../../render/style/palette';
import type { LabHost, LabInstance, LabModule } from '../../../scenes/lab/types';

type Mode = 'explore' | 'combat';

interface Figure {
  id: string;
  cls: UnitClass;
  side: 0 | 1;
  x: number;
  z: number;
  facing: number;
  /** Head height for the anchor (m). */
  head: number;
}

const HERO: Figure = { id: 'hero', cls: 'elite_guards', side: 0, x: 0, z: 0, facing: Math.PI, head: 2.05 };
const POTTER: Figure = { id: 'potter', cls: 'engineers', side: 1, x: 3.2, z: -6.5, facing: -2.6, head: 2.0 };
const BOSS: Figure = { id: 'boss', cls: 'elite_guards', side: 1, x: 0.6, z: -8.5, facing: 0.1, head: 2.15 };
const BANDIT: Figure = { id: 'b1', cls: 'spearmen', side: 1, x: -4.2, z: -10.5, facing: 0.4, head: 2.0 };
const ARCHER: Figure = { id: 'b2', cls: 'archers', side: 1, x: 5.4, z: -12.5, facing: -0.4, head: 2.0 };

function setup(ctx: AppContext, host: LabHost): LabInstance {
  host.setEnvironment({ hour: 16.9 });
  let mode: Mode = ctx.params.mission === 'combat' ? 'combat' : 'explore';
  const figures = [HERO, POTTER, BOSS, BANDIT, ARCHER];
  const buffers = createSoldierBuffers(figures.length);
  buffers.count = figures.length;
  figures.forEach((f, i) => {
    buffers.unitClass[i] = UNIT_CLASS_INDEX[f.cls];
    buffers.side[i] = f.side;
    buffers.alive[i] = 1;
    buffers.variant[i] = 17 + i * 31;
    buffers.animSpeed[i] = 1;
    buffers.posX[i] = buffers.prevX[i] = f.x;
    buffers.posZ[i] = buffers.prevZ[i] = f.z;
    buffers.posY[i] = buffers.prevY[i] = 0;
    buffers.facing[i] = buffers.prevFacing[i] = f.facing;
    buffers.anim[i] = SOLDIER_ANIM.idle;
  });
  const people = host.own(new SoldierRenderer(buffers, { quality: ctx.quality.settings, sideColors: ['#d9792b', '#8c3b2a'] }));
  host.scene.add(people.object);

  // A few courtyard props so the targets stand somewhere: a well, a potter's stand with pots, a low wall.
  const stone = host.own(new THREE.MeshStandardMaterial({ color: new THREE.Color(MATERIALS.sandstone), roughness: 0.85 }));
  const clay = host.own(new THREE.MeshStandardMaterial({ color: new THREE.Color('#a4563a'), roughness: 0.7 }));
  const props = new THREE.Group();
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number): void => {
    const m = new THREE.Mesh(host.own(geo), mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    m.receiveShadow = true;
    props.add(m);
  };
  add(new THREE.CylinderGeometry(1.1, 1.2, 0.8, 24), stone, -3.2, 0.4, -5.5);
  add(new THREE.BoxGeometry(1.6, 0.7, 0.9), stone, 4.4, 0.35, -6.2);
  for (let i = 0; i < 4; i++) add(new THREE.SphereGeometry(0.22 + (i % 2) * 0.06, 16, 12), clay, 3.9 + i * 0.32, 0.9, -6.2);
  add(new THREE.BoxGeometry(22, 1.4, 0.7), stone, 0, 0.7, -17);
  host.scene.add(props);

  host.frame({ x: 0.9, y: 1.55, z: -3.5 }, 7.2, 8, 9);

  const v = new THREE.Vector3();
  const anchors: Record<string, { x: number; y: number; visible: boolean }> = {};
  const project = (f: Figure): { x: number; y: number; visible: boolean } => {
    v.set(f.x, f.head, f.z).project(host.camera);
    const w = Math.max(1, ctx.canvas.clientWidth);
    const hgt = Math.max(1, ctx.canvas.clientHeight);
    const x = ((v.x + 1) / 2) * w;
    const y = ((1 - v.y) / 2) * hgt;
    const a = { x, y, visible: v.z < 1 && x > 0 && x < w && y > 0 && y < hgt };
    anchors[f.id] = a;
    return a;
  };

  const props0 = (): ScreenPropsMap['hero_hud'] => {
    const touch = ctx.input.touchMode;
    if (mode === 'explore') {
      const a = project(POTTER);
      return {
        settlementName: 'Rajapura',
        prompt: 'Speak with the potter',
        promptAnchor: a.visible ? { x: a.x, y: a.y } : null,
        objective: 'Find the healer near the temple tank',
        compassHeading: Math.PI + 0.35,
        caption: { speaker: 'Potter', text: 'The healer? She left at dawn for the temple tank - follow the lamps.' },
        combat: null,
        touchControls: touch ? 'explore' : 'none',
      };
    }
    const lock = project(BOSS);
    const enemies: HeroEnemyBar[] = [
      { id: 'boss', name: 'Durjaya the Red', x: lock.x, y: lock.y, visible: lock.visible, hp: 310, hpMax: 400, poise: 40, poiseMax: 100, boss: true, unblockable: true },
      ...[BANDIT, ARCHER].map((f, i) => {
        const a = project(f);
        return { id: f.id, name: i === 0 ? 'Bandit' : 'Bandit archer', x: a.x, y: a.y, visible: a.visible, hp: i === 0 ? 30 : 45, hpMax: i === 0 ? 60 : 45, poise: i === 0 ? 20 : 30, poiseMax: i === 0 ? 40 : 30, boss: false, unblockable: false };
      }),
    ];
    // The reticle sits on the locked target's chest, a little below the head anchor.
    v.set(BOSS.x, BOSS.head * 0.62, BOSS.z).project(host.camera);
    const lx = ((v.x + 1) / 2) * Math.max(1, ctx.canvas.clientWidth);
    const ly = ((1 - v.y) / 2) * Math.max(1, ctx.canvas.clientHeight);
    return {
      settlementName: 'Rajapura',
      prompt: null,
      promptAnchor: null,
      objective: 'Defeat Durjaya and his bandits',
      compassHeading: Math.PI + 0.05,
      caption: null,
      touchControls: touch ? 'combat' : 'none',
      combat: { hp: 64, hpMax: 100, stamina: 38, staminaMax: 100, salveCharges: 2, salveMax: 3, lockOn: lock.visible ? { x: lx, y: ly } : null, slowMotion: false, enemies },
    };
  };

  const setMode = (m: Mode): void => {
    mode = m;
    // Exploring: the hero and the potter; combat: the hero, the bandit captain and two bandits.
    // The soldier renderer draws every buffer slot: a figure off stage is parked far outside the camera's range.
    const show = (i: number, on: boolean): void => {
      const f = figures[i]!;
      buffers.alive[i] = on ? 1 : 0;
      buffers.posX[i] = buffers.prevX[i] = on ? f.x : 1e6;
      buffers.posZ[i] = buffers.prevZ[i] = on ? f.z : 1e6;
    };
    show(1, m === 'explore');
    show(2, m === 'combat');
    show(3, m === 'combat');
    show(4, m === 'combat');
    ctx.ui.show('hero_hud', props0());
  };
  setMode(mode);

  let t = 0;
  return {
    update(dt) {
      t += dt;
      for (let i = 0; i < buffers.count; i++) {
        buffers.animTime[i] = t + i * 0.37;
      }
      people.update(1, host.camera);
      // Every frame: anchors follow the camera (the HUD re-renders at 10 Hz, track() moves the anchored parts).
      ctx.ui.update('hero_hud', props0());
    },
    dispose() {
      ctx.ui.hide('hero_hud');
      host.scene.remove(people.object, props);
    },
    debugCommand(name, args) {
      if (name === 'hero-hud.mode') {
        setMode(args[0] === 'combat' ? 'combat' : 'explore');
        return { mode };
      }
      if (name === 'hero-hud.clean') {
        const panel = ctx.uiRoot.querySelector('.lab-hud');
        if (panel instanceof HTMLElement) panel.style.display = args[0] === false ? '' : 'none';
        return { clean: args[0] !== false };
      }
      if (name === 'hero-hud.state') return { mode, anchors: { ...anchors } };
      return DEBUG_UNHANDLED;
    },
  };
}

export const LAB: LabModule = {
  id: 'hero-hud',
  title: 'Hero HUD on real targets',
  description: 'Prompt bubble, lock-on reticle and enemy bars anchored to projected 3D figures (UI-02).',
  sceneSize: 60,
  setup,
};
