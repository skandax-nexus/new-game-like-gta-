/**
 * SAMRAJYA - THE CONTRACT. OWNER: CTO (Contracts v2 landed by CORE-01, Sprint 1).
 *
 * Domain types shared by every module. Owned by the CTO; request changes via your report.
 *
 * Rules:
 *  - This file is three-free and DOM-free. It may be imported from anywhere (sim, data, render, ui).
 *  - All state reachable from `WorldState` / `BattleState` must be plain JSON-serializable data
 *    (no class instances, no Maps/Sets, no functions, no `undefined` values that matter - use `null`).
 *    Typed arrays are allowed only in derived/runtime structures (`SoldierBuffers`, heightfield grids).
 *  - Units: distances in meters, time in seconds (battle) or hours/days (strategic), angles in radians.
 *  - World axes follow three.js: +X east, +Y up, +Z south. Ground plane is X/Z.
 *  - Facing angle θ: forward vector = (sin θ, cos θ) in (x, z). θ = 0 faces +Z. A three.js object with
 *    `rotation.y = θ` whose model is authored facing +Z faces the same direction.
 *  - Normalized quantities are 0..1 unless documented otherwise. Morale is 0..100.
 *
 * Contracts v2 (save format 2, docs/ARCHITECTURE.md "Contracts v2 (Sprint 1)"):
 *  - Every new persistent field is REQUIRED, initialised where the object is created and defaulted by the
 *    v1 -> v2 migration in core/save.ts. Optional (`?`) only where absence is meaningful (placement `cell`/`rot`,
 *    `landmarkId`, `rallyPoint`, `rebelSettlementId`, setup inputs). Fields tagged `@sprint1 <ticket>` are
 *    contract-only until that ticket implements the behaviour (they hold their neutral default meanwhile).
 */

// =====================================================================================================
// Common
// =====================================================================================================

export type FactionId = string;
export type SettlementId = string;
export type ProvinceId = string;
export type ArmyId = string;
export type ArmyUnitId = string;
export type CharacterId = string;
export type DynastyId = string;
export type DepotId = string;
export type RoadNodeId = string;
export type RoadEdgeId = string;
export type EventDefId = string;
export type EventInstanceId = string;
export type ScenarioId = string;
export type BattleId = string;
export type EngagementId = string;
export type TreatyId = string;
export type ProposalId = string;
export type AgentId = string;
export type ObjectiveId = string;
/** Index into `BattleState.formations`. Stable for the lifetime of a battle. */
export type FormationIndex = number;

export interface Vec2 {
  x: number;
  z: number;
}
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}
/** Axis-aligned rectangle on the ground plane (meters). */
export interface Rect {
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
}
/** CSS-style hex color, e.g. "#c8501e". three.js `Color` accepts these directly. */
export type HexColor = `#${string}`;

/** GDD §1 pillar "Historical care": every authored data entry declares its basis. */
export type Historicity = 'documented' | 'reconstruction' | 'fictional';
export interface Sourced {
  historicity: Historicity;
  /** Short citation / research note for reviewers. Never shown as fact in-game unless documented. */
  sourceNote?: string;
}

export type SideIndex = 0 | 1;
export type CompareOp = '<' | '<=' | '>' | '>=' | '==' | '!=';

/** Utility: keys of T whose values are numbers (used by the event condition/effect DSL). */
export type NumericKeys<T> = { [K in keyof T]-?: T[K] extends number ? K : never }[keyof T];

// =====================================================================================================
// Game modes, scenes, difficulty
// =====================================================================================================

export const GAME_MODES = ['campaign', 'sandbox', 'skirmish'] as const;
export type GameMode = (typeof GAME_MODES)[number];

/**
 * `assetviewer` = debug/lookdev view of a content-pipeline asset (?scene=assetviewer&asset=<id>).
 * `lab` = feature lab for graphics/gameplay work the game scenes do not drive yet (?scene=lab&lab=<id>,
 * `*.lab.ts` modules, src/scenes/LabScene.ts).
 */
export const SCENE_IDS = ['boot', 'menu', 'world', 'battle', 'hero', 'assetviewer', 'lab'] as const;
export type SceneId = (typeof SCENE_IDS)[number];

export const DIFFICULTIES = ['easy', 'normal', 'hard', 'very_hard'] as const;
export type Difficulty = (typeof DIFFICULTIES)[number];

// =====================================================================================================
// Calendar, seasons, weather, environment  (GDD §6 seasonal systems)
// =====================================================================================================

/**
 * The six Indian ritus, two months each. Gameplay mapping:
 *  vasanta  (spring, months 0-1)   rabi harvest, good campaigning
 *  grishma  (summer, months 2-3)   heat, drought risk, fatigue
 *  varsha   (monsoon, months 4-5)  rain, floods, mud, slow travel, kharif sowing
 *  sharad   (autumn, months 6-7)   kharif harvest, campaign season opens
 *  hemanta  (pre-winter, 8-9)      pleasant, rabi sowing
 *  shishira (winter, months 10-11) cool, fog
 */
export const SEASONS = ['vasanta', 'grishma', 'varsha', 'sharad', 'hemanta', 'shishira'] as const;
export type Season = (typeof SEASONS)[number];

export const MONTHS_PER_YEAR = 12;
export const DAYS_PER_MONTH = 30;
export const HOURS_PER_DAY = 24;
export const DAYS_PER_YEAR = MONTHS_PER_YEAR * DAYS_PER_MONTH;

export interface CalendarState {
  /** Display year; negative = BCE (e.g. -300 is 300 BCE). Increments when month wraps to 0. */
  year: number;
  /** 0..11, 0 = Chaitra (approx. March-April). */
  month: number;
  /** 0..29 */
  day: number;
  /** 0..23 */
  hour: number;
  /** Monotonic hours since campaign start. The strategic sim tick counter. */
  totalHours: number;
}

export const WEATHER_KINDS = [
  'clear',
  'hazy',
  'cloudy',
  'overcast',
  'light_rain',
  'monsoon_rain',
  'storm',
  'dust_storm',
  'fog',
] as const;
export type WeatherKind = (typeof WEATHER_KINDS)[number];

export interface WeatherState {
  kind: WeatherKind;
  /** 0..1 sky coverage. */
  cloudCover: number;
  /** 0..1 precipitation intensity. */
  rain: number;
  /** Radians, direction the wind blows TOWARD (same convention as facing). */
  windDirection: number;
  /** m/s */
  windSpeed: number;
  temperatureC: number;
  /** 0..1 */
  humidity: number;
  /** Meters of clear visibility (affects scouting, archers, fog rendering). */
  visibility: number;
  /** 0..1 ground wetness / mud (affects movement + terrain shading). */
  wetness: number;
  /** 0..1 river flood stage (raises water level visually; floods low settlements). */
  flood: number;
  /** Days the current weather persists before the next roll. */
  daysRemaining: number;
}

/** Everything the renderer/audio needs to present sky, light, weather and seasons. Three-free. */
export interface EnvironmentState {
  /** Fractional hour of day 0..24. */
  hour: number;
  /** 0..359 */
  dayOfYear: number;
  season: Season;
  weather: WeatherState;
  /** Degrees north; drives sun path. The heartland is ~25. */
  latitude: number;
  /** 0..1 (0 = new moon). */
  moonPhase: number;
}

// =====================================================================================================
// Terrain
// =====================================================================================================

export const BIOMES = [
  'river',
  'floodplain',
  'farmland',
  'grassland',
  'scrub',
  'dry_plain',
  'forest',
  'dense_forest',
  'hills',
  'rocky',
  'plateau',
  'sandbank',
  'marsh',
] as const;
export type Biome = (typeof BIOMES)[number];

/** Movement/combat classification used by tactical + strategic sim. */
export const TERRAIN_CLASSES = [
  'open',
  'road',
  'farmland',
  'forest',
  'hills',
  'rough',
  'marsh',
  'shallow_water',
  'deep_water',
  'urban',
] as const;
export type TerrainClass = (typeof TERRAIN_CLASSES)[number];

/** GDD §2 regional gameplay zones. The MVP region blends several of them. */
export const REGION_ZONES = [
  'northern_plains',
  'western_frontier',
  'deccan_plateau',
  'southern_peninsula',
  'eastern_forests',
] as const;
export type RegionZone = (typeof REGION_ZONES)[number];

/** How a terrain window is chosen/shaped. 'region' = the whole strategic map. */
export const TERRAIN_PRESETS = [
  'region',
  'plains',
  'river_crossing',
  'hills',
  'forest_edge',
  'plateau_fort',
  'capital',
] as const;
export type TerrainPreset = (typeof TERRAIN_PRESETS)[number];

export interface RiverSpec {
  enabled: boolean;
  /** Channel width in meters (bank to bank). */
  widthMeters: number;
  /** Max depth below water level. */
  depthMeters: number;
  /** 0..1 meander amplitude. */
  meander: number;
  /** Adds a northern tributary joining the main river. */
  tributary: boolean;
  /** Radians; main flow direction (0 = west->east). */
  angle: number;
}

/** Flattened building pad (settlements, forts). Applied deterministically at generation. */
export interface FlattenPad {
  x: number;
  z: number;
  /** Fully flat inside this radius. */
  radius: number;
  /** Blend distance outside radius. */
  falloff: number;
  /** Absolute target height. `null` = use the terrain height at the pad center. */
  height: number | null;
}

/**
 * Deterministic description of a terrain. The same spec + seed always yields the same heightfield
 * (see `src/core/terrain/heightfield.ts`). Local windows (battle/hero maps) reuse the region seed and
 * set `centerX/centerZ` to a world position so strategic and battle terrain match (GDD §5).
 */
export interface TerrainSpec {
  seed: number;
  preset: TerrainPreset;
  /** Square extent in meters. */
  sizeMeters: number;
  /** Samples per side (2^n + 1 recommended). */
  resolution: number;
  /** World coordinates of the window center (0,0 for the region). */
  centerX: number;
  centerZ: number;
  /** Max relief of hills/plateau in meters. */
  reliefMeters: number;
  /** Absolute water surface height (meters). Anything below is water. */
  waterLevel: number;
  river: RiverSpec;
  pads: FlattenPad[];
  /** 0..1 strength of extra high-frequency detail (battle/hero maps use ~1). */
  detail: number;
}

/** Read-only terrain queries shared by sim and render. Implemented by `Heightfield`. */
export interface TerrainQuery {
  readonly spec: TerrainSpec;
  readonly bounds: Rect;
  heightAt(x: number, z: number): number;
  /** Writes the unit surface normal into `out` and returns it. */
  normalAt(x: number, z: number, out: Vec3): Vec3;
  /** Gradient magnitude (rise / run). 0 = flat, 1 = 45 degrees. */
  slopeAt(x: number, z: number): number;
  biomeAt(x: number, z: number): Biome;
  terrainClassAt(x: number, z: number): TerrainClass;
  /** 0..1 */
  moistureAt(x: number, z: number): number;
  /** 0..1 agricultural fertility. */
  fertilityAt(x: number, z: number): number;
  isWater(x: number, z: number): boolean;
  /** Meters of water above ground (0 on land). */
  waterDepthAt(x: number, z: number): number;
  /** Meters from the nearest river centerline (Infinity if no river). */
  riverDistanceAt(x: number, z: number): number;
  inBounds(x: number, z: number): boolean;
}

// =====================================================================================================
// Factions  (GDD §4)
// =====================================================================================================

export const FACTION_ARCHETYPES = [
  'imperial_heartland',
  'highland_confederacy',
  'maritime_league',
  'forest_kingdoms',
  'frontier_principalities',
  'fortified_city_states',
] as const;
export type FactionArchetype = (typeof FACTION_ARCHETYPES)[number];

/** Multipliers; 1 = neutral. Read by economy, armies, combat and politics. */
export interface FactionModifiers {
  recruitmentPool: number;
  /** Administrative cost of governing settlements (higher = costlier). */
  governanceCost: number;
  taxEfficiency: number;
  tradeIncome: number;
  fortDefense: number;
  siegeStrength: number;
  constructionSpeed: number;
  marchSpeed: number;
  forestMovement: number;
  hillMovement: number;
  scoutRange: number;
  supplyEfficiency: number;
  /** Morale/fatigue penalty multiplier in long engagements (>1 = worse). */
  prolongedEngagement: number;
  diplomacyOpinion: number;
  espionage: number;
}

export const BANNER_PATTERNS = ['solid', 'chevron', 'sun', 'lotus', 'wheel', 'elephant', 'mountain', 'wave', 'tree', 'tower'] as const;
export type BannerPattern = (typeof BANNER_PATTERNS)[number];

export const AI_PERSONALITIES = ['expansionist', 'defensive', 'mercantile', 'opportunist', 'diplomatic', 'raider'] as const;
export type AiPersonality = (typeof AI_PERSONALITIES)[number];

/**
 * Reserved faction id of rebel armies (DESIGN_SPEC §7.9, §14.3 item 2). Legal as `ArmyState.factionId` (with
 * `ArmyState.rebelSettlementId` naming the revolting settlement); NEVER a key of `WorldState.factions` and not
 * in data/factions. Rebels are hostile only to the owner of their settlement; the UI shows "Rebels of {name}".
 */
export const REBEL_FACTION_ID = 'rebels' as const;
export type RebelFactionId = typeof REBEL_FACTION_ID;

/** True for the reserved rebel faction id (use instead of comparing strings). */
export function isRebelFaction(id: FactionId | null | undefined): id is RebelFactionId {
  return id === REBEL_FACTION_ID;
}

export interface FactionColors {
  primary: HexColor;
  secondary: HexColor;
  accent: HexColor;
}

export interface FactionDef extends Sourced {
  id: FactionId;
  archetype: FactionArchetype;
  name: string;
  shortName: string;
  /** Adjective, e.g. "Suvarnan". */
  adjective: string;
  description: string;
  strengths: string[];
  weaknesses: string[];
  colors: FactionColors;
  banner: BannerPattern;
  /** MVP: exactly two factions are playable. */
  playable: boolean;
  modifiers: FactionModifiers;
  /** Unit classes this faction can recruit. */
  roster: UnitClass[];
  aiPersonality: AiPersonality;
  /** Preferred architecture palette key (Art Director, see render/style). */
  architectureStyle: 'heartland_brick' | 'highland_stone' | 'coastal_timber' | 'forest_timber' | 'frontier_mud' | 'city_sandstone';
  // --- Optional content extensions (Creative Director, additive; see docs/DESIGN_SPEC.md) ---
  /** Named heraldry for banners/UI (blazon text for the Art Director). */
  heraldry?: HeraldryDef;
  /** One-line motto shown on faction select. */
  motto?: string;
  /** Age the faction starts in for skirmish/sandbox (scenarios may override). Default 'janapada'. */
  startingAge?: AgeId;
  /** Short gameplay pitch for the faction-select card (2-3 bullets max). */
  playstyle?: string[];
  /** Faction flavor of a unit class (AoE-style civ bonus): stat multipliers applied at formation creation. */
  unitVariants?: Partial<Record<UnitClass, FactionUnitVariant>>;
}

/** Faction-specific variant of a unit class (name + multiplicative stat changes; 1 = unchanged). */
export interface FactionUnitVariant {
  name: string;
  description: string;
  multipliers: Partial<Record<NumericKeys<UnitStats>, number>>;
}

/** Banner/heraldry description (DESIGN_SPEC §4.6). Colors come from `FactionDef.colors`. */
export interface HeraldryDef {
  /** e.g. "The Risen Sun of Suvarna". */
  name: string;
  /** Plain-language blazon for the Art Director, e.g. "saffron field, golden twelve-rayed sun". */
  blazon: string;
}

// =====================================================================================================
// Military units  (GDD §4 table)
// =====================================================================================================

export const UNIT_CLASSES = [
  'spearmen',
  'archers',
  'elite_guards',
  'cavalry',
  'chariots',
  'war_elephants',
  'engineers',
  'scouts',
  'supply_train',
] as const;
export type UnitClass = (typeof UNIT_CLASSES)[number];
/** Numeric id used in SoA buffers / shaders: index into UNIT_CLASSES. */
export const UNIT_CLASS_INDEX: Readonly<Record<UnitClass, number>> = Object.freeze(
  Object.fromEntries(UNIT_CLASSES.map((c, i) => [c, i])) as Record<UnitClass, number>,
);

export type UnitCategory = 'infantry' | 'ranged' | 'mounted' | 'beast' | 'support';

/** Multipliers applied when a formation stands on a terrain class. */
export interface TerrainEffect {
  speed: number;
  attack: number;
  defense: number;
  fatigue: number;
}

