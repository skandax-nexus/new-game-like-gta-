/**
 * AoE command-card models (DESIGN_SPEC §8.8): the 5 x 3 grid for a settlement (Economy / Military / Civic / Defense /
 * Recruit tabs by BuildingDef.category + commandSlot and UnitDef.commandSlot), an army (Orders) and battle formations
 * (Orders / Shapes / Intents pages). Pure: models are plain data the CommandGrid renders and tests inspect. Each slot
 * carries what activating it does (inject an input action, issue a command, ask the scene via a HUD command, open a
 * screen), its hotkey label for the active key preset, disabled reason and cost tooltip rows.
 * OWNER: UI Engineer - In-game HUD, Command Card, Minimap & Input (UI-02).
 */
import type {
  ArmyState,
  BattleCommand,
  BattleState,
  BuildingCategory,
  BuildingType,
  FactionId,
  FormationIndex,
  FormationShape,
  InputAction,
  IntentOrderType,
  KeyPreset,
  SideIndex,
  Stance,
  StrategicCommand,
  UnitClass,
  WorldState,
} from '../../core/types';
import { BUILDING_TYPES, UNIT_CLASSES } from '../../core/types';
import type { ScreenId } from '../../app/contracts';
import { BUILDINGS } from '../../data/buildings';
import { UNITS } from '../../data/units';
import { buildOptions, commandReason, recruitOptions, type BuildOption } from '../../sim/strategic/selectors';
import { canCharge, isMounted } from '../../sim/tactical/stats';
import { CARD_SLOT_ACTIONS, hotkeyLabel, type BindingMap, type BindingScope } from '../../input/bindings';
import type { ArmyTargetOrder, HudCommand } from './hudCommands';
import { fmtInt, label as labelOf } from '../dom';

export const CARD_SLOTS = 15;

export type CardCommand =
  | { kind: 'input'; action: InputAction }
  | { kind: 'strategic'; cmd: StrategicCommand }
  | { kind: 'battle'; cmd: BattleCommand }
  | { kind: 'hud'; cmd: HudCommand }
  | { kind: 'screen'; screen: ScreenId }
  | { kind: 'visit'; settlementId: string }
  | { kind: 'none' };

export interface CardCostLine {
  label: string;
  value: string;
  /** Not enough of it right now. */
  short?: boolean;
}

export interface CardSlot {
  slot: number;
  /** Stable id ('build:granary', 'recruit:archers', 'order:order_hold', 'intent:hold_crossing'). */
  id: string;
  /** Short label under the icon (<= 9 characters where possible). */
  label: string;
  /** Full name (tooltip title / aria-label). */
  name: string;
  icon: string;
  hotkey: string;
  enabled: boolean;
  reason: string | null;
  active: boolean;
  /** Corner badge: queue count, level ('L2'), etc. */
  badge: string | null;
  /** 0..1 progress overlay (queued job), null = none. */
  progress: number | null;
  cost: CardCostLine[];
  description: string;
  /** Activation needs a second press within 3 s (disband). */
  confirm: boolean;
  command: CardCommand;
}

export interface CardTab {
  id: string;
  label: string;
  icon: string;
  badge: number | null;
}

export interface CardModel {
  kind: 'settlement' | 'army' | 'battle' | 'none';
  title: string;
  subtitle: string;
  tabs: CardTab[];
  tab: string;
  /** Length 15, row-major; null = empty slot. */
  slots: (CardSlot | null)[];
}

export interface CardContext {
  preset: KeyPreset;
  overrides?: BindingMap;
}

function emptySlots(): (CardSlot | null)[] {
  return new Array<CardSlot | null>(CARD_SLOTS).fill(null);
}

function slotKey(ctx: CardContext, scope: BindingScope, slot: number): string {
  return hotkeyLabel(ctx.preset, scope, CARD_SLOT_ACTIONS[slot]!, ctx.overrides);
}

function base(slot: number, id: string, labelText: string, name: string, iconId: string, hotkey: string, command: CardCommand): CardSlot {
  return { slot, id, label: labelText, name, icon: iconId, hotkey, enabled: true, reason: null, active: false, badge: null, progress: null, cost: [], description: '', confirm: false, command };
}

// ---------------------------------------------------------------------------------------------------
// Settlement
// ---------------------------------------------------------------------------------------------------

