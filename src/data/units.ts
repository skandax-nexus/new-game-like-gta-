/**
 * Unit class definitions (GDD §4 table; DESIGN_SPEC §4). OWNER: Creative Director (balance); visuals
 * agreed with the Art Director.
 *
 * Units of measure (see DESIGN_SPEC §1.3):
 *  - hp/attack/defense are abstract combat points (formation-level math in sim/tactical/combat.ts).
 *  - speeds m/s; ranges/vision/spacing m; reload s; turnRate rad/s.
 *  - upkeepFood = grain measures per soldier (model) per day (1 measure = 10 person-days of rations;
 *    a civilian eats 0.1/day, a marching soldier 0.15/day, horses and elephants add fodder).
 *  - upkeepWealth = wealth per soldier (model) per month.
 *  - recruitCost is PER FORMATION (menPerFormation soldiers); population = recruits drawn from the pool.
 *  - mass is a compressed relative scale (infantry 1 .. elephant 9) used by charge shock.
 * Counter design (rock-paper-scissors): spears > horse/chariot > archers > spears;
 * elephants > melee & mounted but < archers/skirmishers & panic; guards > spears in melee.
 * Missile bonusVs applies to volleys too (DESIGN_SPEC §6.6). War elephants also PANIC under missile fire
 * (RULES.battle.elephantPanic, chance scales with `unruliness`) and trample whoever is in their way.
 * Pace target (DESIGN_SPEC §13): two lines 200-300 m apart meet in ~60-90 s at a walk; battles 3-8 min.
 */
import type { TerrainClass, TerrainEffect, UnitClass, UnitDef, UnitStats } from '../core/types';
import { TERRAIN_CLASSES } from '../core/types';

const E = (speed: number, attack = 1, defense = 1, fatigue = 1): TerrainEffect => ({ speed, attack, defense, fatigue });

/** Foot troops. Forest/hills/urban favor the defender; water and marsh are miserable for everyone. */
const INFANTRY_TERRAIN: Record<TerrainClass, TerrainEffect> = {
  open: E(1),
  road: E(1.15, 1, 0.95, 0.8),
  farmland: E(0.9, 1, 1, 1.05),
  forest: E(0.75, 0.9, 1.2, 1.15),
  hills: E(0.75, 1.05, 1.15, 1.3),
  rough: E(0.65, 0.9, 1.1, 1.35),
  marsh: E(0.45, 0.8, 0.85, 1.6),
  shallow_water: E(0.4, 0.7, 0.7, 1.8),
  deep_water: E(0.05, 0.3, 0.3, 3),
  urban: E(0.85, 1, 1.2, 1),
};

const SPEAR_TERRAIN: Record<TerrainClass, TerrainEffect> = {
  ...INFANTRY_TERRAIN,
  hills: E(0.75, 1.05, 1.25, 1.3),
  urban: E(0.85, 1, 1.25, 1),
};

const GUARD_TERRAIN: Record<TerrainClass, TerrainEffect> = {
  ...INFANTRY_TERRAIN,
  urban: E(0.85, 1.1, 1.3, 1),
};

/** Horse: superb in the open, poor in trees, broken ground and streets. */
const MOUNTED_TERRAIN: Record<TerrainClass, TerrainEffect> = {
  open: E(1, 1.1, 1, 1),
  road: E(1.1, 1, 0.95, 0.8),
  farmland: E(0.85, 1, 1, 1.1),
  forest: E(0.45, 0.6, 0.8, 1.5),
  hills: E(0.6, 0.85, 0.9, 1.4),
  rough: E(0.4, 0.6, 0.8, 1.6),
  marsh: E(0.3, 0.5, 0.7, 2),
  shallow_water: E(0.45, 0.6, 0.7, 1.6),
  deep_water: E(0.05, 0.2, 0.2, 3),
  urban: E(0.6, 0.7, 0.85, 1.2),
};

/** Light riders and runners: less penalized in woods than heavy horse. */
const SCOUT_TERRAIN: Record<TerrainClass, TerrainEffect> = {
  ...MOUNTED_TERRAIN,
  forest: E(0.65, 0.8, 1, 1.2),
  hills: E(0.7, 0.9, 1, 1.25),
  rough: E(0.55, 0.75, 0.9, 1.4),
};