export interface UnitStats {
  /** Default soldiers (models) per formation. Elephants/chariots: 1 model = 1 beast/vehicle with crew. */
  menPerFormation: number;
  /** Hit points per soldier/model (elephants >> infantry). */
  hp: number;
  meleeAttack: number;
  meleeDefense: number;
  /** Extra attack on the first contact of a charge. */
  chargeBonus: number;
  /** 0 if not ranged. Damage per hit. */
  rangedAttack: number;
  /** Max shooting range in meters (0 if not ranged). */
  range: number;
  /** Volleys of ammunition carried (GDD: archers require ammunition). */
  ammo: number;
  /** Seconds between volleys. */
  reloadSec: number;
  /** 0..1 base hit chance at mid-range. */
  accuracy: number;
  /** Flat damage reduction per hit. */
  armor: number;
  /** m/s */
  walkSpeed: number;
  runSpeed: number;
  /** Radians per second the formation can wheel. */
  turnRate: number;
  /** Relative mass for charge shock / collision push. Infantry = 1. */
  mass: number;
  /** Starting morale 0..100. */
  baseMorale: number;
  /** 0..1 resistance to morale shocks & cohesion loss. */
  discipline: number;
  /** Fatigue gained per second of running/fighting (0..1 scale). */
  fatigueRate: number;
  /** Meters. */
  visionRange: number;
  /** Meters between files (lateral) and ranks (depth) in close order. */
  spacingX: number;
  spacingZ: number;
  /** Collision radius of one model in meters. */
  radius: number;
  /** Food units per soldier per day. */
  upkeepFood: number;
  /** Wealth per soldier per month. */
  upkeepWealth: number;
  recruitCost: { wealth: number; food: number; population: number };
  /** Days to raise one formation. */
  recruitDays: number;
  /** Siege damage per second (engineers, elephants). */
  siege: number;
  /** Food units carried (supply train). */
  supplyCapacity: number;
  /** 0..1 chance to stay unseen at range (scouts). */
  stealth: number;
  /** 0..1 chance per shock event to panic and hurt own side (war elephants). */
  unruliness: number;
}

export type SilhouetteKind =
  | 'spear_infantry'
  | 'archer'
  | 'guard'
  | 'horse_rider'
  | 'chariot'
  | 'elephant'
  | 'engineer'
  | 'scout'
  | 'cart';

export interface UnitVisualDef {
  silhouette: SilhouetteKind;
  mount: 'none' | 'horse' | 'chariot' | 'elephant' | 'ox_cart';
  weapon: 'spear' | 'bow' | 'sword' | 'mace' | 'tools' | 'javelin' | 'none';
  shield: 'none' | 'round' | 'tall' | 'small';
  armor: 'none' | 'quilted' | 'scale' | 'lamellar';
  headgear: 'none' | 'turban' | 'helmet' | 'crested';
  /** Uniform scale relative to a 1.7 m human. */
  scale: number;
  /** Standard bearer + drummer per formation. */
  hasStandard: boolean;
}

export const FORMATION_SHAPES = ['line', 'column', 'square', 'wedge', 'loose', 'circle'] as const;
export type FormationShape = (typeof FORMATION_SHAPES)[number];

export interface UnitDef extends Sourced {
  id: UnitClass;
  name: string;
  /** Optional period-appropriate local term (only if `historicity` supports it). */
  localName?: string;
  role: string;
  constraint: string;
  description: string;
  category: UnitCategory;
  stats: UnitStats;
  terrain: Record<TerrainClass, TerrainEffect>;
  /** Attack multipliers against specific classes (e.g. spearmen vs cavalry 1.5). */
  bonusVs: Partial<Record<UnitClass, number>>;
  defaultShape: FormationShape;
  allowedShapes: FormationShape[];
  visual: UnitVisualDef;
  // --- Optional content extensions (Creative Director, additive; see docs/DESIGN_SPEC.md) ---
  /** Age in which the class becomes recruitable (default 'janapada'). */
  age?: AgeId;
  /** Age from which the class can no longer be recruited (period-dependent units, e.g. chariots). */
  retiredInAge?: AgeId;
  /** Command-card grid slot 0..14 (row-major 5x3: Q W E R T / A S D F G / Z X C V B). */
  commandSlot?: number;
  /** <= 4 letter label for formation markers / compact UI (e.g. "SPR"). */
  shortName?: string;
  /** Readable counter summary for tooltips (derived from bonusVs; kept in data for wording). */
  counters?: { strongVs: UnitClass[]; weakVs: UnitClass[] };
}

// =====================================================================================================
// Formations & orders  (GDD §5)
// =====================================================================================================

export const STANCES = ['aggressive', 'defensive', 'skirmish', 'hold_fire'] as const;
export type Stance = (typeof STANCES)[number];

export const ENGINEER_WORKS = ['palisade', 'ditch', 'bridge', 'ram', 'ladder', 'repair_gate'] as const;
export type EngineerWork = (typeof ENGINEER_WORKS)[number];

/** Concrete formation orders (GDD §5: advance, hold, flank, withdraw, regroup, defend + extras). */
export type FormationOrder =
  | { type: 'hold' }
  | { type: 'advance'; /** meters along current facing */ distance: number }
  | { type: 'move_to'; x: number; z: number; facing: number | null; run: boolean }
  | { type: 'attack_target'; target: FormationIndex; run: boolean }
  | { type: 'charge'; target: FormationIndex }
  | { type: 'flank'; target: FormationIndex; side: 'left' | 'right' }
  | { type: 'withdraw'; /** null = toward own deploy zone */ x: number | null; z: number | null }
  | { type: 'regroup' }
  | { type: 'defend'; x: number; z: number; radius: number }
  | { type: 'skirmish'; target: FormationIndex }
  | { type: 'construct'; work: EngineerWork; x: number; z: number; facing: number }
  | { type: 'resupply'; target: FormationIndex };
export type FormationOrderType = FormationOrder['type'];

/** Intent orders: the player states an objective; battle AI translates it to FormationOrders. */
export type IntentOrder =
  | { type: 'hold_crossing'; x: number; z: number; radius: number }
  | { type: 'protect_formation'; target: FormationIndex }
  | { type: 'hold_high_ground'; x: number; z: number; radius: number }
  | { type: 'pin_enemy'; target: FormationIndex }
  | { type: 'screen_flank'; protect: FormationIndex; side: 'left' | 'right' }
  | { type: 'pursue_routers' }
  | { type: 'scout_area'; x: number; z: number; radius: number }
  | { type: 'escort_supply'; target: FormationIndex };
export type IntentOrderType = IntentOrder['type'];

export const FORMATION_ACTIVITIES = [
  'idle',
  'moving',
  'engaged',
  'shooting',
  'charging',
  'withdrawing',
  'regrouping',
  'routing',
  'rallying',
  'constructing',
  'destroyed',
  'surrendered',
] as const;
export type FormationActivity = (typeof FORMATION_ACTIVITIES)[number];

// =====================================================================================================
// Morale  (GDD §5: Morale = f(leadership, cohesion, fatigue, supply, tactical position, recent events,
//          perceived risk). Tunable gameplay model, NOT a historical predictive equation.)
// =====================================================================================================

/** Normalized morale inputs. Ranges documented per field. */
export interface MoraleInputs {
  /** 0..1 commander/officers alive and near, character martial skill. */
  leadership: number;
  /** 0..1 formation integrity (ranks kept, not disordered). */
  cohesion: number;
  /** 0..1 (higher = more tired = worse). */
  fatigue: number;
  /** 0..1 food/ammo/supply-line security. */
  supply: number;
  /** -1..1 high ground, protected flanks, fortifications (+) vs flanked, surrounded, in water (-). */
  tacticalPosition: number;
  /** -1..1 decaying sum of recent shocks/boosts (commander fell, ally routed, enemy routed...). */
  recentEvents: number;
  /** 0..1 local enemy strength vs friends nearby, incoming charges, elephants (higher = worse). */
  perceivedRisk: number;
}

export const MORALE_EVENT_KINDS = [
  'commander_fallen',
  'flank_attacked',
  'rear_attacked',
  'ally_routed',
  'enemy_routed',
  'charged',
  'heavy_casualties',
  'volley_hit',
  'elephant_panic',
  'supply_threatened',
  'reinforced',
  'general_nearby',
  'victory_near',
  'rallied',
] as const;
export type MoraleEventKind = (typeof MORALE_EVENT_KINDS)[number];

export interface MoraleEvent {
  kind: MoraleEventKind;
  /** Battle time (s) the event happened. */
  time: number;
  /** Signed contribution to `recentEvents` at t = time (-1..1). */
  magnitude: number;
  /** Seconds for the contribution to decay to ~0. */
  decaySec: number;
}

/** Explains a formation's morale for the UI tooltip ("why are they running?"). */
export interface MoraleBreakdown {
  inputs: MoraleInputs;
  /** Weighted contribution of each input (same keys), in morale points. */
  contributions: Record<keyof MoraleInputs, number>;
  base: number;
  /** Target morale 0..100 the formation drifts toward. */
  target: number;
  /** Morale points per second currently applied. */
  trend: number;
  dominant: keyof MoraleInputs;
}

// =====================================================================================================
// Battles  (tactical level)
// =====================================================================================================

export const BATTLE_KINDS = ['field', 'river_crossing', 'siege', 'ambush', 'skirmish'] as const;
export type BattleKind = (typeof BATTLE_KINDS)[number];

export interface FortificationSpec {
  kind: 'palisade' | 'mud_brick_wall' | 'stone_wall';
  center: Vec2;
  /** Wall ring radius in meters. */
  radius: number;
  gates: number;
  towers: number;
  /** Hit points per wall segment. */
  wallHp: number;
  ditch: boolean;
  defenderSide: SideIndex;
}

export interface FormationSetup {
  unitClass: UnitClass;
  soldiers: number;
  /** 0..1 */
  experience: number;
  /** 0..100 */
  morale: number;
  /** 0..1 */
  fatigue: number;
  /** 0..1 */
  supply: number;
  name: string | null;
  /** Deployment position; null = auto-deploy inside the side's deploy zone. */
  x: number | null;
  z: number | null;
  facing: number | null;
  shape: FormationShape | null;
  /** The side's commander rides with this formation (usually elite guards). */
  hasCommander: boolean;
  /** Back-link to the strategic army unit this formation came from. */
  armyUnitId: ArmyUnitId | null;
}

export type BattleController = 'player' | 'ai';

export interface BattleSideSetup {
  factionId: FactionId;
  armyIds: ArmyId[];
  commanderId: CharacterId | null;
  commanderName: string;
  /** 0..20 martial skill of the commander (feeds leadership). */
  commanderSkill: number;
  controller: BattleController;
  aiPersonality: AiPersonality;
  difficulty: Difficulty;
  formations: FormationSetup[];
  deployZone: Rect;
  /** 0..1 army supply state entering battle. */
  supply: number;
  /**
   * 0..1 battle-AI aggression override (chance to attack vs hold). null = the personality's
   * `AI_PERSONALITY_DEFS[...].battle.aggression`. Autoresolve maps the strategic army stance to 0.75 / 0.5 / 0.3
   * (DESIGN_SPEC §6.14). @sprint1 SIM-01 (sets it) / SIM-02 (reads it).
   */
  aggression: number | null;
}

export type BattleObjective =
  | { id: ObjectiveId; kind: 'hold_area'; side: SideIndex; x: number; z: number; radius: number; durationSec: number; label: string }
  | { id: ObjectiveId; kind: 'destroy_army'; side: SideIndex; label: string }
  | { id: ObjectiveId; kind: 'protect_formation'; side: SideIndex; formation: FormationIndex; label: string }
  | { id: ObjectiveId; kind: 'survive'; side: SideIndex; durationSec: number; label: string }
  | { id: ObjectiveId; kind: 'breach_gate'; side: SideIndex; label: string };

export type BattleOrigin =
  | { kind: 'skirmish' }
  | { kind: 'world'; engagementId: EngagementId; settlementId: SettlementId | null };

export interface BattleSetup {
  id: BattleId;
  /** Seeds the battle RNG (authoritative) - same setup + same commands => same outcome. */
  seed: number;
  kind: BattleKind;
  terrain: TerrainSpec;
  fortification: FortificationSpec | null;
  environment: EnvironmentState;
  sides: [BattleSideSetup, BattleSideSetup];
  attackerSide: SideIndex;
  /** Seconds of battle time; null = unlimited. */
  timeLimitSec: number | null;
  objectives: BattleObjective[];
  /** Seconds of deployment phase before fighting (0 = start immediately). */
  deploymentSec: number;
  origin: BattleOrigin;
}

/** Authoritative formation-level state. Plain data (serializable). */
export interface FormationState {
  index: FormationIndex;
  side: SideIndex;
  unitClass: UnitClass;
  name: string;
  armyUnitId: ArmyUnitId | null;
  // --- strength (authoritative casualty counts) ---
  soldiers: number;
  maxSoldiers: number;
  /** Fractional damage accumulator (casualties realized when it crosses 1 soldier's hp). */
  damagePool: number;
  killed: number;
  captured: number;
  kills: number;
  // --- placement ---
  x: number;
  z: number;
  facing: number;
  vx: number;
  vz: number;
  shape: FormationShape;
  /** Number of files (soldiers per rank) for the current shape/strength. */
  files: number;
  ranks: number;
  /** Frontage and depth in meters. */
  width: number;
  depth: number;
  // --- orders ---
  order: FormationOrder;
  /** Queued orders (shift-click). */
  queue: FormationOrder[];
  intent: IntentOrder | null;
  stance: Stance;
  activity: FormationActivity;
  /** Formation indices currently in melee contact. */
  engagedWith: FormationIndex[];
  /** Current ranged/melee target or -1. */
  target: FormationIndex;
  // --- condition ---
  /** 0..100 */
  morale: number;
  /** 0..1 */
  cohesion: number;
  /** 0..1 */
  fatigue: number;
  /** 0..1 */
  supply: number;
  /** 0..1 */
  experience: number;
  /** Remaining volleys. */
  ammo: number;
  /** Seconds until next volley may fire. */
  reload: number;
  hasCommander: boolean;
  commanderAlive: boolean;
  /** 0..1 computed each tick. */
  leadership: number;
  moraleEvents: MoraleEvent[];
  moraleBreakdown: MoraleBreakdown | null;
  /** Battle time of last melee/ranged damage taken. */
  lastHitTime: number;
  /** Visible to the other side (scouting / fog). */
  spotted: boolean;
  /**
   * Engineers: construction progress 0..1 of the current work. Supply trains: progress 0..1 toward the next
   * resupply tick (+25% ammo every 30 s, DESIGN_SPEC §6.3).
   */
  workProgress: number;
  // --- Contracts v2 (DESIGN_SPEC §6.2-§6.11; @sprint1 GP-01) ---
  /** Rallies used this battle (max RULES.battle.rout.maxRallies = 2; the third rout is final - "shattered"). */
  rallies: number;
  /** Battle time (s) when the current shape change completes (3 s + 0.02 s x soldiers); cohesion <= 0.6 until then. 0 = none. */
  shapeChangeUntil: number;
  /** Battle time (s) when an elephant panic ends (8 s run-away ignoring orders). 0 = not panicking. */
  panicUntil: number;
  /** Battle time (s) when the 15 s 'rallying' state ends and the formation is controllable again. 0 = none. */
  rallyingUntil: number;
  /** Battle time (s) until which enemies in contact deal x1.5 damage after disengaging (withdraw). 0 = none. */
  disengageUntil: number;
  /** Meters run toward the charge target at >= 60% run speed (impact needs >= RULES.battle.charge.minRunMeters). */
  chargeRun: number;
  /** Battle time (s) the current order started (flank 30 s timeout, withdraw phases, regroup bonus). */
  orderTime: number;
  /** Concealed (ambush / forest): unknown to the enemy until within 60 m or scouted (§6.10). */
  hidden: boolean;
}

export type ProjectileKind = 'arrow' | 'fire_arrow' | 'javelin' | 'stone';

/** A volley in flight. Authoritative damage is applied at impact time. Render spawns instanced arrows. */
export interface Volley {
  id: number;
  kind: ProjectileKind;
  shooter: FormationIndex;
  target: FormationIndex;
  /** Number of projectiles in the volley (for visuals and damage). */
  count: number;
  launchTime: number;
  impactTime: number;
  fromX: number;
  fromZ: number;
  toX: number;
  toZ: number;
  /** Apex height above launch point (m) for the parabolic arc. */
  arcHeight: number;
  resolved: boolean;
}

export const BATTLE_EVENT_KINDS = [
  'battle_started',
  'deployment_ended',
  'contact',
  'charge',
  'volley',
  'formation_routed',
  'formation_rallied',
  'formation_destroyed',
  'formation_surrendered',
  'commander_fallen',
  'flank_collapsed',
  'elephant_rampage',
  'ammo_depleted',
  'objective_progress',
  'objective_complete',
  'gate_breached',
  'side_withdrew',
  'battle_ended',
] as const;
export type BattleEventKind = (typeof BATTLE_EVENT_KINDS)[number];

export interface BattleEventRecord {
  time: number;
  kind: BattleEventKind;
  side: SideIndex | null;
  formation: FormationIndex | null;
  other: FormationIndex | null;
  x: number | null;
  z: number | null;
  value: number | null;
  text: string | null;
}