export const SETTLEMENT_TABS: readonly { id: BuildingCategory | 'recruit'; label: string; icon: string }[] = [
  { id: 'economy', label: 'Economy', icon: 'coins' },
  { id: 'military', label: 'Military', icon: 'b_barracks' },
  { id: 'civic', label: 'Civic', icon: 'b_temple' },
  { id: 'defense', label: 'Defense', icon: 'b_fort_walls' },
  { id: 'recruit', label: 'Recruit', icon: 'spear' },
];

const SHORT_BUILDING: Partial<Record<BuildingType, string>> = {
  farm_fields: 'Fields',
  irrigation_canal: 'Canal',
  water_tank: 'Tank',
  elephant_stables: 'Elephants',
  fort_walls: 'Walls',
  watchtower: 'Tower',
  road_station: 'Station',
  harbor: 'Harbor',
  mine: 'Quarry',
  housing: 'Housing',
  sanitation: 'Drains',
  stupa: 'Stupa',
  workshop: 'Workshop',
};

const SHORT_UNIT: Readonly<Record<UnitClass, string>> = {
  spearmen: 'Spears',
  archers: 'Archers',
  elite_guards: 'Guards',
  cavalry: 'Horse',
  chariots: 'Chariots',
  war_elephants: 'Elephants',
  engineers: 'Engineers',
  scouts: 'Scouts',
  supply_train: 'Supply',
};

export function buildingIcon(b: BuildingType): string {
  return `b_${b}`;
}

const buildOptsCache = new WeakMap<object, { key: string; opts: BuildOption[] }>();

/**
 * buildOptions (SIM-01) runs a placement search per building type (6-17 ms measured). The card refreshes up to twice
 * a second while the game runs, so its options are memoized per world on everything validateBuild reads: settlement
 * (owner, kind, radius, building and construction cells), faction age, treasury and materials, and the sim day as a
 * staleness bound. Any command that changes one of them recomputes at the next refresh. (SIM-01 is asked to cache
 * the placement search itself; this keeps the HUD from re-running it while nothing it depends on moved.)
 */
function cachedBuildOptions(w: WorldState, factionId: FactionId, settlementId: string): BuildOption[] {
  const s = w.settlements[settlementId];
  const f = w.factions[factionId];
  if (!s || !f) return buildOptions(w, factionId, settlementId);
  let key = `${settlementId}|${factionId}|${Math.floor(w.calendar.totalHours / 24)}|${s.ownerFactionId}|${s.kind}|${s.radius}|${f.age}|${f.treasury}|${f.materials.timber}|${f.materials.stone}`;
  for (const b of s.buildings) key += `|${b.type}:${b.level}@${b.cell ? `${b.cell[0]},${b.cell[1]}` : ''}r${b.rot ?? ''}`;
  for (const j of s.construction) key += `|+${j.type}:${j.targetLevel}${j.landmarkId ?? ''}@${j.cell ? `${j.cell[0]},${j.cell[1]}` : ''}r${j.rot ?? ''}`;
  const hit = buildOptsCache.get(w);
  if (hit && hit.key === key) return hit.opts;
  const opts = buildOptions(w, factionId, settlementId);
  buildOptsCache.set(w, { key, opts });
  return opts;
}

