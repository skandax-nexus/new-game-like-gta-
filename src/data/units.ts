/**
 * Unit class definitions (GDD §4 table). OWNER: Creative Director (balance), visuals agreed with the
 * Art Director. Placeholder numbers by the CTO - tune freely, keep the shape.
 */
import type { TerrainClass, TerrainEffect, UnitClass, UnitDef, UnitStats } from '../core/types';
import { TERRAIN_CLASSES } from '../core/types';

const E = (speed: number, attack = 1, defense = 1, fatigue = 1): TerrainEffect => ({ speed, attack, defense, fatigue });

/** Default terrain table per movement category; units override entries. */
const INFANTRY_TERRAIN: Record<TerrainClass, TerrainEffect> = {
  open: E(1),
  road: E(1.15, 1, 1, 0.8),
  farmland: E(0.9, 1, 1, 1.05),
  forest: E(0.7, 0.9, 1.15, 1.2),
  hills: E(0.75, 1.05, 1.15, 1.3),
  rough: E(0.6, 0.9, 1.1, 1.4),
  marsh: E(0.45, 0.8, 0.85, 1.6),
  shallow_water: E(0.4, 0.7, 0.7, 1.8),
  deep_water: E(0.05, 0.3, 0.3, 3),
  urban: E(0.85, 1, 1.2, 1),
};

const MOUNTED_TERRAIN: Record<TerrainClass, TerrainEffect> = {
  ...INFANTRY_TERRAIN,
  open: E(1, 1.1),
  road: E(1.1, 1, 1, 0.8),
  forest: E(0.45, 0.6, 0.8, 1.5),
  hills: E(0.6, 0.85, 0.9, 1.4),
  rough: E(0.4, 0.6, 0.8, 1.6),
  marsh: E(0.3, 0.5, 0.7, 2),
  shallow_water: E(0.45, 0.6, 0.7, 1.6),
  urban: E(0.6, 0.7, 0.9, 1.2),
};

const CHARIOT_TERRAIN: Record<TerrainClass, TerrainEffect> = {
  ...MOUNTED_TERRAIN,
  open: E(1, 1.2),
  farmland: E(0.75, 0.9),
  forest: E(0.2, 0.3, 0.5, 2),
  hills: E(0.4, 0.5, 0.7, 1.8),
  rough: E(0.2, 0.3, 0.6, 2),
  marsh: E(0.15, 0.2, 0.5, 2.5),
  shallow_water: E(0.25, 0.3, 0.5, 2),
  urban: E(0.4, 0.5, 0.7, 1.5),
};

const ELEPHANT_TERRAIN: Record<TerrainClass, TerrainEffect> = {
  ...INFANTRY_TERRAIN,
  forest: E(0.75, 1, 1.1, 1.1),
  shallow_water: E(0.7, 0.9, 0.9, 1.2),
  marsh: E(0.5, 0.8, 0.9, 1.5),
  deep_water: E(0.2, 0.4, 0.5, 2.5),
};

function checkTerrain(t: Record<TerrainClass, TerrainEffect>): Record<TerrainClass, TerrainEffect> {
  for (const c of TERRAIN_CLASSES) if (!t[c]) throw new Error(`terrain table missing ${c}`);
  return t;
}

const base: UnitStats = {
  menPerFormation: 100,
  hp: 10,
  meleeAttack: 5,
  meleeDefense: 5,
  chargeBonus: 0,
  rangedAttack: 0,
  range: 0,
  ammo: 0,
  reloadSec: 0,
  accuracy: 0,
  armor: 1,
  walkSpeed: 1.4,
  runSpeed: 3.2,
  turnRate: 0.6,
  mass: 1,
  baseMorale: 60,
  discipline: 0.5,
  fatigueRate: 0.01,
  visionRange: 300,
  spacingX: 1.1,
  spacingZ: 1.4,
  radius: 0.4,
  upkeepFood: 1,
  upkeepWealth: 0.3,
  recruitCost: { wealth: 100, food: 150, population: 100 },
  recruitDays: 10,
  siege: 0,
  supplyCapacity: 0,
  stealth: 0,
  unruliness: 0,
};

const S = (s: Partial<UnitStats>): UnitStats => ({ ...base, ...s });