export interface BattleSideState {
  factionId: FactionId;
  controller: BattleController;
  initialSoldiers: number;
  soldiers: number;
  killed: number;
  captured: number;
  routedFormations: number;
  destroyedFormations: number;
  /** -1 if none. */
  commanderFormation: FormationIndex;
  commanderAlive: boolean;
  /** Mean morale of non-routed formations. */
  averageMorale: number;
  withdrawn: boolean;
  surrendered: boolean;
  /** Control groups 0..9 -> formation indices (player side). */
  groups: FormationIndex[][];
  /** Battle time (s) when the commander's Rally is available again (cooldown 90 s, DESIGN_SPEC §6.11). 0 = ready. @sprint1 GP-01 */
  rallyCooldownUntil: number;
  /**
   * Persistent battle-AI scratch memory for this side (plan id, reserve committed, next re-plan time...), so a
   * battle resumed from a save thinks exactly like the uninterrupted one. Plain values only. @sprint1 SIM-02
   */
  aiMemory: Record<string, number | string | boolean>;
}

/** 'active' = the fighting phase (the spec's "battle"); kept from v1 (no renames). */
export type BattlePhase = 'deployment' | 'active' | 'ended';

/** An engineer work on the battlefield (palisade, ditch, bridge, ram, ladder, gate repair; DESIGN_SPEC §6.6.5). */
export interface EngineerWorkState {
  work: EngineerWork;
  x: number;
  z: number;
  facing: number;
  side: SideIndex;
  hp: number;
  maxHp: number;
  /** 0..1 construction progress; usable at 1. */
  progress: number;
  /** Builder formation (-1 = none / pre-v2). */
  formation: FormationIndex;
}

/** One wall segment of the siege ring (RULES.battle.walls.segments = 12, segment i spans angles [i, i+1] x 30 deg). */
export interface WallSegmentState {
  hp: number;
  maxHp: number;
  /** Assault ladders are up against this segment (escalade). */
  ladder: boolean;
}

export interface SiegeGateState {
  /** Wall segment index the gate sits in. */
  segment: number;
  hp: number;
  maxHp: number;
}

export interface SiegeTowerState {
  segment: number;
  hp: number;
  maxHp: number;
  /** Formation shooting from the tower (+20% range/accuracy) or -1. */
  garrison: FormationIndex;
}

/**
 * Siege battle state (DESIGN_SPEC §6.6.5). Geometry derives from `BattleSetup.fortification` (center, radius):
 * segment i covers facing angles [i, i + 1] x (2 PI / segments). A segment or gate at 0 HP is breached.
 * @sprint1 GP-01 (simulation), GFX-06 (walls / damage rendering), GP-04 (presentation).
 */
export interface BattleSiegeState {
  /** World settlement under siege (null for skirmish / scripted sieges). */
  settlementId: SettlementId | null;
  segments: WallSegmentState[];
  gates: SiegeGateState[];
  towers: SiegeTowerState[];
  /** Breached segment indices (walls and gates), in the order they fell. */
  breaches: number[];
  /** Attacker formation holding the inside of a breach and since when (victory after holdBreachSec = 60 s). */
  breachHold: { formation: FormationIndex; since: number } | null;
}

export interface BattleObjectiveState {
  id: ObjectiveId;
  /** 0..1 */
  progress: number;
  status: 'pending' | 'complete' | 'failed';
}

export interface BattleState {
  id: BattleId;
  setup: BattleSetup;
  phase: BattlePhase;
  /** Battle time in seconds. */
  time: number;
  /** Fixed sim steps executed. */
  tick: number;
  /** Authoritative RNG state (see core/rng.ts). */
  rng: RngState;
  formations: FormationState[];
  sides: [BattleSideState, BattleSideState];
  volleys: Volley[];
  nextVolleyId: number;
  objectives: BattleObjectiveState[];
  /** Bounded log (last ~500) for UI feed + morale reasoning. */
  events: BattleEventRecord[];
  /** Every applied command, for replay (GDD §10 battle replay). */
  commandLog: TimedBattleCommand[];
  /** Engineer works on the field (built or in progress). */
  works: EngineerWorkState[];
  /** @deprecated v1 field, always []. Siege walls live in `siege.segments` (v2). */
  wallHp: number[];
  outcome: BattleOutcome | null;
  // --- Contracts v2 (@sprint1 GP-01) ---
  /** Battle time (s) the deployment phase ends (setup.deploymentSec; `begin_battle` moves it to now). */
  deploymentEndsAt: number;
  /** Siege walls, gates, towers and breaches; null when the battle is not a siege. */
  siege: BattleSiegeState | null;
}

export type BattleCommand =
  | { kind: 'order'; formations: FormationIndex[]; order: FormationOrder; queue: boolean }
  | { kind: 'intent'; formations: FormationIndex[]; intent: IntentOrder }
  | { kind: 'clear_intent'; formations: FormationIndex[] }
  | { kind: 'set_stance'; formations: FormationIndex[]; stance: Stance }
  | { kind: 'set_shape'; formations: FormationIndex[]; shape: FormationShape }
  | { kind: 'set_group'; group: number; formations: FormationIndex[] }
  | { kind: 'deploy'; formation: FormationIndex; x: number; z: number; facing: number }
  | { kind: 'begin_battle' }
  | { kind: 'withdraw_all' }
  | { kind: 'surrender' }
  /**
   * Commander's Rally (DESIGN_SPEC §6.11): commander formation not engaged; own formations within 120 m gain
   * +15 morale and a 'rallied' event, routers there with morale > 35 start rallying; cooldown 90 s
   * (`BattleSideState.rallyCooldownUntil`). @sprint1 GP-01
   */
  | { kind: 'rally' };

export interface TimedBattleCommand {
  tick: number;
  side: SideIndex;
  cmd: BattleCommand;
}

export type BattleEndReason =
  | 'rout'
  | 'annihilation'
  | 'withdrawal'
  | 'surrender'
  | 'time_limit'
  | 'objective'
  | 'siege_breach'
  | 'siege_held';

export interface FormationResult {
  index: FormationIndex;
  armyUnitId: ArmyUnitId | null;
  unitClass: UnitClass;
  startSoldiers: number;
  survivors: number;
  killed: number;
  captured: number;
  morale: number;
  fatigue: number;
  experienceGained: number;
  routed: boolean;
  /** Enemy formations this formation routed (+0.05 experience each, DESIGN_SPEC §6.11). @sprint1 GP-01 */
  routedEnemies: number;
}

export interface BattleSideResult {
  factionId: FactionId;
  startSoldiers: number;
  survivors: number;
  killed: number;
  captured: number;
  /** Extra losses suffered while fleeing (pursuit). */
  pursuitLosses: number;
  commanderFate: 'safe' | 'wounded' | 'killed' | 'captured' | 'none';
  formations: FormationResult[];
  // --- Contracts v2 (DESIGN_SPEC §6.8, §6.12; @sprint1 GP-01 fills, SIM-01 writes back) ---
  /** Enemy soldiers this side took prisoner (ransom / release decision on the results screen). */
  prisoners: number;
  /** Own formations that routed at least once. */
  routs: number;
  /** Grain captured from destroyed / surrendered enemy supply trains (50% of what they carried). */
  capturedSupply: number;
  /** Character the `commanderFate` refers to (null = unnamed captain / skirmish). */
  commanderId: CharacterId | null;
}

export interface BattleOutcome {
  battleId: BattleId;
  /** null = draw / inconclusive. */
  winner: SideIndex | null;
  reason: BattleEndReason;
  durationSec: number;
  sides: [BattleSideResult, BattleSideResult];
  /** Short generated narrative lines for the results screen / chronicle. */
  summary: string[];
  /** True if resolved without the soldier-level layer (autoresolve / distant battle). */
  autoresolved: boolean;
  // --- Contracts v2 (DESIGN_SPEC §6.12; @sprint1 GP-01 / SIM-01) ---
  /** War score change from side 0's perspective (-20..20): 20 x (side-1 losses - side-0 losses) / both starts. */
  warScore: number;
  /** Chronicle line, e.g. "The Battle of the Salt Ford: Suvarna defeated Giridurga; 412 fell." */
  chronicle: string;
  /** `{place}` of the chronicle line: nearest REGION_FEATURES name within 600 m, else the nearest settlement. */
  placeName: string | null;
  /** World day the battle was fought (stamped by the strategic write-back; null = skirmish / pre-v2 history). */
  day: number | null;
}

/** Pre-battle estimate shown in the engagement prompt (sim/strategic/autoresolve.ts). */
export interface BattlePrediction {
  /** 0..1 chance side 0 (attacker) wins. */
  attackerWinChance: number;
  /** Expected casualties per side. */
  expectedLosses: [number, number];
  /** Short advisor-style explanation lines. */
  factors: string[];
}

// =====================================================================================================
// Soldier SoA buffers (local level; derived, NOT saved). Layout shared by sim/tactical/soldiers.ts
// (writer) and render/units (reader). Index i in every array refers to the same soldier.
// =====================================================================================================

export const SOLDIER_ANIM = {
  idle: 0,
  walk: 1,
  run: 2,
  attack: 3,
  shoot: 4,
  hit: 5,
  die: 6,
  dead: 7,
  rout: 8,
  cheer: 9,
  brace: 10,
  work: 11,
  /** v2: archers nocking between volleys (VAT clip 'reload'). */
  reload: 12,
  /** v2: charge run-in (VAT clip 'charge'; mounted: gallop). */
  charge: 13,
} as const;
export type SoldierAnim = (typeof SOLDIER_ANIM)[keyof typeof SOLDIER_ANIM];

/** Number of `SoldierBuffers.animVariant` values per anim (attack: thrust / slash / shield bash; die: 2). */
export const SOLDIER_ANIM_VARIANTS: Readonly<Partial<Record<keyof typeof SOLDIER_ANIM, number>>> = { attack: 3, die: 2, dead: 2 };

/** Role bits in `SoldierBuffers.flags` (written by the soldier layer, read by crowds/banners/audio). */
export const SOLDIER_FLAG = {
  commander: 1,
  standardBearer: 2,
  drummer: 4,
  officer: 8,
  /** v2: rider / crew of a mounted or beast unit (cavalry, chariot, elephant, cart): combined VAT. */
  mounted: 16,
  /** v2: conch blower (signals, ASSET_LIST WP5-10). */
  conch: 32,
} as const;

/** LOD tiers by camera distance (see QualitySettings.soldierLod). */
export const SOLDIER_LOD = { near: 0, mid: 1, far: 2, culled: 3 } as const;

export interface SoldierBuffers {
  readonly capacity: number;
  /** Active soldiers are [0, count). Dead soldiers stay (corpses) until recycled. */
  count: number;
  /** Current sim positions (m). posY = terrain height. */
  posX: Float32Array;
  posY: Float32Array;
  posZ: Float32Array;
  /** Positions at the previous fixed step - render interpolates prev -> pos with loop alpha. */
  prevX: Float32Array;
  prevY: Float32Array;
  prevZ: Float32Array;
  facing: Float32Array;
  prevFacing: Float32Array;
  velX: Float32Array;
  velZ: Float32Array;
  /** SOLDIER_ANIM value. */
  anim: Uint8Array;
  /** Seconds since the current anim started. */
  animTime: Float32Array;
  /** Playback rate multiplier (walk speed sync). */
  animSpeed: Float32Array;
  formation: Uint16Array;
  /** Slot index within the formation grid. */
  slot: Uint16Array;
  side: Uint8Array;
  /** UNIT_CLASS_INDEX value. */
  unitClass: Uint8Array;
  /** 1 alive, 0 dead/corpse. */
  alive: Uint8Array;
  /** SOLDIER_LOD value (written by soldier sim from camera focus). */
  lod: Uint8Array;
  /** 0..255 random cosmetic variant (skin tone, cloth tint, height). */
  variant: Uint8Array;
  /** SOLDIER_FLAG bitmask. */
  flags: Uint8Array;
  /** Soldier index being fought / shot at, -1 none. */
  target: Int32Array;
  /** Battle time of death (for corpse fade). */
  deathTime: Float32Array;
  // --- Contracts v2 (@sprint1 GP-01 writes, GFX-04 reads) ---
  /** Clip variant of the current anim (0..SOLDIER_ANIM_VARIANTS[anim]-1, e.g. attack thrust/slash/bash). */
  animVariant: Uint8Array;
  /** Battle time (s) the current anim started - VAT phase = (now - animStart) x animSpeed, no per-frame writes. */
  animStart: Float32Array;
}

// =====================================================================================================
// Strategic world  (GDD §6, §7)
// =====================================================================================================

export const SETTLEMENT_KINDS = ['village', 'town', 'city', 'capital', 'fort', 'port', 'temple_town'] as const;
export type SettlementKind = (typeof SETTLEMENT_KINDS)[number];

export const REBELLION_STAGES = ['calm', 'grumbling', 'protest', 'tax_refusal', 'unrest', 'revolt', 'secession'] as const;
export type RebellionStage = (typeof REBELLION_STAGES)[number];

export const RESOURCE_KINDS = ['grain', 'rice', 'cotton', 'timber', 'iron', 'copper', 'salt', 'horses', 'elephants', 'spices', 'gems', 'stone'] as const;
export type ResourceKind = (typeof RESOURCE_KINDS)[number];

export const BUILDING_TYPES = [
  'farm_fields',
  'irrigation_canal',
  'granary',
  'stepwell',
  'water_tank',
  'market',
  'workshop',
  'barracks',
  'stables',
  'elephant_stables',
  'temple',
  'stupa',
  'fort_walls',
  'watchtower',
  'road_station',
  'harbor',
  'mine',
  'palace',
  'ghat',
  'housing',
  'sanitation',
] as const;
export type BuildingType = (typeof BUILDING_TYPES)[number];

/** Procedural architecture pieces the renderer can build (render/architecture). */
export const ARCHITECTURE_KINDS = [
  'mud_house',
  'thatch_hut',
  'brick_house',
  'mansion',
  'granary',
  'stupa',
  'shikhara_temple',
  'shrine',
  'palace',
  'chhatri',
  'pavilion',
  'fort_wall',
  'fort_gate',
  'tower',
  'ghat',
  'stepwell',
  'well',
  'market_stall',
  'barracks',
  'stable',
  'workshop',
  'pillar',
  'harbor_jetty',
  'bridge',
  'palisade',
  'field_plot',
] as const;
export type ArchitectureKind = (typeof ARCHITECTURE_KINDS)[number];

export interface SettlementModifiers {
  foodProduction?: number;
  foodCapacity?: number;
  waterAvailability?: number;
  irrigation?: number;
  housing?: number;
  sanitation?: number;
  publicOrder?: number;
  wealth?: number;
  tradeIncome?: number;
  taxEfficiency?: number;
  recruitmentPotential?: number;
  loyalty?: number;
  fortLevel?: number;
  disasterResistance?: number;
  culture?: number;
}

export interface BuildingDef extends Sourced {
  id: BuildingType;
  name: string;
  description: string;
  cost: { wealth: number; labor: number; stone?: number; timber?: number };
  buildDays: number;
  upkeepWealth: number;
  /** Additive modifiers applied per building level. */
  effects: SettlementModifiers;
  maxLevel: number;
  allowedIn: SettlementKind[];
  requires: BuildingType[];
  /** How it appears in settlements. */
  architecture: ArchitectureKind[];
  /** Unit classes unlocked for recruitment here. */
  unlocksUnits: UnitClass[];
  // --- Optional content extensions (Creative Director, additive; see docs/DESIGN_SPEC.md) ---
  /** Age in which the building becomes available (default 'janapada'). */
  age?: AgeId;
  /** Command-card tab. */
  category?: BuildingCategory;
  /** Placement footprint on the 4 m settlement build grid. */
  footprint?: BuildingFootprint;
  /** Command-card grid slot 0..14 within the category tab. */
  commandSlot?: number;
  /** Raw materials produced per day per level (timber/stone/wealth) when staffed (DESIGN_SPEC §7.5). */
  produces?: Partial<Record<'timber' | 'stone' | 'wealth', number>>;
  /** Visible villagers per level working here (presentation; DESIGN_SPEC §8.3). */
  workers?: number;
}

export type BuildingCategory = 'economy' | 'military' | 'civic' | 'defense';

/** Placement rule + footprint (meters, multiples of 4) for AoE-style building placement. */
export interface BuildingFootprint {
  w: number;
  d: number;
  /**
   * inner: inside the settlement pad; outer: ring just outside the pad (fields, mines); perimeter: wall ring;
   * shore: touching the river bank; road: on a road edge between settlements; resource: on a resource node.
   */
  placement: 'inner' | 'outer' | 'perimeter' | 'shore' | 'road' | 'resource';
}

/**
 * Settlement build-grid cell (DESIGN_SPEC §8.2): integer [i, j] on the settlement's 4 m grid
 * (RULES.construction.gridCell) with cell (0, 0) spanning world x in [s.x, s.x + 4), z in [s.z, s.z + 4); +i east,
 * +j south. A placed footprint's `cell` is its MINIMUM (north-west) cell; it covers w/4 x d/4 cells (swapped when
 * `rot` is odd). The grid covers radius r + 60 m around the centre.
 */