/** Settlement command card. Player-owned settlements get the five tabs; others show an empty, explained card. */
export function settlementCard(world: Readonly<WorldState>, settlementId: string, tab: string, ctx: CardContext): CardModel {
  const w = world as WorldState;
  const s = w.settlements[settlementId];
  const factionId = w.playerFactionId;
  const tabId = SETTLEMENT_TABS.some((t) => t.id === tab) ? tab : 'economy';
  const model: CardModel = { kind: 'settlement', title: s?.name ?? 'Settlement', subtitle: s ? labelOf(s.kind) : '', tabs: [], tab: tabId, slots: emptySlots() };
  if (!s) return model;
  const mine = s.ownerFactionId === factionId;
  const scope: BindingScope = { context: 'world' };
  model.tabs = SETTLEMENT_TABS.map((t) => ({ id: t.id, label: t.label, icon: t.icon, badge: t.id === 'recruit' ? s.recruitment.reduce((n, r) => n + r.formations, 0) || null : null }));
  if (!mine) {
    model.tabs = [];
    return model;
  }
  if (tabId === 'recruit') {
    const opts = recruitOptions(w, factionId, settlementId);
    for (const cls of UNIT_CLASSES) {
      const def = UNITS[cls];
      const slot = def.commandSlot;
      if (slot === undefined || slot < 0 || slot >= CARD_SLOTS) continue;
      const o = opts.find((x) => x.unitClass === cls);
      const queued = s.recruitment.filter((r) => r.unitClass === cls);
      const sl = base(slot, `recruit:${cls}`, SHORT_UNIT[cls], def.name, `unit-${cls.replace(/_/g, '-')}`, slotKey(ctx, scope, slot), {
        kind: 'strategic',
        cmd: { kind: 'recruit', settlementId, unitClass: cls, formations: 1, targetArmyId: null },
      });
      sl.enabled = !o?.reason;
      sl.reason = o?.reason ?? null;
      sl.badge = queued.length ? String(queued.reduce((n, r) => n + r.formations, 0)) : null;
      sl.progress = queued[0]?.progress ?? null;
      sl.description = `${def.role}. ${def.constraint}`;
      if (o) {
        const f = w.factions[factionId];
        sl.cost = [
          { label: 'Wealth', value: fmtInt(o.cost.wealth), short: (f?.treasury ?? 0) < o.cost.wealth },
          { label: 'Grain', value: fmtInt(o.cost.grain) },
          { label: 'Recruits', value: fmtInt(o.cost.recruits), short: s.recruitPool < o.cost.recruits },
          { label: 'Days', value: String(Math.round(o.cost.days)) },
        ];
      }
      model.slots[slot] = sl;
    }
    // Rally point for this settlement's recruits.
    const rp = base(14, 'rally_point', 'Rally', 'Set rally point', 'a_rally_point', slotKey(ctx, scope, 14), { kind: 'hud', cmd: { kind: 'rally_point_target', settlementId } });
    rp.description = 'Choose where new recruits gather: a point on the map or one of your armies.';
    rp.active = !!s.rallyPoint;
    model.slots[14] = rp;
    return model;
  }
  const opts = cachedBuildOptions(w, factionId, settlementId);
  const f = w.factions[factionId];
  for (const b of BUILDING_TYPES) {
    const def = BUILDINGS[b];
    if ((def.category ?? 'economy') !== tabId || def.commandSlot === undefined) continue;
    const slot = def.commandSlot;
    if (slot < 0 || slot >= CARD_SLOTS || model.slots[slot]) continue;
    const o = opts.find((x) => x.building === b);
    const have = s.buildings.find((x) => x.type === b);
    const job = s.construction.find((j) => j.type === b && !j.landmarkId);
    const perimeter = def.footprint?.placement === 'perimeter';
    const upgrade = !!o?.upgrade || !!have;
    const command: CardCommand = upgrade || perimeter ? { kind: 'strategic', cmd: { kind: 'build', settlementId, building: b } } : { kind: 'hud', cmd: { kind: 'place_building', settlementId, building: b, repeat: false } };
    const sl = base(slot, `build:${b}`, SHORT_BUILDING[b] ?? def.name, upgrade ? `Upgrade ${def.name} to level ${o?.targetLevel ?? (have?.level ?? 0) + 1}` : def.name, buildingIcon(b), slotKey(ctx, scope, slot), command);
    sl.enabled = !o?.reason;
    sl.reason = o?.reason ?? null;
    sl.badge = have ? `L${have.level}` : null;
    sl.progress = job ? job.progress : null;
    sl.description = def.description;
    if (o) {
      sl.cost = [
        { label: 'Wealth', value: fmtInt(o.cost.wealth), short: (f?.treasury ?? 0) < o.cost.wealth },
        { label: 'Timber', value: fmtInt(o.cost.timber), short: (f?.materials.timber ?? 0) < o.cost.timber },
        { label: 'Stone', value: fmtInt(o.cost.stone), short: (f?.materials.stone ?? 0) < o.cost.stone },
        { label: 'Labor', value: `${fmtInt(o.cost.labor)} person-days` },
        { label: 'Days', value: String(Math.round(o.days)) },
      ];
    }
    model.slots[slot] = sl;
  }
  // Fixed utility slots on the bottom row.
  if (tabId === 'economy') {
    const mk = base(14, 'screen:market', 'Trade', 'Buy and sell grain, timber and stone at the market', 'coins', slotKey(ctx, scope, 14), { kind: 'screen', screen: 'market' });
    mk.description = 'Buy and sell grain, timber and stone in lots of 100.';
    model.slots[14] = mk;
    const ec = base(13, 'screen:economy', 'Treasury', 'Treasury and granaries', 'economy', slotKey(ctx, scope, 13), { kind: 'screen', screen: 'economy_panel' });
    ec.description = 'Ledger, projection, tax policy, the royal reserve and rationing.';
    model.slots[13] = ec;
  } else if (tabId === 'civic') {
    const ag = base(14, 'screen:ages', 'Ages', 'Ages and landmarks', 'ages', slotKey(ctx, scope, 14), { kind: 'screen', screen: 'age_panel' });
    ag.description = 'Advance your realm by raising a landmark of the next age.';
    model.slots[14] = ag;
    const vi = base(13, 'visit', 'Visit', `Walk the streets of ${s.name}`, 'a_visit', slotKey(ctx, scope, 13), { kind: 'visit', settlementId });
    vi.description = 'Hero mode: walk the settlement as it is now. The world clock waits.';
    model.slots[13] = vi;
  }
  return model;
}

