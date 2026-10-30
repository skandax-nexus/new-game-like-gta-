/**
 * HUD -> scene command channel and scene -> HUD feeds that ScreenPropsMap does not carry. OWNER: UI Engineer -
 * In-game HUD, Command Card, Minimap & Input (UI-02). Public API for GP-03 (world) and GP-04 (battle).
 *
 * Commands (`ctx.ui.commands.on(kind, fn)`): what the command card, minimap and panels ask of the active scene when
 * the scene must finish the job (pick a spot on the map, run the placement ghost). Everything the UI can finish
 * alone goes straight to GameActions (issueStrategic / issueBattle) or to input actions (ctx.input.injectAction)
 * so keyboard, touch and HUD share one path:
 *   place_building      start the AoE placement ghost for a building (GP-03: ghost follows the cursor, Shift repeats)
 *   place_landmark      start placing an age landmark at a settlement (age panel "Choose site")
 *   placement           touch tick / cross / rotate buttons of build_placement
 *   army_target         army order that needs a target on the map (move, attack, besiege, garrison, raid, retreat,
 *                       patrol, merge, resupply, assault) - the scene enters targeting mode (input mode 'targeting')
 *   rally_point_target  pick the rally point of a settlement's recruits
 *   battle_target       battle intent that needs a point / formation (hold_crossing, protect_formation, ...)
 *   minimap_move        right-click on the minimap: move the selected armies / formations to (x, z)
 * Bus events already in the contract are used where they fit: 'ui:camera_focus' (minimap click, notification click),
 * 'ui:world_select', 'ui:select_formations', 'ui:overlay'.
 *
 * Feeds (`ctx.ui.feeds`): the camera frustum quad + heading for the minimap (GFX-05 / scenes, ~4-10 Hz), world control groups
 * (GP-03 owns the army groups) and battle control groups (GP-04: `setBattleGroups`; until it pushes them the battle
 * HUD derives the row from BattleState.sides[playerSide].groups).
 */
import { EventBus } from '../../core/events';
import type { ArmyId, BuildingType, FormationIndex, IntentOrderType, SettlementId } from '../../core/types';

export type ArmyTargetOrder = 'move' | 'attack' | 'besiege' | 'garrison' | 'raid' | 'retreat' | 'patrol' | 'merge' | 'resupply' | 'assault' | 'escort';

export interface HudCommandMap {
  place_building: { settlementId: SettlementId; building: BuildingType; repeat: boolean };
  place_landmark: { settlementId: SettlementId | null; landmarkId: string };
  placement: { action: 'confirm' | 'cancel' | 'rotate' };
  army_target: { armyIds: readonly ArmyId[]; order: ArmyTargetOrder };
  rally_point_target: { settlementId: SettlementId };
  battle_target: { formations: readonly FormationIndex[]; intent: IntentOrderType };
  minimap_move: { x: number; z: number };
}
export type HudCommandKind = keyof HudCommandMap;
export type HudCommand = { [K in HudCommandKind]: { kind: K } & HudCommandMap[K] }[HudCommandKind];

export type HudCommandBus = EventBus<HudCommandMap>;

export function createHudCommandBus(): HudCommandBus {
  return new EventBus<HudCommandMap>();
}

/** Emit a HudCommand union value on the bus. */
export function emitHud(bus: HudCommandBus, cmd: HudCommand): void {
  const { kind, ...payload } = cmd;
  (bus.emit as (k: HudCommandKind, p: unknown) => void)(kind, payload);
}

/** World-space camera footprint on the ground (x, z corners, any winding) for the minimap frustum. */
export type GroundQuad = readonly [readonly [number, number], readonly [number, number], readonly [number, number], readonly [number, number]];

export interface WorldControlGroup {
  group: number;
  /** Short label (army name or "3 armies"). */
  label: string;
  count: number;
}

/** One control group of the battle HUD row (group 1..9, 0; label = formation title or "3 formations"). */
export type BattleControlGroup = WorldControlGroup;

/** Scene -> HUD data that is not part of ScreenPropsMap (all optional; the HUD degrades gracefully). */
export class HudFeeds {
  /** Camera footprint on the ground (minimap frustum quad). */
  cameraQuad: GroundQuad | null = null;
  /**
   * Direction the camera looks (facing convention: forward = (sin h, cos h)); the rotating minimap turns it up.
   * Default PI = looking north. For the RTS camera (camera placed at focus + (sin yaw, cos yaw) x d): heading = yaw + PI.
   */
  cameraHeading = Math.PI;
  cameraVersion = 0;
  worldGroups: readonly WorldControlGroup[] = [];
  /** Battle groups pushed by the scene; null = derive them from the battle state. */
  battleGroups: readonly BattleControlGroup[] | null = null;
  groupsVersion = 0;

  setCamera(quad: GroundQuad | null, heading: number): void {
    this.cameraQuad = quad;
    this.cameraHeading = heading;
    this.cameraVersion++;
  }

  setWorldGroups(groups: readonly WorldControlGroup[]): void {
    this.worldGroups = groups;
    this.groupsVersion++;
  }

  /** Battle control groups (GP-04, whenever an assignment changes); null hands the row back to the battle state. */
  setBattleGroups(groups: readonly BattleControlGroup[] | null): void {
    this.battleGroups = groups;
    this.groupsVersion++;
  }

  reset(): void {
    this.cameraQuad = null;
    this.cameraHeading = Math.PI;
    this.worldGroups = [];
    this.battleGroups = null;
    this.cameraVersion++;
    this.groupsVersion++;
  }
}