export type GridCell = [number, number];
/** Quarter turns about the footprint centre; facing theta = rot x PI/2 (0 = model front faces +Z / south). */
export type Rotation = 0 | 1 | 2 | 3;

export interface BuildingInstance {
  type: BuildingType;
  level: number;
  /** 0..1 */
  condition: number;
  /** v2 placement (SIM-01 placement / GP-03 ghost). Absent = laid out procedurally (starting buildings, v1 saves). */
  cell?: GridCell;
  rot?: Rotation;
}

/** Materials + wealth + labor actually charged for a job (refunds: paid x (1 - progress) x 0.9). */
export type PaidCost = MaterialCost;

export interface ConstructionJob {
  /**
   * Building built / upgraded. For landmark jobs (`landmarkId` set) this is only a presentation hint
   * ('palace'): never look a landmark job up in BUILDINGS without checking `landmarkId` first.
   */
  type: BuildingType;
  targetLevel: number;
  /** 0..1 */
  progress: number;
  startedDay: number;
  laborAssigned: number;
  // --- Contracts v2 (DESIGN_SPEC §7.6, §8.2, §8.4; @sprint1 SIM-01) ---
  /** Placement of the new building (absent for upgrades / repairs / procedural placement). */
  cell?: GridCell;
  rot?: Rotation;
  /** LandmarkDef.id when this job raises an age landmark (start_landmark). */
  landmarkId?: string;
  /** Repair job (scaffold stage, cost = repairCostFactor x level cost x (1 - condition)). */
  repair?: boolean;
  /** What was charged when the job was queued (v1 jobs: zero - v1 charged nothing). */
  paid: PaidCost;
  /** Nominal crew = labor cost / days; builders above 1.25 x crew add nothing. */
  crew: number;
}

export interface RecruitmentJob {
  unitClass: UnitClass;
  formations: number;
  /** 0..1 */
  progress: number;
  startedDay: number;
  /** Army that receives the units; null = garrison. */
  targetArmyId: ArmyId | null;
}

/** Kharif = monsoon-sown, autumn-harvested; Rabi = winter-sown, spring-harvested. */
export interface CropState {
  /** Hectare-equivalents sown. */
  sown: number;
  /** 0..1 growth toward harvest. */
  growth: number;
  /** 0..1 expected yield factor (weather, irrigation, labor). */
  health: number;
  /** Farmers (labor x farming share) at sowing; health is cut pro rata if farming labor drops below it (§7.3.1). */
  laborAtSowing: number;
}

/** A completed age landmark standing in a settlement (DESIGN_SPEC §8.4-§8.5). */
export interface LandmarkInstance {
  /** LandmarkDef.id */
  id: string;
  /** Faction that raised it (its effects apply only while this faction owns the settlement). */
  builtBy: FactionId;
  completedDay: number;
  /** 0..1 (siege / fire damage). */
  condition: number;
  cell?: GridCell;
  rot?: Rotation;
}

/** Where newly recruited formations go (DESIGN_SPEC §7.6 rally point output). */
export type RallyPoint = { kind: 'point'; x: number; z: number } | { kind: 'army'; armyId: ArmyId };

export type CaptureDecision = 'occupy' | 'plunder' | 'liberate';
export type PrisonerDecision = 'ransom' | 'release';

export interface LaborAllocation {
  farming: number;
  construction: number;
  crafts: number;
  military: number;
}

export interface DisasterExposure {
  flood: number;
  drought: number;
  fire: number;
  epidemic: number;
}

/** GDD §6 settlement variables - every one is represented here. */
export interface SettlementState {
  id: SettlementId;
  name: string;
  kind: SettlementKind;
  provinceId: ProvinceId;
  ownerFactionId: FactionId | null;
  x: number;
  z: number;
  /** Seed for procedural layout (render/architecture). */
  layoutSeed: number;
  /** Visual radius in meters. */
  radius: number;
  // Population and available labor
  population: number;
  labor: number;
  laborAllocation: LaborAllocation;
  /** Annualized growth rate (last computed). */
  growthRate: number;
  // Food production, stored reserves and seasonal harvests
  foodProduction: number;
  foodConsumption: number;
  foodStored: number;
  foodCapacity: number;
  kharif: CropState;
  rabi: CropState;
  lastHarvest: number;
  grainPrice: number;
  // Water availability, irrigation and infrastructure
  waterAvailability: number;
  irrigation: number;
  waterInfrastructure: number;
  // Housing, sanitation and public order
  housing: number;
  sanitation: number;
  publicOrder: number;
  health: number;
  // Local wealth, taxation and trade
  wealth: number;
  taxRate: number;
  taxIncome: number;
  tradeIncome: number;
  tradeVolume: number;
  // Recruitment potential and loyalty to the government
  recruitmentPotential: number;
  recruitPool: number;
  loyalty: number;
  // Infrastructure condition and disaster exposure
  infrastructure: number;
  disasterExposure: DisasterExposure;
  damage: number;
  // Buildings, jobs
  buildings: BuildingInstance[];
  construction: ConstructionJob[];
  recruitment: RecruitmentJob[];
  // Order & defense
  unrest: number;
  rebellionStage: RebellionStage;
  fortLevel: number;
  wallHp: number;
  garrison: ArmyUnitState[];
  besiegedBy: ArmyId | null;
  siegeDays: number;
  resources: ResourceKind[];
  /** Relief/requisition memory for consequence chains (GDD §6 example). */
  requisitionedFood: number;
  /** Day of last change in owner. */
  ownerSinceDay: number;
  // --- Contracts v2 (DESIGN_SPEC §7.2-§7.9, §8; @sprint1 SIM-01 unless noted) ---
  /** Owner at game start (Liberate is offered only for settlements independent at start, §7.8). */
  initialOwnerFactionId: FactionId | null;
  /** Day the current owner took it by force (occupation loyalty penalty fades over 360 days); null = not occupied. */
  occupiedSinceDay: number | null;
  /** Captured by `factionId` and waiting for its occupy / plunder / liberate decision (capture_decision). */
  pendingCapture: { factionId: FactionId; day: number } | null;
  /** Consecutive days with an empty store (starve-out surrender chance 0.1 x days / 10, famine). */
  starvationDays: number;
  /** Day the settlement entered 'revolt' (secession after 30 days); null when not in revolt. */
  revoltSinceDay: number | null;
  /** Temporary tax cut from negotiate_rebels (rate restored when it expires); null = none. */
  taxRelief: { points: number; untilDay: number } | null;
  /** Grain drawn from the royal reserve as automatic relief this month (cap 30 days of consumption / month). */
  reliefThisMonth: number;
  /** 0..1 assault-ladder preparation by besieging engineers (assault without a breach at 1 = 5 days). */
  ladderProgress: number;
  /** Age landmarks standing here. */
  landmarks: LandmarkInstance[];
  /** Output point for new recruits (absent = garrison). Set by set_rally_point. */
  rallyPoint?: RallyPoint;
}

export interface ProvinceState {
  id: ProvinceId;
  name: string;
  zone: RegionZone;
  ownerFactionId: FactionId | null;
  governorId: CharacterId | null;
  capitalSettlementId: SettlementId;
  settlementIds: SettlementId[];
  center: Vec2;
  /** Boundary polygon (world meters), counter-clockwise. */
  boundary: Vec2[];
  fertility: number;
  resources: ResourceKind[];
  unrest: number;
  rebellionStage: RebellionStage;
  /** Tax autonomy granted (0 = direct rule, 1 = full autonomy). */
  autonomy: number;
}

export const ROAD_QUALITIES = ['track', 'road', 'royal_road'] as const;
export type RoadQuality = (typeof ROAD_QUALITIES)[number];

export interface RoadNode {
  id: RoadNodeId;
  x: number;
  z: number;
  settlementId: SettlementId | null;
}

export interface RoadEdge {
  id: RoadEdgeId;
  a: RoadNodeId;
  b: RoadNodeId;
  quality: RoadQuality;
  /** 0..1, damaged roads slow travel and supply (GDD pillar: persistent consequences). */
  condition: number;
  /** Meters along the polyline. */
  length: number;
  /** Polyline including endpoints (world meters). */
  points: Vec2[];
  bridge: boolean;
  ford: boolean;
  /** Army currently blocking the road, if any. */
  blockedBy: ArmyId | null;
}

export interface RoadGraph {
  nodes: Record<RoadNodeId, RoadNode>;
  edges: Record<RoadEdgeId, RoadEdge>;
  adjacency: Record<RoadNodeId, RoadEdgeId[]>;
}

export interface ArmyUnitState {
  id: ArmyUnitId;
  unitClass: UnitClass;
  soldiers: number;
  maxSoldiers: number;
  /** 0..1 */
  experience: number;
  /** 0..100 */
  morale: number;
  /** 0..1 */
  fatigue: number;
  /** 0..1 equipment condition. */
  equipment: number;
  /** 0..1 ammunition (ranged). */
  ammo: number;
}

export const ARMY_STATUSES = ['marching', 'camped', 'besieging', 'in_battle', 'routed', 'garrisoned', 'disbanded'] as const;
export type ArmyStatus = (typeof ARMY_STATUSES)[number];

export type ArmyOrder =
  | { kind: 'idle' }
  | { kind: 'move'; x: number; z: number }
  | { kind: 'attack_army'; targetArmyId: ArmyId }
  | { kind: 'besiege'; settlementId: SettlementId }
  | { kind: 'garrison'; settlementId: SettlementId }
  | { kind: 'raid'; settlementId: SettlementId }
  | { kind: 'forage' }
  | { kind: 'retreat'; x: number; z: number }
  | { kind: 'escort'; depotId: DepotId }
  | { kind: 'patrol'; points: Vec2[] }
  /** v2: march to a source (own settlement / depot id, null = nearest) and refill supply (§7.8). @sprint1 SIM-01 */
  | { kind: 'resupply'; sourceId: string | null }
  /** v2: assault a besieged settlement once breached (wallHp <= 50%) or laddered -> siege battle. @sprint1 SIM-01 */
  | { kind: 'assault'; settlementId: SettlementId };
export type ArmyOrderKind = ArmyOrder['kind'];

export type ArmyStance = 'aggressive' | 'balanced' | 'cautious';

export interface ArmySupplyState {
  /** Food units carried by the army and its train. */
  food: number;
  foodCapacity: number;
  /** Food units consumed per day at current strength. */
  dailyConsumption: number;
  /** Where resupply comes from (depot or settlement id) or null. */
  sourceId: string | null;
  /** True if a safe road path to the source exists. */
  lineIntact: boolean;
  foraging: boolean;
  /** Consecutive days without food. */
  starvationDays: number;
}

export interface ArmyState {
  id: ArmyId;
  name: string;
  factionId: FactionId;
  commanderId: CharacterId | null;
  x: number;
  z: number;
  facing: number;
  /** Planned waypoints (world meters) - follows roads where possible. */
  path: Vec2[];
  pathIndex: number;
  order: ArmyOrder;
  stance: ArmyStance;
  status: ArmyStatus;
  units: ArmyUnitState[];
  supply: ArmySupplyState;
  /** 0..100 aggregate */
  morale: number;
  /** 0..1 */
  fatigue: number;
  /** Strategic travel speed in km/h of game time (after modifiers). */
  speedKmh: number;
  engagementId: EngagementId | null;
  /** Map of faction -> 0..1 how well that faction currently sees this army (espionage/scouting). */
  visibility: Record<FactionId, number>;
  createdDay: number;
  // --- Contracts v2 (DESIGN_SPEC §7.7, §7.9; @sprint1 SIM-01) ---
  /** Forced march (x1.3 speed, +0.1 fatigue/day, 0.2%/day attrition). */
  forcedMarch: boolean;
  /** Rebel armies only (`factionId === REBEL_FACTION_ID`): the revolting settlement they fight for. */
  rebelSettlementId?: SettlementId;
}

/** Last-known position of an enemy army that left visibility (minimap / map ghost outline for 5 days, §7.7). */
export interface ArmyGhost {
  armyId: ArmyId;
  factionId: FactionId;
  x: number;
  z: number;
  facing: number;
  /** Soldiers as estimated by the observer's intel tier at the time (§7.11). */
  soldiers: number;
  /** World day it was last seen. */
  day: number;
}

export interface SupplyDepotState {
  id: DepotId;
  factionId: FactionId;
  x: number;
  z: number;
  settlementId: SettlementId | null;
  food: number;
  capacity: number;
  /** 0..1 */
  condition: number;
  escortArmyId: ArmyId | null;
  raided: boolean;
  /** v2: world day the depot becomes usable (built in 5 days, §7.8). @sprint1 SIM-01 */
  readyOnDay: number;
}

export type EngagementStatus = 'pending_player' | 'auto' | 'active' | 'resolved';

/** Contact between hostile armies on the strategic map (may become a battle). */
export interface Engagement {
  id: EngagementId;
  /** Armies per side; side 0 = attacker. */
  sides: [ArmyId[], ArmyId[]];
  x: number;
  z: number;
  settlementId: SettlementId | null;
  kind: BattleKind;
  startedHour: number;
  status: EngagementStatus;
  battleId: BattleId | null;
  /** Formation-level battle state while being resolved (distant battles keep stepping here). */
  battle: BattleState | null;
  outcome: BattleOutcome | null;
  /** v2: the winner's prisoner decision (results screen / `prisoners` command); null = undecided. @sprint1 SIM-01 */
  prisonerDecision: PrisonerDecision | null;
}

// --- Characters, dynasty, council (GDD §7) ---

export const CHARACTER_ROLES = ['ruler', 'heir', 'consort', 'governor', 'general', 'advisor', 'spy', 'courtier', 'claimant'] as const;
export type CharacterRole = (typeof CHARACTER_ROLES)[number];

export const TRAITS = [
  'just',
  'harsh',
  'ambitious',
  'content',
  'brave',
  'cautious',
  'devout',
  'scholarly',
  'greedy',
  'generous',
  'charismatic',
  'shrewd',
  'reckless',
  'loyal',
  'scheming',
  'frail',
  'robust',
  'strategist',
  'administrator',
  'diplomat',
] as const;
export type Trait = (typeof TRAITS)[number];

export const GOVERNOR_INTERESTS = ['wealth', 'power', 'faith', 'family', 'land', 'learning'] as const;
export type GovernorInterest = (typeof GOVERNOR_INTERESTS)[number];

export const COUNCIL_SEATS = ['chief_minister', 'commander', 'treasurer', 'spymaster', 'court_scholar'] as const;
export type CouncilSeat = (typeof COUNCIL_SEATS)[number];

export interface CharacterSkills {
  /** 0..20 each */
  martial: number;
  stewardship: number;
  diplomacy: number;
  intrigue: number;
  learning: number;
}

export interface CharacterState {
  id: CharacterId;
  name: string;
  dynastyId: DynastyId | null;
  factionId: FactionId;
  gender: 'male' | 'female';
  birthYear: number;
  alive: boolean;
  deathYear: number | null;
  /** 0..1 */
  health: number;
  traits: Trait[];
  skills: CharacterSkills;
  roles: CharacterRole[];
  /** 0..1 loyalty to the faction's ruler. */
  loyalty: number;
  /** 0..1 */
  ambition: number;
  interest: GovernorInterest;
  /** -100..100 */
  opinionOfRuler: number;
  spouseId: CharacterId | null;
  parentIds: CharacterId[];
  childIds: CharacterId[];
  /** 0..1 strength of claim to the throne. */
  claim: number;
  locationSettlementId: SettlementId | null;
  armyId: ArmyId | null;
  governsProvinceId: ProvinceId | null;
  councilSeat: CouncilSeat | null;
  prestige: number;
  /** v2: faction holding this character prisoner (captured commanders: ransom 500 or held, §6.8); null = free. */
  captiveOf: FactionId | null;
}

export const SUCCESSION_LAWS = ['primogeniture', 'designated_heir', 'council_election', 'seniority'] as const;
export type SuccessionLaw = (typeof SUCCESSION_LAWS)[number];

export interface DynastyState {
  id: DynastyId;
  name: string;
  factionId: FactionId;
  headId: CharacterId;
  memberIds: CharacterId[];
  prestige: number;
  /** 0..1 */
  legitimacy: number;
  successionLaw: SuccessionLaw;
  founderYear: number;
  /** Number of generations played (GDD: campaign continues across generations). */
  generation: number;
}

export interface AdvisorRecommendation {
  advisorId: CharacterId;
  seat: CouncilSeat;
  topic: 'economy' | 'military' | 'diplomacy' | 'order' | 'succession' | 'espionage';
  text: string;
  /** Command the advisor wants (UI offers a one-click "Do it"). */
  suggestion: StrategicCommand | null;
  /** 0..1 */
  urgency: number;
}

// --- Factions (runtime) ---