// ---------------------------------------------------------------------------------------------------
// Army
// ---------------------------------------------------------------------------------------------------

function nearOwnSettlement(world: WorldState, a: ArmyState): string | null {
  let best: string | null = null;
  let bestD = Infinity;
  for (const id of Object.keys(world.settlements).sort()) {
    const s = world.settlements[id]!;
    if (s.ownerFactionId !== a.factionId) continue;
    const d = Math.hypot(s.x - a.x, s.z - a.z);
    if (d < s.radius * 1.6 && d < bestD) ((bestD = d), (best = id));
  }
  return best;
}

/** Army orders card (one tab). Targeted orders hand over to the scene (HUD command 'army_target'). */
export function armyCard(world: Readonly<WorldState>, armyId: string, ctx: CardContext): CardModel {
  const w = world as WorldState;
  const a = w.armies[armyId];
  const model: CardModel = { kind: 'army', title: a?.name ?? 'Army', subtitle: a ? labelOf(a.status) : '', tabs: [{ id: 'orders', label: 'Orders', icon: 'flag', badge: null }], tab: 'orders', slots: emptySlots() };
  if (!a) return model;
  const mine = a.factionId === w.playerFactionId;
  const scope: BindingScope = { context: 'world' };
  const fid = w.playerFactionId;
  const notMine = mine ? null : 'Not your army';
  const busy = a.status === 'in_battle' ? 'The army is in battle' : a.status === 'routed' ? 'The army is routed' : null;
  const target = (slot: number, order: ArmyTargetOrder, labelText: string, name: string, iconId: string, desc: string): void => {
    const sl = base(slot, `army:${order}`, labelText, name, iconId, slotKey(ctx, scope, slot), { kind: 'hud', cmd: { kind: 'army_target', armyIds: [armyId], order } });
    sl.reason = notMine ?? busy;
    sl.enabled = !sl.reason;
    sl.description = desc;
    sl.active = a.order.kind === order || (order === 'move' && a.order.kind === 'move');
    model.slots[slot] = sl;
  };
  const direct = (slot: number, id: string, labelText: string, name: string, iconId: string, cmd: StrategicCommand, desc: string, active = false): CardSlot => {
    const sl = base(slot, id, labelText, name, iconId, slotKey(ctx, scope, slot), { kind: 'strategic', cmd });
    sl.reason = notMine ?? busy ?? (mine ? commandReason(w, fid, cmd) : null);
    sl.enabled = !sl.reason;
    sl.description = desc;
    sl.active = active;
    model.slots[slot] = sl;
    return sl;
  };
  target(0, 'move', 'Move', 'March to...', 'a_move', 'March along the roads to a point. Right-click / long-press the map does the same.');
  target(1, 'attack', 'Attack', 'Attack an army', 'a_attack', 'Seek out and engage an enemy army.');
  if (a.status === 'besieging' && a.order.kind === 'besiege') {
    const sid = a.order.settlementId;
    direct(2, 'army:assault', 'Assault', 'Storm the walls', 'a_assault', { kind: 'army_order', armyId, order: { kind: 'assault', settlementId: sid } }, 'Assault once the walls are breached (50%) or the ladders are ready - a siege battle.');
  } else target(2, 'besiege', 'Besiege', 'Besiege a settlement', 'a_besiege', 'Surround a settlement: its walls crumble and its stores run down.');
  target(3, 'garrison', 'Garrison', 'Garrison a settlement', 'a_garrison', 'Enter one of your towns: the host joins its defence and eats from its store.');
  target(4, 'raid', 'Raid', 'Raid a settlement', 'a_raid', 'Plunder an enemy settlement\'s fields and stores.');
  direct(5, 'army:forage', 'Forage', 'Forage', 'a_forage', { kind: 'army_order', armyId, order: { kind: 'forage' } }, 'Live off the land around the camp. Angers the villages.', a.order.kind === 'forage');
  target(6, 'retreat', 'Retreat', 'Retreat to...', 'a_retreat', 'Fall back to a point, avoiding contact.');
  for (const [slot, st, lbl, ic] of [
    [7, 'aggressive', 'Bold', 'a_stance_aggressive'],
    [8, 'balanced', 'Steady', 'a_stance_balanced'],
    [9, 'cautious', 'Wary', 'a_stance_cautious'],
  ] as const) {
    const sl = direct(slot, `stance:${st}`, lbl, `Stance: ${st}`, ic, { kind: 'set_army_stance', armyId, stance: st }, st === 'aggressive' ? 'Seek battle; the generals fight harder when left to decide.' : st === 'balanced' ? 'Fight when the odds are fair.' : 'Avoid battle unless cornered.', a.stance === st);
    if (a.stance === st) ((sl.enabled = false), (sl.reason = sl.reason ?? 'Current stance'));
  }
  const fm = direct(10, 'army:forced_march', 'Forced', a.forcedMarch ? 'End forced march' : 'Forced march', 'a_forced_march', { kind: 'forced_march', armyId, on: !a.forcedMarch }, 'x1.3 speed, +0.1 fatigue a day and 0.2% attrition a day.', a.forcedMarch);
  fm.label = a.forcedMarch ? 'Forced on' : 'Forced';
  const half = a.units.slice(Math.ceil(a.units.length / 2)).map((u) => u.id);
  const sp = direct(11, 'army:split', 'Split', 'Split the host', 'a_split', { kind: 'split_army', armyId, unitIds: half }, 'The second half of the units march off as a new army.');
  if (a.units.length < 2 && !sp.reason) ((sp.enabled = false), (sp.reason = 'Needs at least two units'));
  target(12, 'merge', 'Merge', 'Merge with an army', 'a_merge', 'Join another of your armies nearby.');
  const db = direct(13, 'army:disband', 'Disband', 'Disband the army', 'a_disband', { kind: 'disband_army', armyId }, 'Send the soldiers home. Their recruits return to the pool.');
  db.confirm = true;
  const town = nearOwnSettlement(w, a);
  const vi = base(14, 'army:visit', 'Visit', town ? `Walk ${w.settlements[town]!.name}` : 'Visit (hero)', 'a_visit', slotKey(ctx, scope, 14), town ? { kind: 'visit', settlementId: town } : { kind: 'none' });
  vi.reason = notMine ?? (town ? null : 'March into one of your towns to walk its streets');
  vi.enabled = !vi.reason;
  vi.description = 'Hero mode: the commander walks the streets. The world clock waits.';
  model.slots[14] = vi;
  return model;
}

