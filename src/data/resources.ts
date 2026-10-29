/**
 * Strategic resources as shown to the player (DESIGN_SPEC §8.1): the Age of Empires presentation of the
 * GDD §6 settlement economy. OWNER: Creative Director (content); icons are painted procedurally by the UI.
 *
 * 1 grain measure = rations for 10 person-days (a civilian eats 0.1/day). Wealth is silver coin.
 * Timber and stone are faction stockpiles (requested state: FactionState.materials, see the spec handoff).
 */
import type { EconomyResource, ResourceDisplayDef, ResourceKind } from '../core/types';

export const RESOURCE_DISPLAY: Readonly<Record<EconomyResource, ResourceDisplayDef>> = {
  grain: { id: 'grain', name: 'Grain', aoeAnalogue: 'Food', icon: 'sheaf', color: '#e3b341', source: 'sum(settlement.foodStored) + faction.foodReserve', description: 'Rice, millet, wheat and pulses in granaries. Feeds people and armies; shortages raise prices and unrest.', unit: 'measures' },
  timber: { id: 'timber', name: 'Timber', aoeAnalogue: 'Wood', icon: 'logs', color: '#9a6b3c', source: 'faction.materials.timber (requested)', description: 'Sal and teak from the forest edge. Needed for granaries, barracks, carts, boats and palisades.', unit: 'loads' },
  stone: { id: 'stone', name: 'Stone', aoeAnalogue: 'Stone', icon: 'block', color: '#a8a39a', source: 'faction.materials.stone (requested)', description: 'Sandstone and granite from hill quarries. Walls, temples, ghats, stepwells and landmarks.', unit: 'blocks' },
  wealth: { id: 'wealth', name: 'Wealth', aoeAnalogue: 'Gold', icon: 'coins', color: '#f2cf63', source: 'faction.treasury', description: 'Punch-marked silver from taxes, tolls and trade. Pays soldiers, officials and builders.', unit: 'coins' },
  labor: { id: 'labor', name: 'Labor', aoeAnalogue: 'Villagers', icon: 'villager', color: '#d98c5f', source: 'settlement.labor x settlement.laborAllocation', description: 'Working hands: farmers, builders, crafters and militia. Assign them per settlement.', unit: 'workers' },
  manpower: { id: 'manpower', name: 'Recruits', aoeAnalogue: 'Population cap', icon: 'spear', color: '#c0504d', source: 'sum(settlement.recruitPool)', description: 'Men the realm can raise without emptying the fields. Refills slowly; famine and unrest dry it up.', unit: 'men' },
};

/** Which economy resource each settlement resource feeds (strategic map resource icons). */
export const RESOURCE_KIND_FEEDS: Readonly<Record<ResourceKind, { feeds: EconomyResource | 'trade' | 'recruits'; label: string }>> = {
  grain: { feeds: 'grain', label: 'Wheat and millet fields' },
  rice: { feeds: 'grain', label: 'Rice paddies' },
  cotton: { feeds: 'trade', label: 'Cotton: cloth for trade' },
  timber: { feeds: 'timber', label: 'Sal and teak forest' },
  iron: { feeds: 'stone', label: 'Iron ore: quarry + equipment' },
  copper: { feeds: 'stone', label: 'Copper: quarry + coin' },
  salt: { feeds: 'trade', label: 'Salt pans: caravan trade' },
  horses: { feeds: 'recruits', label: 'Horse herds: cheaper horsemen and scouts' },
  elephants: { feeds: 'recruits', label: 'Elephant forest: enables war elephants' },
  spices: { feeds: 'trade', label: 'Pepper and cardamom: river trade' },
  gems: { feeds: 'wealth', label: 'Gem workings: wealth' },
  stone: { feeds: 'stone', label: 'Sandstone quarry' },
};

/** HUD order of the resource bar (AoE: food, wood, stone, gold, then population). */
export const RESOURCE_BAR_ORDER: readonly EconomyResource[] = ['grain', 'timber', 'stone', 'wealth', 'labor', 'manpower'];