export interface FactionLedger {
  taxIncome: number;
  tradeIncome: number;
  tribute: number;
  armyUpkeep: number;
  buildingUpkeep: number;
  administration: number;
  construction: number;
  recruitment: number;
  other: number;
  net: number;
  foodProduced: number;
  foodConsumed: number;
}

export type TaxPolicy = 'lenient' | 'standard' | 'heavy' | 'emergency';

export type AiGoal =
  | { kind: 'defend'; settlementId: SettlementId; priority: number }
  | { kind: 'conquer'; settlementId: SettlementId; priority: number }
  | { kind: 'develop'; settlementId: SettlementId; priority: number }
  | { kind: 'stabilize'; settlementId: SettlementId; priority: number }
  | { kind: 'ally'; factionId: FactionId; priority: number }
  | { kind: 'secure_supply'; armyId: ArmyId; priority: number };

export interface FactionAiState {
  personality: AiPersonality;
  goals: AiGoal[];
  lastPlanHour: number;
  /** Perceived threat per other faction 0..1. */
  threat: Record<FactionId, number>;
  /**
   * v2: persistent scratch memory for the campaign AI (SIM-02) - e.g. chosen landmark, last war day, plan ids.
   * Plain values only; saved and hashed like all state.
   */
  memory: Record<string, number | string | boolean>;
}

export const VICTORY_TYPES = ['unification', 'prosperity', 'diplomatic_hegemony', 'cultural_legacy', 'scenario'] as const;
export type VictoryType = (typeof VICTORY_TYPES)[number];

/** Faction stockpiles of building materials (DESIGN_SPEC §7.5; AoE wood / stone). */
export interface MaterialStock {
  timber: number;
  stone: number;
}

/** Realm-wide economic policies (economy panel, `set_policy`). */
export interface FactionPolicies {
  /** "Hold the reserve": no automatic relief draws from the royal granaries (§7.3.5). */
  holdReserve: boolean;
  /** Rationing active until this world day (consumption x0.85, unrest/health costs); null = off. */
  rationingUntilDay: number | null;
}

/** AoE market price factors per lot (1 = base price of RULES.market.buy; clamp 0.5..3, recover 1%/day). */
export interface MarketPrices {
  grain: number;
  timber: number;
  stone: number;
}
export type MarketResource = keyof MarketPrices;

export interface FactionState {
  id: FactionId;
  name: string;
  archetype: FactionArchetype;
  isPlayer: boolean;
  alive: boolean;
  capitalSettlementId: SettlementId | null;
  rulerId: CharacterId | null;
  heirId: CharacterId | null;
  dynastyId: DynastyId | null;
  treasury: number;
  /** Central reserve of food units (royal granaries). */
  foodReserve: number;
  manpower: number;
  prestige: number;
  /** 0..1 */
  legitimacy: number;
  /** 0..1 internal stability. */
  stability: number;
  taxPolicy: TaxPolicy;
  council: Partial<Record<CouncilSeat, CharacterId>>;
  /** Last completed month. */
  ledger: FactionLedger;
  ai: FactionAiState;
  /** 0..1 progress per victory path (GDD §7). */
  victoryProgress: Record<VictoryType, number>;
  /** Free-form scripted state (event flags scoped to this faction). */
  flags: Record<string, number | boolean | string>;
  // --- Contracts v2 (DESIGN_SPEC §7-§8; @sprint1 SIM-01 unless noted) ---
  /** Current age (§8.4). Initial: ScenarioDef.startingAges > FactionDef.startingAge > 'janapada'. */
  age: AgeId;
  /** LandmarkDef ids this faction completed, in order (age requirements, exclusivity, score). */
  landmarks: string[];
  materials: MaterialStock;
  policies: FactionPolicies;
  marketPrices: MarketPrices;
  /** Ghost markers of enemy armies this faction lost sight of, by army id (kept 5 days). */
  ghosts: Record<ArmyId, ArmyGhost>;
  /** Counter-intelligence level from counter_intelligence successes (+0.3 each, divides enemy success, §7.11). */
  counterIntel: number;
  /** Day the counter-intelligence bonus expires (null = none active). */
  counterIntelUntilDay: number | null;
  /** Day the protect_court bonus (-50% legitimacy loss from plots) expires (null = none active). */
  protectCourtUntilDay: number | null;
  /** Consecutive ignored recommendations per council seat (3 in a row -> grievance, §7.12). */
  advisorIgnored: Record<CouncilSeat, number>;
  /** This month's council recommendations (at most one per seat, §7.12): shown by the council screen, scored at month end. */
  councilAdvice: AdvisorRecommendation[];
  /** Accumulated cultural-legacy points (culture effects x10 per month; victory at RULES.victory.cultural_legacy). */
  culturePoints: number;
  /** Consecutive days the prosperity victory conditions held (sustainDays = 180). */
  prosperityDays: number;
}

// --- Diplomacy (GDD §7) ---

export const TREATY_TYPES = ['peace', 'trade', 'military_access', 'mutual_defense', 'tributary', 'marriage_alliance', 'non_aggression'] as const;
export type TreatyType = (typeof TREATY_TYPES)[number];

export interface TreatyTerms {
  /** Wealth per month from `payer` to `overlord` (tributary). */
  tributePerMonth: number;
  payer: FactionId | null;
  overlord: FactionId | null;
  /** 0..1 autonomy granted to the tributary. */
  autonomy: number;
  /** Marriage alliance participants. */
  marriage: [CharacterId, CharacterId] | null;
  durationDays: number | null;
}

export interface Treaty {
  id: TreatyId;
  type: TreatyType;
  parties: [FactionId, FactionId];
  terms: TreatyTerms;
  startDay: number;
  endDay: number | null;
  brokenBy: FactionId | null;
}

export interface Grievance {
  kind: 'broken_treaty' | 'raid' | 'border_incident' | 'insult' | 'spy_caught' | 'war' | 'marriage_refused';
  day: number;
  /** Opinion impact (negative), decays over time. */
  amount: number;
}

export interface RelationState {
  /** Sorted pair; key in DiplomacyState.relations is `${a}|${b}` with a < b. */
  a: FactionId;
  b: FactionId;
  /** -100..100 */
  opinion: number;
  /** 0..1 */
  trust: number;
  atWar: boolean;
  warStartDay: number | null;
  /** -100..100 from a's perspective. */
  warScore: number;
  treatyIds: TreatyId[];
  grievances: Grievance[];
  /** v2: war weariness points (+3 per month at war; AI peace utility, §7.10). @sprint1 SIM-01 */
  warWeariness: number;
  /** v2: no war may be declared before this day (peace truce 360 days); null = no truce. @sprint1 SIM-01 */
  truceUntilDay: number | null;
}

export type ProposalType = TreatyType | 'declare_war' | 'ceasefire' | 'demand_tribute' | 'break_treaty';

export interface DiplomaticProposal {
  id: ProposalId;
  from: FactionId;
  to: FactionId;
  type: ProposalType;
  terms: TreatyTerms;
  day: number;
  status: 'pending' | 'accepted' | 'rejected' | 'expired';
  /** AI explanation lines shown to the player. */
  reasons: string[];
}

export interface DiplomacyState {
  relations: Record<string, RelationState>;
  treaties: Record<TreatyId, Treaty>;
  proposals: DiplomaticProposal[];
}

// --- Espionage (GDD §7: intelligence networks limit what rivals know) ---

export const SPY_MISSIONS = ['gather_intel', 'counter_intelligence', 'sabotage_supply', 'incite_unrest', 'spread_rumors', 'protect_court'] as const;
export type SpyMission = (typeof SPY_MISSIONS)[number];

export interface SpyAgent {
  id: AgentId;
  characterId: CharacterId | null;
  ownerFactionId: FactionId;
  targetFactionId: FactionId;
  targetSettlementId: SettlementId | null;
  mission: SpyMission;
  /** 0..1 */
  progress: number;
  /** 0..1 chance of capture per check. */
  risk: number;
  /** 0..20 */
  skill: number;
  status: 'active' | 'captured' | 'returned' | 'dead';
  startedDay: number;
}

export interface IntelState {
  /** 0..1 how much the observer knows about the target. */
  level: number;
  lastUpdatedDay: number;
  /** v2: target armies stay visible until this day (gather_intel success: 60 days); null = no reveal. */
  armiesVisibleUntilDay: number | null;
}

export interface EspionageState {
  agents: Record<AgentId, SpyAgent>;
  /** intel[observer][target] */
  intel: Record<FactionId, Record<FactionId, IntelState>>;
  /** network[owner][target] 0..1 */
  network: Record<FactionId, Record<FactionId, number>>;
}

// --- Events & consequence chains (GDD §6 example chain, §8 branching) ---

export const EVENT_CATEGORIES = ['narrative', 'economic', 'disaster', 'political', 'military', 'diplomatic', 'dynastic', 'cultural'] as const;
export type EventCategory = (typeof EVENT_CATEGORIES)[number];

export type SettlementVar = NumericKeys<SettlementState>;
export type FactionVar = 'treasury' | 'foodReserve' | 'manpower' | 'prestige' | 'legitimacy' | 'stability';
export type CharacterVar = 'loyalty' | 'ambition' | 'opinionOfRuler' | 'health' | 'prestige' | 'claim';

/** Who an event condition/effect applies to. "scope_*" refer to the event instance's scope. */
export type ScopeRef =
  | { kind: 'player' }
  | { kind: 'scope_faction' }
  | { kind: 'faction'; id: FactionId }
  | { kind: 'scope_settlement' }
  | { kind: 'settlement'; id: SettlementId }
  | { kind: 'capital' }
  | { kind: 'any_owned_settlement' }
  | { kind: 'scope_character' }
  | { kind: 'character'; id: CharacterId }
  | { kind: 'ruler' };

export type Condition =
  | { kind: 'all'; of: Condition[] }
  | { kind: 'any'; of: Condition[] }
  | { kind: 'not'; cond: Condition }
  | { kind: 'settlement_var'; target: ScopeRef; variable: SettlementVar; op: CompareOp; value: number }
  | { kind: 'faction_var'; target: ScopeRef; variable: FactionVar; op: CompareOp; value: number }
  | { kind: 'character_var'; target: ScopeRef; variable: CharacterVar; op: CompareOp; value: number }
  | { kind: 'rebellion_stage_at_least'; target: ScopeRef; stage: RebellionStage }
  | { kind: 'season'; season: Season }
  | { kind: 'weather'; weather: WeatherKind }
  | { kind: 'day_at_least'; day: number }
  | { kind: 'flag'; flag: string; value: number | boolean | string }
  | { kind: 'flag_set'; flag: string }
  | { kind: 'at_war'; a: ScopeRef; b: ScopeRef | null }
  | { kind: 'has_treaty'; a: ScopeRef; b: ScopeRef; type: TreatyType }
  | { kind: 'owns_settlement'; faction: ScopeRef; settlementId: SettlementId }
  | { kind: 'battle_won'; faction: ScopeRef; withinDays: number }
  | { kind: 'army_strength_at_least'; faction: ScopeRef; soldiers: number }
  | { kind: 'event_resolved'; eventId: EventDefId; choiceId: string | null }
  | { kind: 'random'; chance: number }
  /** v2 (DESIGN_SPEC §14.3 item 6): the faction has reached `age` or a later one. @sprint1 SIM-01 */
  | { kind: 'age_at_least'; faction: ScopeRef; age: AgeId }
  /** v2: the faction completed `landmarkId` (null = any landmark). @sprint1 SIM-01 */
  | { kind: 'landmark_built'; faction: ScopeRef; landmarkId: string | null };

export type Effect =
  | { kind: 'settlement_var'; target: ScopeRef; variable: SettlementVar; op: 'add' | 'set' | 'mul'; value: number }
  | { kind: 'faction_var'; target: ScopeRef; variable: FactionVar; op: 'add' | 'set' | 'mul'; value: number }
  | { kind: 'character_var'; target: ScopeRef; variable: CharacterVar; op: 'add' | 'set' | 'mul'; value: number }
  | { kind: 'set_flag'; flag: string; value: number | boolean | string }
  | { kind: 'clear_flag'; flag: string }
  | { kind: 'trigger_event'; eventId: EventDefId; delayDays: number }
  | { kind: 'opinion'; a: ScopeRef; b: ScopeRef; delta: number }
  | { kind: 'sign_treaty'; a: ScopeRef; b: ScopeRef; type: TreatyType }
  | { kind: 'declare_war'; a: ScopeRef; b: ScopeRef }
  | { kind: 'set_rebellion_stage'; target: ScopeRef; stage: RebellionStage }
  | { kind: 'spawn_army'; faction: ScopeRef; x: number | null; z: number | null; nearSettlement: SettlementId | null; units: { unitClass: UnitClass; formations: number }[]; name: string }
  | { kind: 'damage_road'; edgeId: RoadEdgeId | null; nearSettlement: SettlementId | null; amount: number }
  | { kind: 'transfer_settlement'; settlement: ScopeRef; to: ScopeRef }
  | { kind: 'kill_character'; target: ScopeRef }
  | { kind: 'objective'; objectiveId: ObjectiveId; status: 'complete' | 'failed' }
  | { kind: 'chronicle'; text: string };

export interface EventChoiceDef {
  id: string;
  label: string;
  description: string;
  effects: Effect[];
  /** Choice hidden/disabled unless this holds. */
  requires: Condition | null;
  /** Relative AI preference when an AI faction resolves this event. */
  aiWeight: number;
  /** Council seat whose advisor recommends this choice (UI shows competing advice). */
  advisorSeat: CouncilSeat | null;
}

export interface EventDef extends Sourced {
  id: EventDefId;
  category: EventCategory;
  title: string;
  /** Text with {placeholders}: {settlement}, {province}, {faction}, {character}, {ruler}, {amount}. */
  body: string;
  /** Illustration key for the UI event card. */
  illustration: 'granary' | 'court' | 'battle' | 'river' | 'temple' | 'market' | 'monsoon' | 'drought' | 'fire' | 'crowd' | 'messenger' | 'wedding' | 'funeral' | 'fort';
  /** What the instance is attached to. */
  scope: 'global' | 'faction' | 'settlement' | 'character';
  trigger: Condition;
  /** Mean days-to-happen once trigger holds (0 = fire immediately). */
  meanDays: number;
  once: boolean;
  cooldownDays: number;
  /** Only offered to the player faction (AI factions skip it). */
  playerOnly: boolean;
  /** Campaign chapter restriction (null = any). */
  chapter: number | null;
  choices: EventChoiceDef[];
  /** Days until the first choice is auto-picked if the player ignores it (null = waits). */
  autoResolveDays: number | null;
}

export interface EventScope {
  factionId: FactionId;
  settlementId: SettlementId | null;
  provinceId: ProvinceId | null;
  characterId: CharacterId | null;
  armyId: ArmyId | null;
}

export interface EventInstance {
  id: EventInstanceId;
  defId: EventDefId;
  day: number;
  scope: EventScope;
  status: 'pending' | 'resolved' | 'expired';
  choiceId: string | null;
  resolvedDay: number | null;
  /** Resolved text substitutions. */
  params: Record<string, string | number>;
}

export interface ScheduledEvent {
  eventId: EventDefId;
  day: number;
  scope: EventScope;
}

export interface EventSystemState {
  pending: EventInstance[];
  /** Bounded history (most recent last). */
  history: EventInstance[];
  flags: Record<string, number | boolean | string>;
  /** defId -> day until which it cannot fire again. */
  cooldowns: Record<EventDefId, number>;
  scheduled: ScheduledEvent[];
  firedOnce: EventDefId[];
}

// --- Campaign scenarios & victory ---

export interface ObjectiveDef {
  id: ObjectiveId;
  label: string;
  description: string;
  condition: Condition;
  /** Fails the objective when true (null = cannot fail). */
  failCondition: Condition | null;
  optional: boolean;
  reward: Effect[];
  /** Optional (additive): act number (ScenarioDef.acts) the objective belongs to, for UI grouping. */
  act?: number;
}

export interface ScenarioOutcomeDef {
  id: string;
  kind: 'victory' | 'defeat' | 'mixed';
  title: string;
  epilogue: string;
  condition: Condition;
  /** Higher wins when several outcomes match the same day. */
  priority: number;
  /**
   * Optional (additive): when true the outcome ends the scenario as soon as its condition holds (like
   * defeats do today); otherwise victory/mixed outcomes are evaluated only at the time limit.
   */
  immediate?: boolean;
  /** Optional (additive): which victory path this outcome represents (results screen icon + statistics). */
  victoryType?: VictoryType;
}

/** Optional act structure inside one scenario (DESIGN_SPEC §9). An act is active while its flag is set. */
export interface ScenarioActDef {
  id: string;
  /** Act number shown in the UI (1-based). */
  number: number;
  title: string;
  subtitle: string;
  /** World event flag set when this act begins (e.g. "act" == 2). */
  flag: string;
  flagValue: number | boolean | string;
  summary: string;
}