// ---------------------------------------------------------------------------------------------------
// Battle
// ---------------------------------------------------------------------------------------------------

export const BATTLE_PAGES: readonly { id: string; label: string; icon: string }[] = [
  { id: 'orders', label: 'Orders', icon: 'o_attack' },
  { id: 'shapes', label: 'Shapes', icon: 's_wedge' },
  { id: 'intents', label: 'Intents', icon: 'i_hold_high_ground' },
];

export interface OrderDef {
  action: InputAction;
  label: string;
  name: string;
  icon: string;
  desc: string;
}

/** Orders page (Grid letters Q..G; Z..B shapes) - DESIGN_SPEC §8.8. */
export const BATTLE_ORDER_SLOTS: readonly (OrderDef | null)[] = [
  { action: 'order_hold', label: 'Hold', name: 'Hold', icon: 'o_hold', desc: 'Stop and keep facing; fight what comes.' },
  { action: 'order_advance', label: 'Advance', name: 'Advance', icon: 'o_advance', desc: 'Walk 30 m forward along the facing, keeping the line.' },
  { action: 'order_attack', label: 'Attack', name: 'Attack', icon: 'o_attack', desc: 'Choose an enemy formation to attack (archers shoot from range).' },
  { action: 'order_charge', label: 'Charge', name: 'Charge', icon: 'o_charge', desc: 'Run the last 40 m (horse and elephants 90 m) for a charge impact.' },
  { action: 'order_flank', label: 'Flank', name: 'Flank', icon: 'o_flank', desc: 'Run around the target\'s flank and strike it there.' },
  { action: 'order_defend', label: 'Defend', name: 'Defend', icon: 'o_defend', desc: 'Hold an area: engage what enters it, return when it leaves.' },
  { action: 'order_withdraw', label: 'Withdraw', name: 'Withdraw', icon: 'o_withdraw', desc: 'Back away facing the enemy, then turn and walk. Not a rout.' },
  { action: 'order_regroup', label: 'Regroup', name: 'Regroup', icon: 'o_regroup', desc: 'Stop and dress the ranks: cohesion recovers fast.' },
  { action: 'order_run_toggle', label: 'Run', name: 'Run / march', icon: 'o_run', desc: 'Toggle running for move orders (tires the men).' },
  { action: 'order_stance', label: 'Stance', name: 'Cycle stance', icon: 'o_stance', desc: 'Aggressive, defensive, skirmish, hold fire.' },
  { action: 'shape_line', label: 'Line', name: 'Line', icon: 's_line', desc: 'Wide front: the most men fighting.' },
  { action: 'shape_column', label: 'Column', name: 'Column', icon: 's_column', desc: 'Narrow and fast on roads and fords.' },
  { action: 'shape_square', label: 'Square', name: 'Square', icon: 's_square', desc: 'No flanks to turn: hold against horse.' },
  { action: 'shape_wedge', label: 'Wedge', name: 'Wedge', icon: 's_wedge', desc: 'A spearhead for the charge.' },
  { action: 'shape_loose', label: 'Loose', name: 'Loose', icon: 's_loose', desc: 'Spread out: fewer losses to arrows.' },
];

