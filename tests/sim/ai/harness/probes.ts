/**
 * Named battle probes for tuning (SIM-02). OWNER: AI Engineer - Battle AI, Intents & Campaign AI (SIM-02).
 */
import type { BattleSpec, ArmyRow } from './battles';
import { armyCost, armyOfCost } from './battles';
import { composeArmy } from '../../../../src/sim/tactical/setup';

const SUVARNA = composeArmy(500, 'heartland', 'balanced');
const GIRI_EQ = armyOfCost('highland', armyCost(SUVARNA), 'balanced');

const SP = (n = 120): ArmyRow[number] => ({ unitClass: 'spearmen', soldiers: n });
const K: [string, string] = ['citystates', 'citystates'];

export const PROBES: Record<string, (seed: number) => BattleSpec> = {
  pace: (seed) => ({ seed, factions: ['heartland', 'highland'], compositions: ['balanced', 'balanced'], resolution: 513 }),
  pace65: (seed) => ({ seed, factions: ['heartland', 'highland'], compositions: ['balanced', 'balanced'] }),
  fortress: (seed) => ({ seed, factions: ['highland', 'citystates'], compositions: ['fortress', 'fortress'], resolution: 513 }),
  kota: (seed) => ({ seed, factions: K, compositions: ['balanced', 'balanced'] }),
  horse: (seed) => ({ seed, factions: K, armies: [[SP(), SP(), SP()], [{ unitClass: 'cavalry', soldiers: 60 }, { unitClass: 'cavalry', soldiers: 30 }]], script: { side: 1, kind: 'frontal_charge' } }),
  horseai: (seed) => ({ seed, factions: K, armies: [[SP(), SP(), SP()], [{ unitClass: 'cavalry', soldiers: 60 }, { unitClass: 'cavalry', soldiers: 30 }]] }),
  horsearch: (seed) => ({ seed, factions: K, armies: [[SP(), { unitClass: 'archers', soldiers: 100 }, { unitClass: 'archers', soldiers: 100 }], [{ unitClass: 'cavalry', soldiers: 60 }, { unitClass: 'cavalry', soldiers: 30 }]] }),
  mixed: (seed) => ({ seed, factions: K, armies: [[SP(), SP(), SP(), SP(), { unitClass: 'archers', soldiers: 100 }, { unitClass: 'archers', soldiers: 100 }], [SP(), SP(), SP(), SP(), SP(), SP()]] }),
  elehorse: (seed) => ({ seed, factions: K, armies: [[{ unitClass: 'war_elephants', soldiers: 8 }], [{ unitClass: 'cavalry', soldiers: 60 }, { unitClass: 'cavalry', soldiers: 60 }]] }),
  elearch: (seed) => ({ seed, factions: K, armies: [[{ unitClass: 'war_elephants', soldiers: 8 }], [0, 1, 2, 3].map(() => ({ unitClass: 'archers' as const, soldiers: 100, shape: 'loose' as const }))] }),
  hill: (seed) => ({ seed, factions: ['heartland', 'highland'], armies: [SUVARNA, GIRI_EQ], hill: 15, hillSide: 1 }),
  hillflat: (seed) => ({ seed, factions: ['heartland', 'highland'], armies: [SUVARNA, GIRI_EQ] }),
  cmdbase: (seed) => ({ seed, factions: K, compositions: ['balanced', 'balanced'] }),
  cmdkill: (seed) => ({ seed, factions: K, compositions: ['balanced', 'balanced'], script: { side: 0, kind: 'kill_commander', atSec: 120 } }),
  guards: (seed) => ({ seed, factions: K, armies: [[{ unitClass: 'elite_guards', soldiers: 60 }], [SP(), SP(), SP(60)]] }),
};