export interface InitialArmyDef {
  id: ArmyId;
  name: string;
  factionId: FactionId;
  /** Spawn at/near a settlement. */
  settlementId: SettlementId;
  commanderId: CharacterId | null;
  units: { unitClass: UnitClass; formations: number }[];
}

export interface InitialCharacterDef {
  id: CharacterId;
  name: string;
  factionId: FactionId;
  dynastyId: DynastyId | null;
  gender: 'male' | 'female';
  age: number;
  roles: CharacterRole[];
  traits: Trait[];
  skills: CharacterSkills;
  loyalty: number;
  ambition: number;
  interest: GovernorInterest;
  governsProvinceId: ProvinceId | null;
  councilSeat: CouncilSeat | null;
  spouseId: CharacterId | null;
  parentIds: CharacterId[];
}

export interface ScenarioDef extends Sourced {
  id: ScenarioId;
  /** GDD §8 chapter 1..5, or 0 for sandbox templates. */
  chapter: number;
  title: string;
  subtitle: string;
  description: string;
  playerFactionId: FactionId;
  factionIds: FactionId[];
  startYear: number;
  startMonth: number;
  seed: number;
  /** settlementId -> owner (null = independent). Missing = region default. */
  settlementOwners: Record<SettlementId, FactionId | null>;
  armies: InitialArmyDef[];
  characters: InitialCharacterDef[];
  dynasties: { id: DynastyId; name: string; factionId: FactionId; headId: CharacterId; successionLaw: SuccessionLaw }[];
  relations: { a: FactionId; b: FactionId; opinion: number; atWar: boolean; treaties: TreatyType[] }[];
  treasury: Record<FactionId, number>;
  objectives: ObjectiveDef[];
  outcomes: ScenarioOutcomeDef[];
  /** Days until the scenario ends and outcomes are evaluated (null = open-ended). */
  timeLimitDays: number | null;
  scriptedEvents: { eventId: EventDefId; day: number }[];
  victoryTypes: VictoryType[];
  hints: string[];
  // --- Optional content extensions (Creative Director, additive; see docs/DESIGN_SPEC.md) ---
  acts?: ScenarioActDef[];
  /** Age each faction starts in (missing = FactionDef.startingAge ?? 'janapada'). */
  startingAges?: Partial<Record<FactionId, AgeId>>;
  /** Character the player controls in hero exploration (default: heir, else ruler). */
  heroCharacterId?: CharacterId;
  /** Starting timber/stone stockpiles per faction (DESIGN_SPEC §7.5; requires the stockpile state). */
  materials?: Partial<Record<FactionId, { timber: number; stone: number }>>;
  /**
   * Strength of the monsoon that feeds the first kharif harvest (1 = normal, 0.4..1.4; DESIGN_SPEC §7.3).
   * Requires the requested `WorldState.monsoon` state; ignored until the sim implements it.
   */
  monsoonStrength?: number;
}

export interface VictoryState {
  status: 'ongoing' | 'victory' | 'defeat' | 'ended';
  outcomeId: string | null;
  objectives: Record<ObjectiveId, 'pending' | 'complete' | 'failed'>;
  endedDay: number | null;
}

export interface SandboxSetup {
  seed: number;
  playerFactionId: FactionId;
  rivalFactionIds: FactionId[];
  startMonth: number;
  startingTreasury: number;
  /** 0.5..1.5 multipliers / 0..1 levels. */
  fertility: number;
  monsoonStrength: number;
  droughtRisk: number;
  rebelliousness: number;
  aiAggression: number;
  difficulty: Difficulty;
  victoryTypes: VictoryType[];
}

export interface SkirmishArmyDef {
  factionId: FactionId;
  formations: { unitClass: UnitClass; soldiers: number }[];
}

export interface SkirmishSetup {
  seed: number;
  preset: TerrainPreset;
  /** Total soldiers across both sides (URL ?soldiers=N). Used when `armies` is null. */
  totalSoldiers: number;
  playerFactionId: FactionId;
  enemyFactionId: FactionId;
  /** Explicit armies, or null for a balanced auto-generated composition. */
  armies: [SkirmishArmyDef, SkirmishArmyDef] | null;
  playerSide: SideIndex;
  hour: number;
  season: Season;
  weather: WeatherKind;
  difficulty: Difficulty;
  /** Spectate AI vs AI (QA / attract mode). */
  aiVsAi: boolean;
  /** v2: SKIRMISH_COMPOSITIONS ids per side [player, enemy] used when `armies` is null (default: faction default). */
  compositions?: [string, string];
}

export type WorldSetup =
  | { kind: 'scenario'; scenarioId: ScenarioId; seed: number | null; difficulty: Difficulty }
  | { kind: 'sandbox'; sandbox: SandboxSetup };

export interface ChronicleEntry {
  day: number;
  factionId: FactionId | null;
  text: string;
  importance: 0 | 1 | 2;
}

export interface WorldStatsSample {
  day: number;
  factions: Record<FactionId, { treasury: number; population: number; food: number; soldiers: number; stability: number; settlements: number }>;
}

export interface RegionState {
  id: string;
  name: string;
  terrain: TerrainSpec;
  bounds: Rect;
}

/** The monsoon that feeds this year's kharif crop (DESIGN_SPEC §7.3.3). */
export interface MonsoonState {
  /** M, 0.4..1.4 (1 = normal; < 0.7 failed, > 1.2 flood). Rolled on month 4 day 1. */
  strength: number;
  /** Display year `strength` applies to. */
  year: number;
  /** Month-3 forecast shown to the player (+-0.15, exact with a learned court scholar); null outside month 3. */
  forecast: number | null;
}

export interface WorldState {
  /** WorldState schema version (see core/save.ts migrations). */
  schema: number;
  seed: number;
  mode: GameMode;
  scenarioId: ScenarioId | null;
  sandbox: SandboxSetup | null;
  difficulty: Difficulty;
  /** Authoritative strategic RNG state. */
  rng: RngState;
  /** Monotonic id counter for deterministic id generation (`${prefix}_${n}`). */
  nextId: number;
  calendar: CalendarState;
  weather: WeatherState;
  region: RegionState;
  playerFactionId: FactionId;
  factions: Record<FactionId, FactionState>;
  provinces: Record<ProvinceId, ProvinceState>;
  settlements: Record<SettlementId, SettlementState>;
  roads: RoadGraph;
  armies: Record<ArmyId, ArmyState>;
  depots: Record<DepotId, SupplyDepotState>;
  engagements: Record<EngagementId, Engagement>;
  characters: Record<CharacterId, CharacterState>;
  dynasties: Record<DynastyId, DynastyState>;
  diplomacy: DiplomacyState;
  espionage: EspionageState;
  events: EventSystemState;
  victory: VictoryState;
  /** Last N battle outcomes (persistent consequences / chronicle). */
  battleHistory: BattleOutcome[];
  chronicle: ChronicleEntry[];
  stats: WorldStatsSample[];
  // --- Contracts v2 ---
  /** This year's monsoon (initial: scenario / sandbox monsoonStrength, else 1). @sprint1 SIM-01 */
  monsoon: MonsoonState;
  /**
   * End-game statistics counters per faction, keyed by END_GAME_STATS ids (src/data/statistics.ts) marked
   * "tracked" (e.g. soldiers_raised, enemies_killed, famine_days). Absent key = 0. @sprint1 SIM-01
   */
  statistics: Record<FactionId, Record<string, number>>;
}

// =====================================================================================================
// Commands (player + AI). Applied at sim tick boundaries -> deterministic & replayable.
// =====================================================================================================

export type StrategicCommand =
  | { kind: 'move_army'; armyId: ArmyId; x: number; z: number }
  | { kind: 'army_order'; armyId: ArmyId; order: ArmyOrder }
  | { kind: 'set_army_stance'; armyId: ArmyId; stance: ArmyStance }
  | { kind: 'split_army'; armyId: ArmyId; unitIds: ArmyUnitId[] }
  | { kind: 'merge_armies'; armyId: ArmyId; otherArmyId: ArmyId }
  | { kind: 'disband_army'; armyId: ArmyId }
  | { kind: 'recruit'; settlementId: SettlementId; unitClass: UnitClass; formations: number; targetArmyId: ArmyId | null }
  /** v2: `cell`/`rot` place a new building on the settlement grid (absent = auto placement / upgrade). */
  | { kind: 'build'; settlementId: SettlementId; building: BuildingType; cell?: GridCell; rot?: Rotation }
  /** v2: `jobIndex` (queue index) wins over `building` and also cancels landmark jobs (locked after 50%). */
  | { kind: 'cancel_construction'; settlementId: SettlementId; building: BuildingType; jobIndex?: number }
  | { kind: 'repair_road'; edgeId: RoadEdgeId }
  | { kind: 'set_tax_rate'; settlementId: SettlementId; rate: number }
  | { kind: 'set_tax_policy'; policy: TaxPolicy }
  | { kind: 'set_labor'; settlementId: SettlementId; allocation: LaborAllocation }
  | { kind: 'requisition_grain'; settlementId: SettlementId; amount: number; toArmyId: ArmyId | null; toDepotId: DepotId | null }
  | { kind: 'send_relief'; settlementId: SettlementId; food: number; wealth: number }
  | { kind: 'create_depot'; x: number; z: number; settlementId: SettlementId | null }
  | { kind: 'transfer_supply'; fromId: string; toId: string; amount: number }
  | { kind: 'appoint_governor'; provinceId: ProvinceId; characterId: CharacterId | null }
  | { kind: 'appoint_council'; seat: CouncilSeat; characterId: CharacterId | null }
  | { kind: 'designate_heir'; characterId: CharacterId }
  | { kind: 'arrange_marriage'; characterId: CharacterId; otherCharacterId: CharacterId }
  | { kind: 'propose'; to: FactionId; type: ProposalType; terms: TreatyTerms }
  | { kind: 'respond_proposal'; proposalId: ProposalId; accept: boolean }
  | { kind: 'spy_mission'; targetFactionId: FactionId; mission: SpyMission; settlementId: SettlementId | null; agentCharacterId: CharacterId | null }
  | { kind: 'recall_agent'; agentId: AgentId }
  | { kind: 'event_choice'; eventInstanceId: EventInstanceId; choiceId: string }
  | { kind: 'negotiate_rebels'; settlementId: SettlementId; offer: 'relief' | 'tax_cut' | 'autonomy' | 'coercion' }
  | { kind: 'engagement_decision'; engagementId: EngagementId; decision: 'fight' | 'autoresolve' | 'retreat' }
  // --- Contracts v2 (DESIGN_SPEC §14.3 item 3; @sprint1 SIM-01 implements, UI-02 / GP-03 issue) ---
  /** AoE market: buy or sell `lots` x 100 of a resource (needs a Market in any owned settlement). */
  | { kind: 'market_trade'; resource: MarketResource; lots: number; buy: boolean }
  /** Start an age landmark at a settlement cell (pays the cost; one per faction per age). */
  | { kind: 'start_landmark'; landmarkId: string; settlementId: SettlementId; cell: GridCell; rot?: Rotation }
  /** Economy panel toggles: hold the royal reserve / rationing (120 days). */
  | { kind: 'set_policy'; policy: 'hold_reserve' | 'rationing'; on: boolean }
  | { kind: 'forced_march'; armyId: ArmyId; on: boolean }
  /** Results-screen decision on the prisoners of a won battle. */
  | { kind: 'prisoners'; engagementId: EngagementId; decision: PrisonerDecision }
  /** Decision for a settlement in `pendingCapture` (liberate only if independent at start). */
  | { kind: 'capture_decision'; settlementId: SettlementId; decision: CaptureDecision }
  /** Where the settlement's new recruits gather (null clears it = garrison). */
  | { kind: 'set_rally_point'; settlementId: SettlementId; rallyPoint: RallyPoint | null }
  /** Repair a damaged building (scaffold stage; cost x (1 - condition)). */
  | { kind: 'repair_building'; settlementId: SettlementId; building: BuildingType };

export interface IssuedStrategicCommand {
  factionId: FactionId;
  /** Calendar.totalHours when applied (filled by the sim). */
  hour: number;
  cmd: StrategicCommand;
}

/** Things that happened during a strategic tick. Drives UI notifications, audio and session flow. */
export type SimEvent =
  | { kind: 'new_day'; day: number }
  | { kind: 'new_month'; month: number }
  | { kind: 'season_changed'; season: Season }
  | { kind: 'new_year'; year: number }
  | { kind: 'weather_changed'; weather: WeatherKind }
  | { kind: 'harvest'; settlementId: SettlementId; crop: 'kharif' | 'rabi'; amount: number }
  | { kind: 'shortage'; settlementId: SettlementId; severity: number }
  | { kind: 'disaster'; settlementId: SettlementId; disaster: 'flood' | 'drought' | 'fire' | 'epidemic'; severity: number }
  | { kind: 'construction_complete'; settlementId: SettlementId; building: BuildingType; level: number }
  | { kind: 'recruitment_complete'; settlementId: SettlementId; unitClass: UnitClass; armyId: ArmyId | null }
  | { kind: 'army_arrived'; armyId: ArmyId }
  | { kind: 'army_supply_low'; armyId: ArmyId; days: number }
  | { kind: 'army_starving'; armyId: ArmyId }
  | { kind: 'engagement_started'; engagementId: EngagementId; involvesPlayer: boolean }
  | { kind: 'engagement_resolved'; engagementId: EngagementId; winnerFactionId: FactionId | null }
  | { kind: 'siege_started'; settlementId: SettlementId; armyId: ArmyId }
  | { kind: 'settlement_captured'; settlementId: SettlementId; from: FactionId | null; to: FactionId }
  | { kind: 'rebellion_stage'; settlementId: SettlementId; stage: RebellionStage }
  | { kind: 'event_fired'; instanceId: EventInstanceId; factionId: FactionId }
  | { kind: 'proposal_received'; proposalId: ProposalId; to: FactionId }
  | { kind: 'treaty_signed'; treatyId: TreatyId }
  | { kind: 'treaty_broken'; treatyId: TreatyId; by: FactionId }
  | { kind: 'war_declared'; a: FactionId; b: FactionId }
  | { kind: 'peace_made'; a: FactionId; b: FactionId }
  | { kind: 'character_died'; characterId: CharacterId }
  | { kind: 'succession'; factionId: FactionId; newRulerId: CharacterId; crisis: boolean }
  | { kind: 'character_born'; characterId: CharacterId }
  | { kind: 'spy_report'; agentId: AgentId; success: boolean; text: string }
  | { kind: 'objective_updated'; objectiveId: ObjectiveId; status: 'complete' | 'failed' }
  | { kind: 'scenario_ended'; outcomeId: string; result: 'victory' | 'defeat' | 'mixed' }
  | { kind: 'notification'; factionId: FactionId | null; severity: 'info' | 'warning' | 'danger' | 'success'; text: string; focus: Vec2 | null }
  // --- Contracts v2 feedback events (small payloads; @sprint1 SIM-01 emits, GP-03 / UI-02 / AUD-01 consume) ---
  | { kind: 'construction_started'; settlementId: SettlementId; building: BuildingType; level: number; landmarkId: string | null }
  | { kind: 'landmark_started'; factionId: FactionId; settlementId: SettlementId; landmarkId: string }
  /** Landmark completed -> new age (age-up fanfare: camera swoop to the landmark, conch + drums). */
  | { kind: 'age_advanced'; factionId: FactionId; age: AgeId; landmarkId: string | null; settlementId: SettlementId | null }
  | { kind: 'monsoon_roll'; strength: number; year: number; result: 'failed' | 'normal' | 'flood' }
  /** Grain lost: above storage capacity (toast "312 measures spoiled at ...") or daily decay. */
  | { kind: 'spoilage'; settlementId: SettlementId; amount: number; reason: 'capacity' | 'decay' }
  | { kind: 'market_trade'; factionId: FactionId; resource: MarketResource; lots: number; buy: boolean; wealth: number }
  | { kind: 'rebels_spawned'; settlementId: SettlementId; armyId: ArmyId; soldiers: number }
  | { kind: 'secession'; settlementId: SettlementId; from: FactionId | null }
  | { kind: 'governor_demand'; provinceId: ProvinceId; characterId: CharacterId }
  /** Strategic siege: walls at <= 50% (assault possible). */
  | { kind: 'siege_breach'; settlementId: SettlementId; armyId: ArmyId | null }
  | { kind: 'depot_raided'; depotId: DepotId; armyId: ArmyId; factionId: FactionId }
  /** An enemy army entered `observerFactionId`'s sight (minimap ping, ghost cleared). */
  | { kind: 'army_sighted'; armyId: ArmyId; factionId: FactionId; observerFactionId: FactionId; x: number; z: number }
  | { kind: 'hero_mission_available'; missionId: string };
export type SimEventKind = SimEvent['kind'];

// =====================================================================================================
// Balance (Creative Director tunes values in src/data/balance.ts)
// =====================================================================================================