const SHAPE_OF: Partial<Record<InputAction, FormationShape>> = { shape_line: 'line', shape_column: 'column', shape_square: 'square', shape_wedge: 'wedge', shape_loose: 'loose', shape_circle: 'circle' };

export const INTENT_DEFS: readonly { intent: IntentOrderType; label: string; name: string; icon: string; desc: string; needsTarget: boolean }[] = [
  { intent: 'hold_crossing', label: 'Crossing', name: 'Hold the crossing', icon: 'i_hold_crossing', desc: 'Spears across the ford, archers behind, horse in reserve. Never pursue past the far bank.', needsTarget: true },
  { intent: 'protect_formation', label: 'Protect', name: 'Protect a formation', icon: 'i_protect_formation', desc: 'Stay between a friendly formation and the nearest threat; intercept attackers.', needsTarget: true },
  { intent: 'hold_high_ground', label: 'Heights', name: 'Hold the high ground', icon: 'i_hold_high_ground', desc: 'Take the highest ground nearby and hold it; archers gain range.', needsTarget: true },
  { intent: 'pin_enemy', label: 'Pin', name: 'Pin the enemy', icon: 'i_pin_enemy', desc: 'Close to 60 m and hold its attention while others flank.', needsTarget: true },
  { intent: 'screen_flank', label: 'Screen', name: 'Screen a flank', icon: 'i_screen_flank', desc: 'Guard a friendly formation\'s flank against horse.', needsTarget: true },
  { intent: 'pursue_routers', label: 'Pursue', name: 'Pursue the routed', icon: 'i_pursue_routers', desc: 'Horse and scouts ride down fleeing enemies; never engage a steady line.', needsTarget: false },
  { intent: 'scout_area', label: 'Scout', name: 'Scout an area', icon: 'i_scout_area', desc: 'Ride to an area, reveal it and keep 100 m from any enemy.', needsTarget: true },
  { intent: 'escort_supply', label: 'Escort', name: 'Escort the supply', icon: 'i_escort_supply', desc: 'Follow the carts on the enemy side and drive off attackers.', needsTarget: true },
];