/** Chariots: the open plain or nothing. */
const CHARIOT_TERRAIN: Record<TerrainClass, TerrainEffect> = {
  open: E(1, 1.2, 1, 1),
  road: E(1.1, 1.1, 1, 0.8),
  farmland: E(0.7, 0.9, 0.9, 1.2),
  forest: E(0.2, 0.3, 0.5, 2),
  hills: E(0.4, 0.5, 0.7, 1.8),
  rough: E(0.2, 0.3, 0.6, 2),
  marsh: E(0.15, 0.2, 0.5, 2.5),
  shallow_water: E(0.25, 0.3, 0.5, 2),
  deep_water: E(0.03, 0.1, 0.2, 3),
  urban: E(0.35, 0.4, 0.6, 1.5),
};

/** Elephants: heavy but sure-footed; wade rivers; dangerous in streets. */
const ELEPHANT_TERRAIN: Record<TerrainClass, TerrainEffect> = {
  open: E(1),
  road: E(1.05, 1, 1, 0.9),
  farmland: E(0.95),
  forest: E(0.8, 1, 1.1, 1.1),
  hills: E(0.7, 0.95, 1.05, 1.4),
  rough: E(0.7, 0.95, 1, 1.3),
  marsh: E(0.5, 0.8, 0.9, 1.5),
  shallow_water: E(0.75, 0.9, 0.9, 1.2),
  deep_water: E(0.2, 0.4, 0.5, 2.5),
  urban: E(0.6, 1.1, 0.9, 1.2),
};