export const UNITS: Readonly<Record<UnitClass, UnitDef>> = {
  spearmen: {
    id: 'spearmen',
    name: 'Infantry & Spearmen',
    role: 'Hold ground',
    constraint: 'Morale and formation discipline matter.',
    description: 'The backbone of every host: shields locked, spears leveled, holding the line.',
    category: 'infantry',
    stats: S({ menPerFormation: 120, hp: 10, meleeAttack: 6, meleeDefense: 8, chargeBonus: 2, armor: 2, baseMorale: 60, discipline: 0.6 }),
    terrain: checkTerrain(INFANTRY_TERRAIN),
    bonusVs: { cavalry: 1.6, chariots: 1.5, war_elephants: 1.25 },
    defaultShape: 'line',
    allowedShapes: ['line', 'column', 'square', 'wedge', 'circle'],
    visual: { silhouette: 'spear_infantry', mount: 'none', weapon: 'spear', shield: 'tall', armor: 'quilted', headgear: 'turban', scale: 1, hasStandard: true },
    historicity: 'reconstruction',
  },
  archers: {
    id: 'archers',
    name: 'Archers',
    role: 'Ranged support',
    constraint: 'Require protection, visibility and ammunition.',
    description: 'Longbowmen who darken the sky - deadly behind a shield wall, helpless when caught.',
    category: 'ranged',
    stats: S({ menPerFormation: 100, hp: 8, meleeAttack: 3, meleeDefense: 3, rangedAttack: 5, range: 170, ammo: 24, reloadSec: 6, accuracy: 0.35, armor: 0.5, runSpeed: 3.4, turnRate: 0.8, baseMorale: 50, discipline: 0.45, spacingX: 1.2, spacingZ: 1.6 }),
    terrain: checkTerrain(INFANTRY_TERRAIN),
    bonusVs: { war_elephants: 1.2, chariots: 1.1 },
    defaultShape: 'line',
    allowedShapes: ['line', 'loose', 'column'],
    visual: { silhouette: 'archer', mount: 'none', weapon: 'bow', shield: 'none', armor: 'none', headgear: 'turban', scale: 1, hasStandard: true },
    historicity: 'reconstruction',
  },
  elite_guards: {
    id: 'elite_guards',
    name: 'Elite Guards',
    role: 'Protect commanders and reinforce key formations',
    constraint: 'Expensive.',
    description: 'Sworn household warriors in scale armor who stand beside the commander to the last.',
    category: 'infantry',
    stats: S({ menPerFormation: 60, hp: 14, meleeAttack: 10, meleeDefense: 11, chargeBonus: 4, armor: 4, baseMorale: 85, discipline: 0.9, upkeepWealth: 1.2, recruitCost: { wealth: 420, food: 120, population: 60 }, recruitDays: 20 }),
    terrain: checkTerrain(INFANTRY_TERRAIN),
    bonusVs: { spearmen: 1.15 },
    defaultShape: 'square',
    allowedShapes: ['line', 'column', 'square', 'wedge', 'circle'],
    visual: { silhouette: 'guard', mount: 'none', weapon: 'sword', shield: 'round', armor: 'scale', headgear: 'helmet', scale: 1.04, hasStandard: true },
    historicity: 'reconstruction',
  },
  cavalry: {
    id: 'cavalry',
    name: 'Cavalry',
    role: 'Reconnaissance, maneuver and pursuit',
    constraint: 'Terrain-dependent.',
    description: 'Horsemen with lance and sword - masters of the flank and the pursuit.',
    category: 'mounted',
    stats: S({ menPerFormation: 60, hp: 16, meleeAttack: 8, meleeDefense: 5, chargeBonus: 10, armor: 2, walkSpeed: 2.5, runSpeed: 8, turnRate: 1, mass: 4, baseMorale: 65, discipline: 0.55, visionRange: 450, spacingX: 1.8, spacingZ: 3.2, radius: 0.9, upkeepFood: 3, upkeepWealth: 0.9, recruitCost: { wealth: 300, food: 200, population: 60 }, recruitDays: 16 }),
    terrain: checkTerrain(MOUNTED_TERRAIN),
    bonusVs: { archers: 1.5, engineers: 1.5, supply_train: 1.6, scouts: 1.2 },
    defaultShape: 'wedge',
    allowedShapes: ['line', 'column', 'wedge', 'loose'],
    visual: { silhouette: 'horse_rider', mount: 'horse', weapon: 'spear', shield: 'small', armor: 'quilted', headgear: 'turban', scale: 1, hasStandard: true },
    historicity: 'reconstruction',
  },
  chariots: {
    id: 'chariots',
    name: 'Chariots',
    role: 'Specialized, period-dependent shock and archery platform',
    constraint: 'Restricted by terrain and historical availability.',
    description: 'Two-horse chariots carrying a driver and an archer - devastating on open plains, useless in broken ground.',
    category: 'mounted',
    stats: S({ menPerFormation: 16, hp: 40, meleeAttack: 9, meleeDefense: 4, chargeBonus: 16, rangedAttack: 4, range: 110, ammo: 12, reloadSec: 5, accuracy: 0.3, armor: 3, walkSpeed: 2.2, runSpeed: 7, turnRate: 0.5, mass: 8, baseMorale: 60, discipline: 0.5, spacingX: 4, spacingZ: 6, radius: 1.8, upkeepFood: 5, upkeepWealth: 3, recruitCost: { wealth: 380, food: 150, population: 32 }, recruitDays: 18 }),
    terrain: checkTerrain(CHARIOT_TERRAIN),
    bonusVs: { archers: 1.4, spearmen: 0.8 },
    defaultShape: 'line',
    allowedShapes: ['line', 'column', 'loose'],
    visual: { silhouette: 'chariot', mount: 'chariot', weapon: 'bow', shield: 'none', armor: 'scale', headgear: 'helmet', scale: 1, hasStandard: true },
    historicity: 'reconstruction',
    sourceNote: 'Chariot use declined over the period; availability is a scenario setting.',
  },
  war_elephants: {
    id: 'war_elephants',
    name: 'War Elephants',
    role: 'Shock and disruption',
    constraint: 'Expensive to maintain and difficult to control.',
    description: 'Armored elephants with howdah archers - they break lines, and sometimes their own.',
    category: 'beast',
    stats: S({ menPerFormation: 8, hp: 220, meleeAttack: 22, meleeDefense: 8, chargeBonus: 30, rangedAttack: 3, range: 80, ammo: 10, reloadSec: 6, accuracy: 0.3, armor: 6, walkSpeed: 1.6, runSpeed: 4, turnRate: 0.35, mass: 40, baseMorale: 70, discipline: 0.4, visionRange: 350, spacingX: 6, spacingZ: 8, radius: 2.5, upkeepFood: 40, upkeepWealth: 6, recruitCost: { wealth: 900, food: 600, population: 24 }, recruitDays: 30, siege: 5, unruliness: 0.12 }),
    terrain: checkTerrain(ELEPHANT_TERRAIN),
    bonusVs: { spearmen: 1.3, cavalry: 1.5, chariots: 1.4, engineers: 1.5 },
    defaultShape: 'line',
    allowedShapes: ['line', 'column', 'loose'],
    visual: { silhouette: 'elephant', mount: 'elephant', weapon: 'bow', shield: 'none', armor: 'lamellar', headgear: 'crested', scale: 1, hasStandard: true },
    historicity: 'documented',
    sourceNote: 'War elephants are widely attested in ancient South Asian warfare; details reconstructed.',
  },
  engineers: {
    id: 'engineers',
    name: 'Engineers',
    role: 'Siege works and construction',
    constraint: 'Require time and protection.',
    description: 'Sappers and carpenters who raise palisades, bridge rivers and batter gates.',
    category: 'support',
    stats: S({ menPerFormation: 40, hp: 9, meleeAttack: 3, meleeDefense: 3, armor: 1, baseMorale: 45, discipline: 0.5, siege: 4, upkeepWealth: 0.6, recruitCost: { wealth: 220, food: 100, population: 40 }, recruitDays: 14 }),
    terrain: checkTerrain(INFANTRY_TERRAIN),
    bonusVs: {},
    defaultShape: 'loose',
    allowedShapes: ['loose', 'column', 'line'],
    visual: { silhouette: 'engineer', mount: 'none', weapon: 'tools', shield: 'none', armor: 'none', headgear: 'turban', scale: 1, hasStandard: false },
    historicity: 'reconstruction',
  },
  scouts: {
    id: 'scouts',
    name: 'Scouts',
    role: 'Reveal threats and routes',
    constraint: 'Vulnerable in direct combat.',
    description: 'Light riders and runners with javelins who see the enemy before the enemy sees them.',
    category: 'mounted',
    stats: S({ menPerFormation: 30, hp: 12, meleeAttack: 4, meleeDefense: 3, chargeBonus: 4, rangedAttack: 3, range: 40, ammo: 6, reloadSec: 4, accuracy: 0.4, armor: 0.5, walkSpeed: 2.6, runSpeed: 9, turnRate: 1.2, mass: 3, baseMorale: 50, discipline: 0.45, visionRange: 750, spacingX: 2.5, spacingZ: 3.5, radius: 0.9, upkeepFood: 2, upkeepWealth: 0.6, stealth: 0.6, recruitCost: { wealth: 160, food: 100, population: 30 }, recruitDays: 8 }),
    terrain: checkTerrain(MOUNTED_TERRAIN),
    bonusVs: { supply_train: 1.4, engineers: 1.2 },
    defaultShape: 'loose',
    allowedShapes: ['loose', 'line', 'column'],
    visual: { silhouette: 'scout', mount: 'horse', weapon: 'javelin', shield: 'small', armor: 'none', headgear: 'none', scale: 0.98, hasStandard: false },
    historicity: 'reconstruction',
  },
  supply_train: {
    id: 'supply_train',
    name: 'Supply Train',
    role: 'Sustains campaigns',
    constraint: 'Roads and escorts are strategic assets.',
    description: 'Ox carts of grain, arrows and fodder - the army marches on them.',
    category: 'support',
    stats: S({ menPerFormation: 10, hp: 30, meleeAttack: 1, meleeDefense: 2, armor: 1, walkSpeed: 1.1, runSpeed: 1.6, turnRate: 0.3, mass: 6, baseMorale: 30, discipline: 0.3, spacingX: 4, spacingZ: 7, radius: 2, upkeepFood: 4, upkeepWealth: 0.5, supplyCapacity: 600, recruitCost: { wealth: 120, food: 300, population: 20 }, recruitDays: 6 }),
    terrain: checkTerrain(CHARIOT_TERRAIN),
    bonusVs: {},
    defaultShape: 'column',
    allowedShapes: ['column', 'loose'],
    visual: { silhouette: 'cart', mount: 'ox_cart', weapon: 'none', shield: 'none', armor: 'none', headgear: 'turban', scale: 1, hasStandard: false },
    historicity: 'reconstruction',
  },
};

export function getUnit(cls: UnitClass): UnitDef {
  return UNITS[cls];
}