const STANCE_DEFS: readonly { stance: Stance; label: string; icon: string; desc: string }[] = [
  { stance: 'aggressive', label: 'Aggressive', icon: 'a_stance_aggressive', desc: 'Engage enemies within 30 m without orders; pursue 60 m.' },
  { stance: 'defensive', label: 'Defensive', icon: 'a_stance_cautious', desc: 'Fight only when contacted; turn to face.' },
  { stance: 'skirmish', label: 'Skirmish', icon: 'o_withdraw', desc: 'Avoid melee: step back when enemies close in.' },
  { stance: 'hold_fire', label: 'Hold fire', icon: 'a_cancel', desc: 'Do not shoot (ambush, friendly fire).' },
];

function selectedFormations(battle: Readonly<BattleState>, side: SideIndex, selection: readonly FormationIndex[]) {
  return selection.map((i) => battle.formations[i]).filter((f): f is NonNullable<typeof f> => !!f && f.side === side && f.soldiers > 0 && f.activity !== 'surrendered' && f.activity !== 'destroyed');
}

/** Battle command card: page 'orders' | 'shapes' | 'intents'. */
export function battleCard(battle: Readonly<BattleState>, side: SideIndex, selection: readonly FormationIndex[], page: string, ctx: CardContext): CardModel {
  const pageIdx = Math.max(0, BATTLE_PAGES.findIndex((p) => p.id === page));
  const pageId = BATTLE_PAGES[pageIdx]!.id;
  const sel = selectedFormations(battle, side, selection);
  const model: CardModel = {
    kind: 'battle',
    title: sel.length === 0 ? 'No formation selected' : sel.length === 1 ? sel[0]!.name : `${sel.length} formations`,
    subtitle: sel.length === 1 ? UNITS[sel[0]!.unitClass].name : sel.length > 1 ? `${fmtInt(sel.reduce((n, f) => n + f.soldiers, 0))} soldiers` : 'Tap a card or a formation',
    tabs: BATTLE_PAGES.map((p) => ({ id: p.id, label: p.label, icon: p.icon, badge: null })),
    tab: pageId,
    slots: emptySlots(),
  };
  const none = sel.length === 0 ? 'Select formations first' : null;
  const ended = battle.outcome ? 'The battle is over' : null;
  const routing = sel.length > 0 && sel.every((f) => f.activity === 'routing' || f.rallyingUntil > battle.time) ? 'They are fleeing - rally them first' : null;
  const scope0: BindingScope = { context: 'battle', page: 0 };
  const scopeN: BindingScope = { context: 'battle', page: pageIdx };
  if (pageId === 'orders') {
    BATTLE_ORDER_SLOTS.forEach((d, i) => {
      if (!d) return;
      const sl = base(i, `order:${d.action}`, d.label, d.name, d.icon, hotkeyLabel(ctx.preset, scope0, d.action, ctx.overrides) || slotKey(ctx, scope0, i), { kind: 'input', action: d.action });
      sl.description = d.desc;
      let reason = ended ?? none ?? (d.action.startsWith('shape_') ? null : routing);
      if (!reason && d.action === 'order_charge' && sel.every((f) => !canCharge(f))) reason = 'Too exhausted to charge';
      if (!reason && d.action.startsWith('shape_')) {
        const shape = SHAPE_OF[d.action]!;
        if (sel.every((f) => !UNITS[f.unitClass].allowedShapes.includes(shape))) reason = `${labelOf(shape)} is not a shape these troops can take`;
        sl.active = sel.length > 0 && sel.every((f) => f.shape === shape);
      }
      if (d.action === 'order_stance' && sel.length > 0) {
        const st = sel[0]!.stance;
        sl.label = labelOf(st);
        sl.name = `Stance: ${labelOf(st)} (cycle)`;
      }
      sl.reason = reason;
      sl.enabled = !reason;
      model.slots[i] = sl;
    });
    return model;
  }
  if (pageId === 'shapes') {
    const shapes: InputAction[] = ['shape_line', 'shape_column', 'shape_square', 'shape_wedge', 'shape_loose', 'shape_circle'];
    shapes.forEach((a, i) => {
      const slot = i < 5 ? i : 5;
      const shape = SHAPE_OF[a]!;
      const def = BATTLE_ORDER_SLOTS.find((d) => d?.action === a);
      const named = hotkeyLabel(ctx.preset, scope0, a, ctx.overrides);
      const sl = base(slot, `shape:${shape}`, labelOf(shape), labelOf(shape), def?.icon ?? 's_circle', ctx.preset === 'grid' ? slotKey(ctx, scopeN, slot) : named || slotKey(ctx, scopeN, slot), { kind: 'input', action: a });
      sl.description = def?.desc ?? 'A ring facing outward: no rear to attack.';
      const reason = ended ?? none ?? (sel.every((f) => !UNITS[f.unitClass].allowedShapes.includes(shape)) ? `${labelOf(shape)} is not a shape these troops can take` : null);
      sl.reason = reason;
      sl.enabled = !reason;
      sl.active = sel.length > 0 && sel.every((f) => f.shape === shape);
      model.slots[slot] = sl;
    });
    STANCE_DEFS.forEach((d, i) => {
      const slot = 10 + i;
      const formations = sel.map((f) => f.index);
      const sl = base(slot, `stance:${d.stance}`, d.label, `Stance: ${d.label}`, d.icon, slotKey(ctx, scopeN, slot), { kind: 'battle', cmd: { kind: 'set_stance', formations, stance: d.stance } });
      sl.description = d.desc;
      const reason = ended ?? none;
      sl.reason = reason;
      sl.enabled = !reason;
      sl.active = sel.length > 0 && sel.every((f) => f.stance === d.stance);
      model.slots[slot] = sl;
    });
    return model;
  }
  // Intents
  const formations = sel.map((f) => f.index);
  const own = battle.formations.filter((f) => f.side === side && f.soldiers > 0);
  INTENT_DEFS.forEach((d, i) => {
    const command: CardCommand = d.needsTarget ? { kind: 'hud', cmd: { kind: 'battle_target', formations, intent: d.intent } } : { kind: 'battle', cmd: { kind: 'intent', formations, intent: { type: 'pursue_routers' } } };
    const sl = base(i, `intent:${d.intent}`, d.label, d.name, d.icon, slotKey(ctx, scopeN, i), command);
    sl.description = d.desc;
    let reason = ended ?? none ?? routing;
    if (!reason && d.intent === 'pursue_routers' && !sel.some((f) => isMounted(f.unitClass) || f.unitClass === 'scouts')) reason = 'Only horse, chariots and scouts pursue';
    if (!reason && d.intent === 'escort_supply' && !own.some((f) => f.unitClass === 'supply_train')) reason = 'No supply train on the field';
    sl.reason = reason;
    sl.enabled = !reason;
    sl.active = sel.length > 0 && sel.every((f) => f.intent?.type === d.intent);
    model.slots[i] = sl;
  });
  const clr = base(9, 'intent:clear', 'Clear', 'Clear the intent', 'i_clear', slotKey(ctx, scopeN, 9), { kind: 'battle', cmd: { kind: 'clear_intent', formations } });
  clr.description = 'Back to direct orders.';
  clr.reason = ended ?? none ?? (sel.some((f) => f.intent) ? null : 'No intent to clear');
  clr.enabled = !clr.reason;
  model.slots[9] = clr;
  return model;
}

/** Next battle page id after `page` (Tab). */
export function nextBattlePage(page: string): string {
  const i = BATTLE_PAGES.findIndex((p) => p.id === page);
  return BATTLE_PAGES[(i + 1) % BATTLE_PAGES.length]!.id;
}

/** Index of a battle page id (InputManager.setCardPage). */
export function battlePageIndex(page: string): number {
  return Math.max(0, BATTLE_PAGES.findIndex((p) => p.id === page));
}

/** Next settlement tab after `tab` (Tab key). */
export function nextSettlementTab(tab: string): string {
  const i = SETTLEMENT_TABS.findIndex((t) => t.id === tab);
  return SETTLEMENT_TABS[(i + 1) % SETTLEMENT_TABS.length]!.id;
}

/** Slot of the card answering a card_slot_N input action (or null). */
export function slotForAction(model: CardModel, action: InputAction): CardSlot | null {
  const i = CARD_SLOT_ACTIONS.indexOf(action);
  return i >= 0 ? (model.slots[i] ?? null) : null;
}

export type { FactionId };