/** Ox carts. */
const CART_TERRAIN: Record<TerrainClass, TerrainEffect> = {
  open: E(1),
  road: E(1.25, 1, 1, 0.7),
  farmland: E(0.8, 1, 1, 1.2),
  forest: E(0.3, 1, 1, 1.8),
  hills: E(0.45, 1, 1, 1.8),
  rough: E(0.3, 1, 1, 2),
  marsh: E(0.2, 1, 0.8, 2.5),
  shallow_water: E(0.3, 1, 0.8, 2),
  deep_water: E(0.03, 1, 0.5, 3),
  urban: E(0.7, 1, 1, 1.1),
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
  walkSpeed: 1.5,
  runSpeed: 3.5,
  turnRate: 0.6,
  mass: 1,
  baseMorale: 60,
  discipline: 0.5,
  fatigueRate: 0.01,
  visionRange: 300,
  spacingX: 1.1,
  spacingZ: 1.4,
  radius: 0.4,
  upkeepFood: 0.15,
  upkeepWealth: 0.25,
  recruitCost: { wealth: 300, food: 60, population: 100 },
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
    name: 'Spearmen',
    localName: 'Padati',
    shortName: 'SPR',
    role: 'Hold ground',
    constraint: 'Morale and formation discipline matter.',
    description: 'Levies with tall shields and bamboo-shafted spears. Braced in line they stop horse and chariot; caught in the open by arrows or flanked, they break.',
    category: 'infantry',
    stats: S({ menPerFormation: 120, hp: 10, meleeAttack: 6, meleeDefense: 9, chargeBonus: 3, armor: 2, walkSpeed: 1.5, runSpeed: 3.5, turnRate: 0.55, mass: 1, baseMorale: 60, discipline: 0.6, fatigueRate: 0.01, spacingX: 1.0, spacingZ: 1.4, upkeepFood: 0.15, upkeepWealth: 0.25, recruitCost: { wealth: 360, food: 60, population: 120 }, recruitDays: 10 }),
    terrain: checkTerrain(SPEAR_TERRAIN),
    bonusVs: { cavalry: 1.8, chariots: 1.7, war_elephants: 1.35, scouts: 1.4 },
    counters: { strongVs: ['cavalry', 'chariots', 'scouts'], weakVs: ['archers', 'elite_guards', 'war_elephants'] },
    defaultShape: 'line',
    allowedShapes: ['line', 'column', 'square', 'wedge', 'circle'],
    visual: { silhouette: 'spear_infantry', mount: 'none', weapon: 'spear', shield: 'tall', armor: 'quilted', headgear: 'turban', scale: 1, hasStandard: true },
    age: 'janapada',
    commandSlot: 0,
    historicity: 'reconstruction',
    sourceNote: 'Padati (foot soldiers) are one of the four arms named in early texts; equipment reconstructed.',
  },
  archers: {
    id: 'archers',
    name: 'Archers',
    localName: 'Dhanvin',
    shortName: 'ARC',
    role: 'Ranged support',
    constraint: 'Require protection, visibility and ammunition.',
    description: 'Bowmen with long bamboo bows. Murderous against elephants, carts and slow columns from behind a spear line; helpless if horsemen reach them.',
    category: 'ranged',
    stats: S({ menPerFormation: 100, hp: 8, meleeAttack: 3, meleeDefense: 3, rangedAttack: 6, range: 160, ammo: 20, reloadSec: 6, accuracy: 0.3, armor: 0.5, walkSpeed: 1.6, runSpeed: 3.8, turnRate: 0.8, baseMorale: 50, discipline: 0.45, visionRange: 350, spacingX: 1.2, spacingZ: 1.6, upkeepFood: 0.15, upkeepWealth: 0.3, recruitCost: { wealth: 400, food: 50, population: 100 }, recruitDays: 12 }),
    terrain: checkTerrain(INFANTRY_TERRAIN),
    bonusVs: { war_elephants: 1.5, chariots: 1.4, engineers: 1.4, supply_train: 1.3, cavalry: 0.9 },
    counters: { strongVs: ['war_elephants', 'chariots', 'spearmen'], weakVs: ['cavalry', 'scouts', 'elite_guards'] },
    defaultShape: 'line',
    allowedShapes: ['line', 'loose', 'column'],
    visual: { silhouette: 'archer', mount: 'none', weapon: 'bow', shield: 'none', armor: 'none', headgear: 'turban', scale: 1, hasStandard: true },
    age: 'janapada',
    commandSlot: 1,
    historicity: 'reconstruction',
    sourceNote: 'Long bamboo bows are described by Greek observers of the period; tactics reconstructed.',
  },
  elite_guards: {
    id: 'elite_guards',
    name: 'Royal Guards',
    localName: 'Maula',
    shortName: 'GRD',
    role: 'Protect commanders and reinforce key formations',
    constraint: 'Expensive.',
    description: 'Hereditary household warriors in scale coats with broad swords and round shields. They stand with the commander - and they cost as much as a village pays in a season.',
    category: 'infantry',
    stats: S({ menPerFormation: 60, hp: 14, meleeAttack: 10, meleeDefense: 11, chargeBonus: 5, armor: 4, walkSpeed: 1.5, runSpeed: 3.6, turnRate: 0.7, mass: 1.2, baseMorale: 85, discipline: 0.9, fatigueRate: 0.009, spacingX: 1.1, spacingZ: 1.4, upkeepFood: 0.18, upkeepWealth: 1.0, recruitCost: { wealth: 900, food: 40, population: 60 }, recruitDays: 20 }),
    terrain: checkTerrain(GUARD_TERRAIN),
    bonusVs: { spearmen: 1.25, archers: 1.3, engineers: 1.3, war_elephants: 1.1 },
    counters: { strongVs: ['spearmen', 'archers', 'engineers'], weakVs: ['war_elephants', 'cavalry'] },
    defaultShape: 'square',
    allowedShapes: ['line', 'column', 'square', 'wedge', 'circle'],
    visual: { silhouette: 'guard', mount: 'none', weapon: 'sword', shield: 'round', armor: 'scale', headgear: 'helmet', scale: 1.04, hasStandard: true },
    age: 'mahajanapada',
    commandSlot: 2,
    historicity: 'reconstruction',
    sourceNote: 'Maula (hereditary troops) appear in the Arthashastra list of troop types; the game role is a simplification.',
  },
  cavalry: {
    id: 'cavalry',
    name: 'Horsemen',
    localName: 'Ashvaroha',
    shortName: 'CAV',
    role: 'Reconnaissance, maneuver and pursuit',
    constraint: 'Terrain-dependent.',
    description: 'Riders with lance and sword on padded saddles. Shatter archers and carts, win the pursuit - and die on braced spears or before elephants they cannot make their horses face.',
    category: 'mounted',
    stats: S({ menPerFormation: 60, hp: 18, meleeAttack: 8, meleeDefense: 5, chargeBonus: 12, armor: 2, walkSpeed: 2.4, runSpeed: 8.5, turnRate: 1.0, mass: 3, baseMorale: 65, discipline: 0.55, fatigueRate: 0.012, visionRange: 450, spacingX: 1.8, spacingZ: 3.2, radius: 0.9, upkeepFood: 0.45, upkeepWealth: 0.9, recruitCost: { wealth: 720, food: 60, population: 60 }, recruitDays: 16 }),
    terrain: checkTerrain(MOUNTED_TERRAIN),
    bonusVs: { archers: 1.8, engineers: 1.8, supply_train: 2.0, scouts: 1.4, chariots: 1.2, spearmen: 0.7, war_elephants: 0.6 },
    counters: { strongVs: ['archers', 'engineers', 'supply_train'], weakVs: ['spearmen', 'war_elephants'] },
    defaultShape: 'wedge',
    allowedShapes: ['line', 'column', 'wedge', 'loose'],
    visual: { silhouette: 'horse_rider', mount: 'horse', weapon: 'spear', shield: 'small', armor: 'quilted', headgear: 'turban', scale: 1, hasStandard: true },
    age: 'mahajanapada',
    commandSlot: 3,
    historicity: 'reconstruction',
    sourceNote: 'Horses shying from elephants is a commonly reported ancient belief; used here as a game counter.',
  },
  chariots: {
    id: 'chariots',
    name: 'Chariots',
    localName: 'Ratha',
    shortName: 'CHR',
    role: 'Specialized, period-dependent shock and archery platform',
    constraint: 'Restricted by terrain and historical availability.',
    description: 'Two-horse cars carrying a driver and an archer. On a dry open plain they ride down archers and skirmishers; in woods, mud or broken ground they are firewood. No longer raised once an empire has its horse and elephant corps.',
    category: 'mounted',
    stats: S({ menPerFormation: 16, hp: 45, meleeAttack: 9, meleeDefense: 4, chargeBonus: 18, rangedAttack: 5, range: 120, ammo: 12, reloadSec: 5, accuracy: 0.3, armor: 3, walkSpeed: 2.2, runSpeed: 8.0, turnRate: 0.5, mass: 4, baseMorale: 60, discipline: 0.5, fatigueRate: 0.012, visionRange: 400, spacingX: 4, spacingZ: 6, radius: 1.8, upkeepFood: 1.2, upkeepWealth: 3.0, recruitCost: { wealth: 640, food: 60, population: 32 }, recruitDays: 18 }),
    terrain: checkTerrain(CHARIOT_TERRAIN),
    bonusVs: { archers: 1.6, engineers: 1.5, scouts: 1.3, supply_train: 1.5, spearmen: 0.7, elite_guards: 0.8, war_elephants: 0.5 },
    counters: { strongVs: ['archers', 'scouts', 'engineers'], weakVs: ['spearmen', 'war_elephants', 'elite_guards'] },
    defaultShape: 'line',
    allowedShapes: ['line', 'column', 'loose'],
    visual: { silhouette: 'chariot', mount: 'chariot', weapon: 'bow', shield: 'none', armor: 'scale', headgear: 'helmet', scale: 1, hasStandard: true },
    age: 'janapada',
    retiredInAge: 'samrajya',
    commandSlot: 4,
    historicity: 'reconstruction',
    sourceNote: 'Chariot use declined over the period; availability is age-gated (retired in the Samrajya Age).',
  },
  war_elephants: {
    id: 'war_elephants',
    name: 'War Elephants',
    localName: 'Gaja',
    shortName: 'ELE',
    role: 'Shock and disruption',
    constraint: 'Expensive to maintain and difficult to control.',
    description: 'Armored bulls with a mahout and two archers in the howdah. Their charge breaks lines and horses; arrows, javelins and panic can turn them back through their own ranks.',
    category: 'beast',
    stats: S({ menPerFormation: 8, hp: 160, meleeAttack: 20, meleeDefense: 8, chargeBonus: 30, rangedAttack: 3, range: 80, ammo: 10, reloadSec: 6, accuracy: 0.3, armor: 4, walkSpeed: 1.8, runSpeed: 4.5, turnRate: 0.35, mass: 9, baseMorale: 70, discipline: 0.4, fatigueRate: 0.011, visionRange: 350, spacingX: 6, spacingZ: 8, radius: 2.5, upkeepFood: 6, upkeepWealth: 8, recruitCost: { wealth: 1600, food: 300, population: 40 }, recruitDays: 30, siege: 5, unruliness: 0.12 }),
    terrain: checkTerrain(ELEPHANT_TERRAIN),
    bonusVs: { spearmen: 1.5, elite_guards: 1.3, cavalry: 1.7, chariots: 1.8, engineers: 1.5, supply_train: 1.8, archers: 1.2 },
    counters: { strongVs: ['cavalry', 'chariots', 'spearmen', 'elite_guards'], weakVs: ['archers', 'scouts'] },
    defaultShape: 'line',
    allowedShapes: ['line', 'column', 'loose'],
    visual: { silhouette: 'elephant', mount: 'elephant', weapon: 'bow', shield: 'none', armor: 'lamellar', headgear: 'crested', scale: 1, hasStandard: true },
    age: 'mahajanapada',
    commandSlot: 5,
    historicity: 'documented',
    sourceNote: 'War elephants are widely attested in ancient South Asian warfare; crew and armor details reconstructed.',
  },
  engineers: {
    id: 'engineers',
    name: 'Engineers',
    localName: 'Vishti',
    shortName: 'ENG',
    role: 'Siege works and construction',
    constraint: 'Require time and protection.',
    description: 'Carpenters, diggers and rope-men who raise palisades, throw bridges over fords and swing the ram against a gate.',
    category: 'support',
    stats: S({ menPerFormation: 40, hp: 9, meleeAttack: 3, meleeDefense: 3, armor: 1, walkSpeed: 1.5, runSpeed: 3.2, baseMorale: 45, discipline: 0.5, upkeepFood: 0.15, upkeepWealth: 0.6, recruitCost: { wealth: 300, food: 40, population: 40 }, recruitDays: 14, siege: 4 }),
    terrain: checkTerrain(INFANTRY_TERRAIN),
    bonusVs: {},
    counters: { strongVs: [], weakVs: ['cavalry', 'chariots', 'archers'] },
    defaultShape: 'loose',
    allowedShapes: ['loose', 'column', 'line'],
    visual: { silhouette: 'engineer', mount: 'none', weapon: 'tools', shield: 'none', armor: 'none', headgear: 'turban', scale: 1, hasStandard: false },
    age: 'janapada',
    commandSlot: 6,
    historicity: 'reconstruction',
    sourceNote: 'Vishti (labor corps) is named among army components in the Arthashastra; siege roles reconstructed.',
  },
  scouts: {
    id: 'scouts',
    name: 'Scouts',
    localName: 'Charaka',
    shortName: 'SCT',
    role: 'Reveal threats and routes',
    constraint: 'Vulnerable in direct combat.',
    description: 'Light riders and runners with javelins. They see the enemy first, harry carts and engineers and cut down men who run - and they die if they stand.',
    category: 'mounted',
    stats: S({ menPerFormation: 30, hp: 12, meleeAttack: 4, meleeDefense: 3, chargeBonus: 4, rangedAttack: 3, range: 40, ammo: 6, reloadSec: 4, accuracy: 0.4, armor: 0.5, walkSpeed: 2.8, runSpeed: 10.0, turnRate: 1.2, mass: 2.2, baseMorale: 50, discipline: 0.45, fatigueRate: 0.011, visionRange: 750, spacingX: 2.5, spacingZ: 3.5, radius: 0.9, upkeepFood: 0.4, upkeepWealth: 0.5, stealth: 0.6, recruitCost: { wealth: 240, food: 40, population: 30 }, recruitDays: 8 }),
    terrain: checkTerrain(SCOUT_TERRAIN),
    bonusVs: { supply_train: 1.8, engineers: 1.5, archers: 1.2, war_elephants: 1.3 },
    counters: { strongVs: ['supply_train', 'engineers', 'war_elephants'], weakVs: ['spearmen', 'cavalry', 'elite_guards'] },
    defaultShape: 'loose',
    allowedShapes: ['loose', 'line', 'column'],
    visual: { silhouette: 'scout', mount: 'horse', weapon: 'javelin', shield: 'small', armor: 'none', headgear: 'none', scale: 0.98, hasStandard: false },
    age: 'janapada',
    commandSlot: 7,
    historicity: 'reconstruction',
  },
  supply_train: {
    id: 'supply_train',
    name: 'Supply Train',
    localName: 'Shakata',
    shortName: 'SUP',
    role: 'Sustains campaigns',
    constraint: 'Roads and escorts are strategic assets.',
    description: 'Twelve ox carts of grain, arrows and fodder with their drovers. An army without them lives off the land - and the land remembers.',
    category: 'support',
    stats: S({ menPerFormation: 12, hp: 30, meleeAttack: 1, meleeDefense: 2, armor: 1, walkSpeed: 1.2, runSpeed: 1.8, turnRate: 0.3, mass: 5, baseMorale: 30, discipline: 0.3, spacingX: 4, spacingZ: 7, radius: 2, upkeepFood: 0.6, upkeepWealth: 0.5, supplyCapacity: 300, recruitCost: { wealth: 300, food: 100, population: 24 }, recruitDays: 6 }),
    terrain: checkTerrain(CART_TERRAIN),
    bonusVs: {},
    counters: { strongVs: [], weakVs: ['cavalry', 'scouts', 'chariots'] },
    defaultShape: 'column',
    allowedShapes: ['column', 'loose'],
    visual: { silhouette: 'cart', mount: 'ox_cart', weapon: 'none', shield: 'none', armor: 'none', headgear: 'turban', scale: 1, hasStandard: false },
    age: 'janapada',
    commandSlot: 8,
    historicity: 'reconstruction',
  },
};

export function getUnit(cls: UnitClass): UnitDef {
  return UNITS[cls];
}