export interface MoraleWeights {
  leadership: number;
  cohesion: number;
  fatigue: number;
  supply: number;
  tacticalPosition: number;
  recentEvents: number;
  perceivedRisk: number;
}

export interface BalanceConfig {
  economy: {
    foodPerPersonPerDay: number;
    foodPerFarmerPerDay: number;
    baseTaxPerCapitaPerMonth: number;
    tradeBasePerMonth: number;
    /** Price response to shortage (0 = fixed prices). */
    priceElasticity: number;
    granarySpoilagePerDay: number;
    populationGrowthPerYear: number;
    famineDeathRatePerDay: number;
    kharifHarvestMonth: number;
    rabiHarvestMonth: number;
    monsoonYieldBonus: number;
    droughtYieldPenalty: number;
    irrigationYieldBonus: number;
    infrastructureDecayPerDay: number;
    laborPerPopulation: number;
  };
  military: {
    soldierFoodPerDay: number;
    marchKmPerDay: Record<RoadQuality | 'offroad', number>;
    monsoonMarchFactor: number;
    forageFoodPerDay: number;
    starvationMoralePerDay: number;
    fatiguePerMarchDay: number;
    recoveryPerRestDay: number;
    /** Strategic map meters are scaled by this when computing travel time (map is compressed). */
    travelScale: number;
    contactRadius: number;
    siegeAttritionPerDay: number;
  };
  morale: {
    weights: MoraleWeights;
    /** Morale below which a formation routs. */
    routThreshold: number;
    /** Morale above which a routing formation can rally. */
    rallyThreshold: number;
    /** Points/second morale moves toward its target. */
    driftPerSec: number;
    commanderFallenShock: number;
    flankShock: number;
    rearShock: number;
    allyRoutShock: number;
    allyRoutRadius: number;
    chargeShock: number;
  };
  combat: {
    meleeDamageScale: number;
    rangedDamageScale: number;
    chargeImpulse: number;
    flankMultiplier: number;
    rearMultiplier: number;
    heightAdvantagePerMeter: number;
    fatigueRunPerSec: number;
    fatigueFightPerSec: number;
    fatigueRecoverPerSec: number;
    pursuitKillRate: number;
    surrenderMorale: number;
    captureFraction: number;
    cohesionLossPerSecMoving: number;
    cohesionRecoverPerSec: number;
  };
  politics: {
    loyaltyDriftPerDay: number;
    unrestFromHunger: number;
    unrestFromTax: number;
    /** Unrest thresholds for each RebellionStage after 'calm'. */
    rebellionThresholds: number[];
    successionCrisisChance: number;
    governorAmbitionWeight: number;
  };
  diplomacy: {
    opinionDecayPerMonth: number;
    tradeOpinionBonus: number;
    warWearinessPerMonth: number;
    tributeOpinionPenalty: number;
    grievanceDecayPerMonth: number;
  };
  espionage: {
    baseSuccessPerDay: number;
    baseRiskPerDay: number;
    intelDecayPerMonth: number;
  };
}

// =====================================================================================================
// Region definition (static map data authored in src/data/region.ts)
// =====================================================================================================

export interface SettlementDef extends Sourced {
  id: SettlementId;
  name: string;
  kind: SettlementKind;
  provinceId: ProvinceId;
  /** Normalized position 0..1 across the region (u = west->east, v = north->south). Resolved to a
   *  buildable site near this point (see core/terrain/sites.ts). */
  u: number;
  v: number;
  /** Site preference when resolving the exact position. */
  site: 'riverside' | 'hilltop' | 'plain' | 'forest_edge' | 'crossing';
  population: number;
  defaultOwner: FactionId | null;
  buildings: { type: BuildingType; level: number }[];
  resources: ResourceKind[];
  fortLevel: number;
}

export interface ProvinceDef extends Sourced {
  id: ProvinceId;
  name: string;
  zone: RegionZone;
  capitalSettlementId: SettlementId;
  fertility: number;
  resources: ResourceKind[];
}

export interface RoadDef {
  from: SettlementId;
  to: SettlementId;
  quality: RoadQuality;
}

export interface RegionDef extends Sourced {
  id: string;
  name: string;
  description: string;
  /** Terrain seed + spec for the whole region (sizeMeters, resolution, river...). */
  terrain: TerrainSpec;
  provinces: ProvinceDef[];
  settlements: SettlementDef[];
  roads: RoadDef[];
}

// =====================================================================================================
// RNG state (implemented in core/rng.ts)
// =====================================================================================================

/** sfc32 state: four unsigned 32-bit integers. */
export type RngState = [number, number, number, number];

// =====================================================================================================
// Quality settings  (GDD §10, §14 - scalable graphics/simulation by device capability)
// =====================================================================================================

export const QUALITY_TIERS = ['low', 'medium', 'high', 'ultra'] as const;
export type QualityTier = (typeof QUALITY_TIERS)[number];

export interface QualitySettings {
  tier: QualityTier;
  /** Target frame rate the dynamic resolution controller aims for. */
  targetFps: 30 | 60;
  /** Max device pixel ratio used. */
  maxPixelRatio: number;
  dynamicResolution: { enabled: boolean; minScale: number; maxScale: number };
  /**
   * Sun shadows. v2: `pcss` = PCSS-style kernel scaled by the sun's angular softness (high+), `contact` =
   * screen-space contact shadows (ultra). Cascades 1/2/3/4 by tier (ART_BIBLE §13).
   */
  shadows: { enabled: boolean; mapSize: number; cascades: number; distance: number; soft: boolean; contact: boolean; pcss: boolean };
  ao: 'off' | 'ssao' | 'gtao';
  aoHalfRes: boolean;
  bloom: boolean;
  /** 'taa' (v2) = TAA in hero mode and cutscenes, SMAA elsewhere (post.setTaa, GFX-01). */
  antialias: 'none' | 'fxaa' | 'smaa' | 'taa';
  colorGrading: boolean;
  vignette: boolean;
  fog: boolean;
  /** PMREM environment map resolution (IBL). 0 = hemisphere light only. */
  envMapSize: number;
  water: { reflections: 'envmap' | 'planar'; resolutionScale: number };
  terrain: { chunkSegments: number; detailTextures: boolean; textureSize: number };
  vegetation: { density: number; grassDistance: number; treeDistance: number; windAnimation: boolean };
  /** Soldier LOD distances in meters: <near = full model+anim, <mid = simplified, <far = impostor. */
  soldierLod: { near: number; mid: number; far: number };
  /** Soldier-level local sim radius around camera focus (beyond: slot-follow only). */
  localSimRadius: number;
  maxSoldiers: number;
  particles: number;
  anisotropy: number;
  /** Cloth/banner simulation in shader. */
  banners: boolean;
  weatherParticles: number;
  // --- Contracts v2 (ART_BIBLE §13, ARCHITECTURE §19; tuned by GFX-01 which owns core/quality.ts) ---
  /** Screen-space reflections on water and wet stone (ultra). */
  ssr: boolean;
  /** Depth of field, film grain and chromatic aberration: off | hero mode + cutscenes | every close band. */
  dof: 'off' | 'hero' | 'close';
  /** Volumetric sun-shaft samples (0 = off; 24 / 32 / 48). */
  shaftsSamples: number;
  /** Shafts rendered at half resolution (ultra: full). */
  shaftsHalfRes: boolean;
  /** Fog model: FogExp2 (x0.6 density on low) | analytic height fog | height fog + mist-slab noise. */
  heightFog: 'exp2' | 'height' | 'height_mist';
  /** Lens dirt on bloom + edge chromatic aberration (ultra). */
  lensEffects: boolean;
  /** GPU grass blades per m^2 (0 = off: terrain colour only). */
  grassDensity: number;
  /** Practical lights (torches, lamps) rendered as real PointLights; the rest become emissive sprites. */
  practicalLights: number;
  /** Trees switch to octahedral impostors beyond this distance (m). */
  treeImpostorDistance: number;
  /** Cosmetic villagers per settlement in view (DESIGN_SPEC §8.3: 30 / 60 / 120 / 200). */
  villagerCap: number;
  /** Crowd LOD max distances (m): VAT LOD0 (0 = never), VAT LOD1, impostors (beyond: tokens / culled). */
  crowdLod: { vat0: number; vat1: number; impostor: number };
  /** Emissive multiplier compensating for missing bloom (low 1.3). */
  emissiveBoost: number;
  /** Baked (vertex / macro) AO strength multiplier compensating for missing GTAO (low 1.2). */
  bakedAoBoost: number;
  /** Single merged post pass (grade + vignette + FXAA) instead of the full stack (low). */
  postMerged: boolean;
  /** Audio voices (pool cap 16 / 32 / 48) and HRTF panning (high+, else equal-power) - AUD-01. */
  audio: { voices: number; hrtf: boolean };
}

export interface QualityDetection {
  tier: QualityTier;
  reasons: string[];
  isMobile: boolean;
  isTouch: boolean;
  gpuRenderer: string;
  gpuVendor: string;
  deviceMemoryGb: number | null;
  cores: number;
  webgl2: boolean;
  maxTextureSize: number;
  softwareRenderer: boolean;
  /** Tier came from ?quality= or saved settings rather than heuristics. */
  overridden: boolean;
}

// =====================================================================================================
// Input actions  (GDD §10 PC + mobile UX)
// =====================================================================================================

export const INPUT_ACTIONS = [
  // global
  'pause',
  'speed_up',
  'speed_down',
  'speed_reset',
  'menu',
  'quick_save',
  'quick_load',
  'toggle_profiler',
  'screenshot',
  'cancel',
  // selection / commands
  'select',
  'select_add',
  'box_select',
  'context_command',
  'radial_menu',
  'select_all',
  'group_assign',
  'group_select',
  // battle orders
  'order_hold',
  'order_advance',
  'order_withdraw',
  'order_regroup',
  'order_flank',
  'order_defend',
  'order_attack',
  'order_charge',
  'order_run_toggle',
  'shape_line',
  'shape_column',
  'shape_square',
  'shape_wedge',
  // overlays
  'overlay_supply',
  'overlay_terrain',
  'overlay_borders',
  // camera
  'camera_focus',
  'camera_reset',
  'camera_toggle_cinematic',
  // hero
  'hero_interact',
  'hero_run',
  'hero_exit',
  // --- Contracts v2 (DESIGN_SPEC §8.8 Classic / Grid presets, §11.8 hero controls; bound by UI-02) ---
  // battle shapes, stance, commander
  'shape_loose',
  'shape_circle',
  'order_stance',
  'commander_rally',
  // AoE world command
  'idle_builders_next',
  'idle_army_next',
  'select_capital',
  'placement_rotate',
  // command card (5 x 3 grid, row-major Q W E R T / A S D F G / Z X C V B in the Grid preset)
  'card_next_tab',
  'card_slot_0',
  'card_slot_1',
  'card_slot_2',
  'card_slot_3',
  'card_slot_4',
  'card_slot_5',
  'card_slot_6',
  'card_slot_7',
  'card_slot_8',
  'card_slot_9',
  'card_slot_10',
  'card_slot_11',
  'card_slot_12',
  'card_slot_13',
  'card_slot_14',
  // camera
  'camera_rotate_left',
  'camera_rotate_right',
  // hero melee (Wukong set) + cinematics + dialogue
  'hero_attack_light',
  'hero_attack_heavy',
  'hero_roll',
  'hero_guard',
  'hero_salve',
  'hero_lock_on',
  'hero_skip_cinematic',
  'dialogue_choice_1',
  'dialogue_choice_2',
  'dialogue_choice_3',
  'dialogue_choice_4',
  'dialogue_choice_5',
] as const;
export type InputAction = (typeof INPUT_ACTIONS)[number];

export type PointerKind = 'mouse' | 'touch' | 'pen';

export interface PointerInfo {
  /** CSS pixels relative to the canvas. */
  x: number;
  y: number;
  /** Normalized device coordinates -1..1 (y up). */
  ndcX: number;
  ndcY: number;
  kind: PointerKind;
  /** 0 primary, 2 secondary (mouse) */
  button: number;
}

export interface InputActionEvent {
  action: InputAction;
  pointer: PointerInfo | null;
  /** Box select rectangle in CSS px. */
  box: { x0: number; y0: number; x1: number; y1: number } | null;
  /** Control group 0..9 for group_assign/group_select. */
  group: number | null;
  shift: boolean;
  ctrl: boolean;
}

/** Continuous input sampled once per frame (consumed deltas reset after `InputManager.frame()`). */
export interface InputFrame {
  /** -1..1 camera pan (keyboard/edge scroll/joystick). */
  panX: number;
  panY: number;
  /** Pixel drag delta for grab-pan (mouse middle / one-finger drag on empty ground). */
  dragX: number;
  dragY: number;
  /** Radians-ish rotate delta (Q/E, right-drag, two-finger twist). */
  rotate: number;
  /** Tilt delta (R/F, two-finger vertical drag). */
  tilt: number;
  /** Zoom delta (+ = in). Wheel / pinch. */
  zoom: number;
  /** Zoom anchor in NDC (pinch center / cursor) or null. */
  zoomAnchor: { ndcX: number; ndcY: number } | null;
  /** Hero movement -1..1 (WASD / virtual joystick). */
  moveX: number;
  moveY: number;
  /** Hero look delta. */
  lookX: number;
  lookY: number;
  run: boolean;
  /** Current hover pointer (desktop) or null. */
  pointer: PointerInfo | null;
  /** Actions that fired since last frame. */
  actions: InputActionEvent[];
  /** True if the primary input is touch (UI may show larger targets). */
  touchMode: boolean;
}

// =====================================================================================================
// Settings & saves
// =====================================================================================================

export interface GameSettings {
  quality: QualityTier | 'auto';
  qualityOverrides: Partial<QualitySettings>;
  masterVolume: number;
  musicVolume: number;
  sfxVolume: number;
  ambienceVolume: number;
  uiScale: number;
  edgeScroll: boolean;
  invertZoom: boolean;
  cameraSpeed: number;
  showHints: boolean;
  reducedMotion: boolean;
  colorblind: 'none' | 'protan' | 'deutan' | 'tritan';
  /** action -> key codes (KeyboardEvent.code), e.g. { order_hold: ['KeyH'] } */
  keybindings: Partial<Record<InputAction, string[]>>;
  // --- Contracts v2 (DESIGN_SPEC §8.8, §12.3-§12.6; defaults in core/settings.ts) ---
  /** Key preset: Classic (mnemonic letters, WASD camera) or Grid (AoE IV-like QWERT/ASDFG/ZXCVB). */
  keyPreset: KeyPreset;
  /** Auto-pause options (§6.13, §12.6). */
  autoPause: { battleStart: boolean; commanderFallen: boolean; formationRouted: boolean; narrativeEvents: boolean };
  /** Tutorial hint ids already shown on this profile (TUTORIAL_HINTS, shown once). */
  hintsSeen: string[];
  /** Phone simple command mode (intents/stances/shapes behind "More"). 'auto' = on for touch-primary devices. */
  simpleMode: boolean | 'auto';
  /** Colour formations and tokens by relation (own / ally / enemy) instead of faction colour. */
  relationColoring: boolean;
  /** Minimap stays north-up instead of rotating with the camera. */
  minimapNorthUp: boolean;
  /** Hold-to-toggle accessibility options (§12.5). */
  holdToToggle: { guard: boolean; run: boolean };
  /** Subtitles / captions (hero dialogue, barks, cinematics). */
  subtitles: boolean;
}

export const KEY_PRESETS = ['classic', 'grid'] as const;
export type KeyPreset = (typeof KEY_PRESETS)[number];

export interface SaveMeta {
  slot: string;
  name: string;
  mode: GameMode;
  scene: SceneId;
  playerFactionId: FactionId | null;
  calendar: CalendarState | null;
  /** ISO timestamp (metadata only - never read by the sim). */
  createdAt: string;
  playtimeSec: number;
  buildVersion: string;
  summary: string;
  /** Small JPEG data URL or null. */
  thumbnail: string | null;
}

export interface SaveSession {
  mode: GameMode;
  scene: SceneId;
  skirmish: SkirmishSetup | null;
  /** Engagement the player is fighting, if saved mid-battle. */
  activeEngagementId: EngagementId | null;
  /**
   * v2: hero visit in progress when saved (autosave on entering hero mode, DESIGN_SPEC §2.3) so loading routes
   * back to the hero scene; a mission restarts from its beginning (mid-mission progress is never saved). null otherwise.
   */
  hero: { settlementId: SettlementId | null; missionId: string | null } | null;
}

export interface SaveGame {
  format: 'samrajya-save';
  /** Save format version (core/save.ts SAVE_VERSION). */
  version: number;
  meta: SaveMeta;
  session: SaveSession;
  world: WorldState | null;
  /** Standalone battle (skirmish) state when saved mid-battle. */
  battle: BattleState | null;
}

export interface SaveSlotInfo {
  slot: string;
  meta: SaveMeta;
  sizeBytes: number;
}

// =====================================================================================================
// Content schema extensions  (Creative Director, ADDITIVE - authored in src/data/**, specified in
// docs/DESIGN_SPEC.md). Nothing here is referenced by WorldState/BattleState yet; sim/UI integration is
// requested in the design spec's handoff section.
// =====================================================================================================

// --- Ages (AoE-style progression re-themed: village polity -> kingdom -> empire) ---

export const AGE_IDS = ['janapada', 'mahajanapada', 'samrajya'] as const;
export type AgeId = (typeof AGE_IDS)[number];

/** Materials + money cost. `labor` is person-days of work (see DESIGN_SPEC §7.6 construction). */
export interface MaterialCost {
  wealth: number;
  timber: number;
  stone: number;
  labor: number;
}

export interface AgeRequirements {
  /** Age the faction must currently be in (null for the first age). */
  previous: AgeId | null;
  minSettlements: number;
  minProvinces: number;
  minPopulation: number;
  /** Distinct building types (any level) across owned settlements. */
  minBuildingTypes: number;
  minLegitimacy: number;
  minStability: number;
}

export interface AgeDef extends Sourced {
  id: AgeId;
  /** 0, 1, 2 */
  index: number;
  numeral: 'I' | 'II' | 'III';
  name: string;
  /** Short tagline, e.g. "Age of Clans and Villages". */
  title: string;
  description: string;
  /** Requirements to START the landmark that advances INTO this age (first age: none). */
  requirements: AgeRequirements;
  /** Buildings first available in this age. */
  unlockBuildings: BuildingType[];
  /** Max level any building may reach in this age (per-type caps below override). */
  maxBuildingLevel: number;
  buildingLevelCaps: Partial<Record<BuildingType, number>>;
  /** Unit classes first recruitable in this age. */
  unlockUnits: UnitClass[];
  /** Treaty types the faction may propose from this age. */
  unlockTreaties: TreatyType[];
  /** Multiplicative faction modifier bonuses granted on reaching the age (1 = none). */
  bonuses: Partial<FactionModifiers>;
  /** Flat bonuses for newly recruited formations from this age (experience 0..1, morale points). */
  recruitBonus: { experience: number; morale: number; armor: number };
  /** Number of province governors the court can support without legitimacy loss. */
  governorSlots: number;
}

/** Faction-unique landmark: building it advances the faction into `age` (pick one of two). */
export interface LandmarkDef extends Sourced {
  id: string;
  factionId: FactionId;
  /** The age this landmark advances the faction INTO. */
  age: AgeId;
  name: string;
  localName?: string;
  description: string;
  /** One-line mechanical summary for the tooltip. */
  summary: string;
  cost: MaterialCost;
  buildDays: number;
  allowedIn: SettlementKind[];
  footprint: BuildingFootprint;
  /** Procedural pieces composing it (render may add a bespoke model later). */
  architecture: ArchitectureKind[];
  /** Approximate height in meters (silhouette readability on the strategic map). */
  heightMeters: number;
  /** Applied to the host settlement. */
  settlementEffects: SettlementModifiers;
  /** Applied to every owned settlement. */
  realmEffects: SettlementModifiers;
  /** Multiplicative faction modifier changes (1 = none). */
  factionEffects: Partial<FactionModifiers>;
  /** One-time effects on completion (event DSL; scope = owner faction + host settlement). */
  onComplete: Effect[];
}

// --- Strategic resources (AoE presentation of the GDD §6 economy) ---

export const ECONOMY_RESOURCES = ['grain', 'timber', 'stone', 'wealth', 'labor', 'manpower'] as const;
export type EconomyResource = (typeof ECONOMY_RESOURCES)[number];

export interface ResourceDisplayDef {
  id: EconomyResource;
  name: string;
  /** AoE analogue (food / wood / stone / gold / villagers / population). */
  aoeAnalogue: string;
  /** Procedural icon key for the UI icon painter. */
  icon: 'sheaf' | 'logs' | 'block' | 'coins' | 'villager' | 'spear';
  /** Icon tint (UI uses theme tokens; this is the reference color). */
  color: HexColor;
  /** Where the number comes from (state path, documentation for UI devs). */
  source: string;
  /** Tooltip line. */
  description: string;
  /** Display unit, e.g. "measures" (1 grain measure = 10 person-days of rations). */
  unit: string;
}

// --- Difficulty & AI personalities ---

export interface DifficultyDef {
  id: Difficulty;
  name: string;
  description: string;
  /** Multipliers on player / AI tax + trade income. */
  playerIncome: number;
  aiIncome: number;
  /** Multiplier on AI recruitment cost and time. */
  aiRecruitCost: number;
  /** 0..1 added to AI aggression (war declarations, attacks). */
  aiAggressionBonus: number;
  /** Seconds between battle-AI re-plans (lower = sharper). */
  battleAiReplanSec: number;
  /** Added to AI commander martial skill (0..20 scale). */
  aiCommanderSkill: number;
  /** Added to player formations' base morale. */
  playerMoraleBonus: number;
  /** Multiplier on negative event magnitudes (famine, unrest, disasters). */
  eventSeverity: number;
  /** Hero mode: parry window (s), enemy damage multiplier, player HP multiplier. */
  heroParryWindowSec: number;
  heroEnemyDamage: number;
  heroPlayerHp: number;
  /** Tutorial hints on by default. */
  hints: boolean;
}

export interface AiPersonalityDef {
  id: AiPersonality;
  name: string;
  description: string;
  /** Relative utility weights for the campaign AI planner (sum need not be 1). */
  weights: { expand: number; defend: number; develop: number; diplomacy: number; raid: number; trade: number };
  /** Declares war when (own strength / target strength) * opinion factor exceeds this. */
  warRatio: number;
  /** Sues for peace when war score (own perspective) falls below this (-100..100). */
  peaceWarScore: number;
  /** Will accept becoming a tributary when strength ratio below this. */
  tributaryRatio: number;
  /** Battle AI tuning. */
  battle: {
    /** 0..1 preference to attack vs hold. */
    aggression: number;
    /** 0..1 how often cavalry is sent around the flank. */
    flanking: number;
    /** Fraction of formations kept in reserve. */
    reserve: number;
    /** Side withdraws when its strength falls below this fraction of the start. */
    withdrawAt: number;
  };
}

// --- Tutorial / contextual hints ---

export interface TutorialHintDef {
  id: string;
  /** UI trigger key (documented in DESIGN_SPEC §12.4), e.g. "world.first_army_selected". */
  trigger: string;
  title: string;
  text: string;
  /** Alternative text for touch devices (null = same). */
  touchText: string | null;
  scene: SceneId;
  /** Lower shows first when several hints are due. */
  priority: number;
}

// --- Hero exploration (GDD §3 limited scope; DESIGN_SPEC §11) ---

export const NEGOTIATION_TACTICS = ['duty', 'gain', 'strength', 'kinship', 'reveal'] as const;
export type NegotiationTactic = (typeof NEGOTIATION_TACTICS)[number];

export const HERO_MOODS = ['dawn_mist', 'golden_dust', 'noon_haze', 'monsoon_wet', 'lamp_night', 'incense_dim'] as const;
export type HeroMood = (typeof HERO_MOODS)[number];

/** A district of a hero-explorable settlement. Anchor is polar around the settlement centre. */
export interface HeroDistrictDef extends Sourced {
  id: string;
  settlementId: SettlementId;
  name: string;
  localName?: string;
  description: string;
  /** Facing-convention angle (0 = +Z south, PI/2 = +X east) of the district centre from the settlement centre. */
  angle: number;
  /** 0..1 fraction of the settlement radius. */
  radius: number;
  /** Pieces the layout should concentrate here. */
  architecture: ArchitectureKind[];
  /** 0..1 ambient crowd density (cosmetic villagers per 100 m^2 scaled by quality). */
  crowd: number;
  mood: HeroMood;
  /** Ambient sound bed keys for audio. */
  ambience: string[];
  /** Points of interest the player can inspect (clues for negotiations). */
  inspectables: HeroInspectableDef[];
}

export interface HeroInspectableDef {
  id: string;
  label: string;
  /** Architecture piece the prompt attaches to. */
  kind: ArchitectureKind;
  /** Text shown when inspected. */
  text: string;
  /** Clue id unlocked (enables `reveal` arguments), or null. */
  clue: string | null;
  /** Optional world effects when first inspected. */
  effects: Effect[];
}

export interface NegotiationProfile {
  /** 0..100 starting stance toward the hero's cause. */
  startStance: number;
  /** Number of arguments before the counterpart ends the talk. */
  patience: number;
  /** Stance >= this wins the negotiation. */
  winAt: number;
  /** Stance <= this ends it as a failure. */
  loseAt: number;
  strongVs: NegotiationTactic[];
  weakVs: NegotiationTactic[];
  /** Tactics that reduce stance. */
  backfires: NegotiationTactic[];
  /** Clue ids that make `reveal` available. */
  revealClues: string[];
  /** Flags set on success / failure (also applied as event effects). */
  onSuccess: Effect[];
  onFailure: Effect[];
}

export interface HeroAppearanceDef {
  silhouette: 'noble' | 'warrior' | 'priest' | 'merchant' | 'farmer' | 'scholar' | 'guard' | 'envoy' | 'child';
  /** Garment colors (reference; render picks nearest palette entry). */
  garment: HexColor;
  accent: HexColor;
  headgear: 'none' | 'turban' | 'crown' | 'helmet' | 'veil' | 'topknot';
  prop: 'none' | 'staff' | 'ledger' | 'sword' | 'mace' | 'bow' | 'lamp' | 'scroll' | 'basket' | 'spear';
  /** Height multiplier vs a 1.7 m adult. */
  scale: number;
}

export interface HeroCharacterDef extends Sourced {
  id: string;
  name: string;
  title: string;
  /** One line: who they are and what they want. */
  role: string;
  /** Link to a scenario character (opinion/loyalty updates), or null for townsfolk. */
  characterId: CharacterId | null;
  settlementId: SettlementId;
  districtId: string;
  appearance: HeroAppearanceDef;
  traits: Trait[];
  interest: GovernorInterest;
  /** Dialogue tree id (src/data/hero.ts DIALOGUES) or null for ambient barks only. */
  dialogueId: string | null;
  negotiation: NegotiationProfile | null;
  /** Short ambient lines spoken when the hero walks past. */
  barks: string[];
}

export interface DialogueChoiceDef {
  id: string;
  label: string;
  /** Next node id, or null to end the conversation. */
  next: string | null;
  /** Negotiation argument type (only inside negotiation trees). */
  tactic: NegotiationTactic | null;
  /** Choice shown only when the condition holds / the clue is known. */
  requires: Condition | null;
  requiresClue: string | null;
  effects: Effect[];
  /** Starts a hero mission when picked. */
  startsMission: string | null;
}

export interface DialogueNodeDef {
  id: string;
  /** HeroCharacterDef id, 'hero', or 'narrator'. */
  speaker: string;
  text: string;
  choices: DialogueChoiceDef[];
}

export interface DialogueTreeDef {
  id: string;
  start: string;
  nodes: Record<string, DialogueNodeDef>;
}

export type HeroObjectiveKind = 'reach' | 'talk' | 'inspect' | 'persuade' | 'defeat' | 'survive' | 'protect' | 'duel';

export interface HeroObjectiveDef {
  id: string;
  kind: HeroObjectiveKind;
  label: string;
  /** District, character, inspectable, enemy-wave or escort id (by kind). */
  target: string | null;
  /** How many (e.g. persuade 3 of 4 nobles). */
  count: number;
  optional: boolean;
}

export interface HeroEnemyDef {
  id: string;
  name: string;
  archetype: 'swordsman' | 'spearman' | 'archer' | 'captain' | 'champion';
  hp: number;
  /** Poise: stagger threshold; heavy hits and parries deplete it. */
  poise: number;
  /** Damage of light / heavy / unblockable attacks. */
  damage: { light: number; heavy: number; unblockable: number };
  /** Seconds between attack decisions (lower = more aggressive). */
  attackInterval: number;
  /** m/s */
  moveSpeed: number;
  /** Telegraph time (s) for heavy / unblockable attacks (the red flash). */
  telegraphSec: number;
  /** Phase thresholds (fraction of hp) that change the moveset (champions). */
  phases: number[];
}

export interface HeroWaveDef {
  id: string;
  /** enemy id -> count */
  enemies: { enemy: string; count: number }[];
  /** Seconds after the previous wave is cleared (0 = immediately). */
  delaySec: number;
  /** Spawn district or named marker. */
  spawn: string;
}

export interface CinematicShotDef {
  id: string;
  durationSec: number;
  camera: 'aerial' | 'crane_down' | 'tracking_behind' | 'steadicam_side' | 'low_angle' | 'close_up' | 'over_shoulder' | 'orbit';
  /** What the shot frames (district id, character id or landmark). */
  subject: string;
  /** Fractional hour of day for lighting. */
  hour: number;
  mood: HeroMood;
  /** Subtitle / narration (null = none). */
  line: string | null;
  /** Hero walks under player control during this shot (opening walk). */
  playerControl: boolean;
}

export interface HeroMissionDef extends Sourced {
  id: string;
  title: string;
  kind: 'cinematic' | 'negotiation' | 'combat' | 'duel' | 'training';
  settlementId: SettlementId;
  /** One paragraph shown on the mission card. */
  description: string;
  /** When the mission is offered (event DSL, player scope). */
  availability: Condition;
  startDistrict: string;
  /** Hour of day the mission is played at. */
  hour: number;
  objectives: HeroObjectiveDef[];
  waves: HeroWaveDef[];
  cinematic: CinematicShotDef[];
  /** Real seconds; null = untimed. */
  timeLimitSec: number | null;
  /** Applied to the world on success / failure (player scope). */
  onSuccess: Effect[];
  onFailure: Effect[];
  /** Can the player retry on failure (combat missions: yes; negotiations: no). */
  retryable: boolean;
}

/**
 * Result of a hero mission handed to the session at the END of the mission only (DESIGN_SPEC §11.6, §11.9):
 * `completeHeroMission(result)` (GP-03) applies `onSuccess` / `onFailure` plus the recorded dialogue and clue
 * effects exactly once through SIM-01 `applyHeroMissionResult(world, factionId, result, out)`. Abandoning a
 * mission applies nothing. Deterministic plain data (saved in no state; flags it produces are).
 */
export interface HeroMissionResult {
  missionId: string;
  /** true = success; false = the player accepted the failure ("Accept the outcome"). */
  success: boolean;
  /** HeroObjectiveDef ids completed (optional ones included). */
  objectivesCompleted: string[];
  /** Clue ids found (become flags `clue_<id>`). */
  clues: string[];
  /** Dialogue choices taken as `dlg_<tree>_<choice>` keys whose effects apply once. */
  dialogueChoices: string[];
  /** Negotiation results by HeroCharacterDef id. */
  negotiations: Record<string, 'won' | 'lost'>;
  /** Hero health 0..1 at the end (a wounded prince feeds events). */
  heroHealth: number;
  /** Tries used (1 = first attempt). */
  attempts: number;
  /** Real seconds played (statistics only - never read by the sim). */
  durationSec: number;
}

/** One move of the hero's focused melee set (Wukong-like feel, tiny scope). Times in seconds. */
export interface HeroMoveDef {
  id: string;
  input: string;
  damage: number;
  /** Poise damage dealt. */
  poiseDamage: number;
  staminaCost: number;
  startupSec: number;
  activeSec: number;
  recoverySec: number;
  /** Time into the move after which a dodge/next attack can cancel it. */
  cancelAfterSec: number;
  /** Hit-stop on connect (ms) and camera shake amplitude (m). */
  hitStopMs: number;
  shake: number;
  /** Forward lunge distance (m). */
  lunge: number;
  /** Impact VFX key. */
  vfx: 'slash_spark' | 'heavy_dust' | 'parry_flash' | 'finisher_burst' | 'none';
}

export interface HeroCombatConfig {
  hp: number;
  stamina: number;
  staminaRegenPerSec: number;
  staminaRegenDelaySec: number;
  /** Light combo chain (in order) + heavy (charge) moves. */
  lightCombo: HeroMoveDef[];
  heavy: { min: HeroMoveDef; max: HeroMoveDef; chargeSec: number };
  dodge: { durationSec: number; iframeStartSec: number; iframeEndSec: number; distance: number; staminaCost: number; perfectWindowSec: number; perfectSlowMoSec: number; perfectTimeScale: number };
  block: { damageReduction: number; staminaPerDamage: number; regenWhileBlocking: number; guardBreakStaggerSec: number };
  parry: { windowSec: number; staggerSec: number; ripostMultiplier: number; hitStopMs: number; shake: number };
  remedy: { charges: number; heal: number; durationSec: number };
  lockOn: { range: number; coneRad: number };
  /** Hit-reaction on the hero. */
  hitStunSec: number;
  /** Camera framing (third person): distance, height, shoulder offset, FOV (deg) exploring / in combat. */
  camera: { exploreDistance: number; combatDistance: number; height: number; shoulder: number; fovExplore: number; fovCombat: number };
}
