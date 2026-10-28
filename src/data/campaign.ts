/**
 * Campaign scenarios (GDD §8) and sandbox defaults (GDD §11). OWNER: Creative Director.
 * Placeholder MVP scenario by the CTO: a short campaign with several viable outcomes (GDD §15).
 */
import type { SandboxSetup, ScenarioDef, ScenarioId } from '../core/types';

const SKILLS = (martial: number, stewardship: number, diplomacy: number, intrigue: number, learning: number) => ({
  martial,
  stewardship,
  diplomacy,
  intrigue,
  learning,
});

export const SCENARIOS: Readonly<Record<ScenarioId, ScenarioDef>> = {
  broken_crown: {
    id: 'broken_crown',
    chapter: 1,
    title: 'The Broken Crown',
    subtitle: 'Secure the capital, resolve succession and keep the army whole.',
    description:
      'The old Samraj is dead. In Rajapura the court whispers of rival heirs, the granaries are half empty after a weak monsoon, and Giridurgan riders probe the southern crossings. Hold the realm together - by grain, by word, or by the sword.',
    playerFactionId: 'heartland',
    factionIds: ['heartland', 'highland', 'forest', 'frontier'],
    startYear: -300,
    startMonth: 6,
    seed: 20240,
    settlementOwners: {},
    armies: [
      { id: 'army_royal', name: 'Royal Host of Rajapura', factionId: 'heartland', settlementId: 'rajapura', commanderId: 'char_senapati', units: [{ unitClass: 'spearmen', formations: 4 }, { unitClass: 'archers', formations: 2 }, { unitClass: 'elite_guards', formations: 1 }, { unitClass: 'cavalry', formations: 1 }, { unitClass: 'war_elephants', formations: 1 }, { unitClass: 'supply_train', formations: 1 }] },
      { id: 'army_south', name: 'Southern Watch', factionId: 'heartland', settlementId: 'setupur', commanderId: null, units: [{ unitClass: 'spearmen', formations: 2 }, { unitClass: 'archers', formations: 1 }, { unitClass: 'scouts', formations: 1 }] },
      { id: 'army_giri', name: 'Hill Lords of Giridurg', factionId: 'highland', settlementId: 'shilapur', commanderId: 'char_giri_raja', units: [{ unitClass: 'spearmen', formations: 3 }, { unitClass: 'archers', formations: 2 }, { unitClass: 'cavalry', formations: 2 }, { unitClass: 'engineers', formations: 1 }, { unitClass: 'supply_train', formations: 1 }] },
      { id: 'army_vanya', name: 'Vanyan Elephant Host', factionId: 'forest', settlementId: 'vanapura', commanderId: null, units: [{ unitClass: 'spearmen', formations: 2 }, { unitClass: 'archers', formations: 2 }, { unitClass: 'war_elephants', formations: 1 }] },
      { id: 'army_maru', name: 'Marudeshi Riders', factionId: 'frontier', settlementId: 'marupur', commanderId: null, units: [{ unitClass: 'cavalry', formations: 2 }, { unitClass: 'scouts', formations: 1 }, { unitClass: 'archers', formations: 1 }] },
    ],
    characters: [
      { id: 'char_regent', name: 'Rani Vasumati', factionId: 'heartland', dynastyId: 'dyn_suvarna', gender: 'female', age: 44, roles: ['ruler'], traits: ['shrewd', 'administrator', 'cautious'], skills: SKILLS(6, 14, 12, 10, 11), loyalty: 1, ambition: 0.5, interest: 'power', governsProvinceId: null, councilSeat: null, spouseId: null, parentIds: [] },
      { id: 'char_heir', name: 'Kumara Aditya', factionId: 'heartland', dynastyId: 'dyn_suvarna', gender: 'male', age: 19, roles: ['heir'], traits: ['brave', 'reckless'], skills: SKILLS(12, 5, 7, 4, 6), loyalty: 0.8, ambition: 0.7, interest: 'power', governsProvinceId: null, councilSeat: null, spouseId: null, parentIds: ['char_regent'] },
      { id: 'char_claimant', name: 'Prince Devavarman', factionId: 'heartland', dynastyId: 'dyn_suvarna', gender: 'male', age: 36, roles: ['claimant', 'governor'], traits: ['ambitious', 'scheming', 'charismatic'], skills: SKILLS(9, 10, 13, 14, 8), loyalty: 0.35, ambition: 0.9, interest: 'power', governsProvinceId: 'prov_rajapura', councilSeat: null, spouseId: null, parentIds: [] },
      { id: 'char_senapati', name: 'Senapati Bhadrasena', factionId: 'heartland', dynastyId: null, gender: 'male', age: 51, roles: ['general', 'advisor'], traits: ['strategist', 'loyal'], skills: SKILLS(16, 6, 5, 6, 7), loyalty: 0.75, ambition: 0.4, interest: 'land', governsProvinceId: null, councilSeat: 'commander', spouseId: null, parentIds: [] },
      { id: 'char_mantri', name: 'Mantri Kautilya-Varma', factionId: 'heartland', dynastyId: null, gender: 'male', age: 58, roles: ['advisor'], traits: ['scholarly', 'shrewd'], skills: SKILLS(4, 15, 14, 12, 17), loyalty: 0.8, ambition: 0.3, interest: 'learning', governsProvinceId: null, councilSeat: 'chief_minister', spouseId: null, parentIds: [] },
      { id: 'char_kosha', name: 'Treasurer Lakshmidhara', factionId: 'heartland', dynastyId: null, gender: 'male', age: 47, roles: ['advisor'], traits: ['greedy', 'administrator'], skills: SKILLS(3, 16, 8, 9, 10), loyalty: 0.6, ambition: 0.5, interest: 'wealth', governsProvinceId: null, councilSeat: 'treasurer', spouseId: null, parentIds: [] },
      { id: 'char_tira_gov', name: 'Governor Chandralekha', factionId: 'heartland', dynastyId: null, gender: 'female', age: 39, roles: ['governor'], traits: ['just', 'generous'], skills: SKILLS(5, 13, 11, 6, 9), loyalty: 0.7, ambition: 0.4, interest: 'family', governsProvinceId: 'prov_tira', councilSeat: null, spouseId: null, parentIds: [] },
      { id: 'char_giri_raja', name: 'Raja Shailendra', factionId: 'highland', dynastyId: 'dyn_giri', gender: 'male', age: 41, roles: ['ruler', 'general'], traits: ['brave', 'cautious', 'strategist'], skills: SKILLS(15, 9, 10, 8, 8), loyalty: 1, ambition: 0.6, interest: 'land', governsProvinceId: null, councilSeat: null, spouseId: null, parentIds: [] },
      { id: 'char_vanya_raja', name: 'Raja Aranyaka', factionId: 'forest', dynastyId: null, gender: 'male', age: 55, roles: ['ruler'], traits: ['devout', 'content'], skills: SKILLS(10, 9, 9, 7, 10), loyalty: 1, ambition: 0.3, interest: 'faith', governsProvinceId: null, councilSeat: null, spouseId: null, parentIds: [] },
      { id: 'char_maru_rana', name: 'Rana Hamira', factionId: 'frontier', dynastyId: null, gender: 'male', age: 33, roles: ['ruler', 'general'], traits: ['reckless', 'brave'], skills: SKILLS(14, 6, 6, 9, 5), loyalty: 1, ambition: 0.8, interest: 'wealth', governsProvinceId: null, councilSeat: null, spouseId: null, parentIds: [] },
    ],
    dynasties: [
      { id: 'dyn_suvarna', name: 'House of Suvarna', factionId: 'heartland', headId: 'char_regent', successionLaw: 'designated_heir' },
      { id: 'dyn_giri', name: 'Clan of the High Forts', factionId: 'highland', headId: 'char_giri_raja', successionLaw: 'council_election' },
    ],
    relations: [
      { a: 'heartland', b: 'highland', opinion: -35, atWar: true, treaties: [] },
      { a: 'heartland', b: 'forest', opinion: 10, atWar: false, treaties: ['trade'] },
      { a: 'heartland', b: 'frontier', opinion: -10, atWar: false, treaties: [] },
      { a: 'highland', b: 'forest', opinion: 5, atWar: false, treaties: [] },
      { a: 'highland', b: 'frontier', opinion: 20, atWar: false, treaties: ['non_aggression'] },
      { a: 'forest', b: 'frontier', opinion: 0, atWar: false, treaties: [] },
    ],
    treasury: { heartland: 4000, highland: 2200, forest: 1800, frontier: 1500 },
    objectives: [
      { id: 'obj_hold_capital', label: 'Hold Rajapura', description: 'Rajapura must remain in your hands until the end of the chapter.', condition: { kind: 'day_at_least', day: 360 }, failCondition: { kind: 'not', cond: { kind: 'owns_settlement', faction: { kind: 'player' }, settlementId: 'rajapura' } }, optional: false, reward: [] },
      { id: 'obj_succession', label: 'Resolve the succession', description: 'Name an heir the court will accept, or silence the claimant.', condition: { kind: 'flag_set', flag: 'succession_resolved' }, failCondition: null, optional: false, reward: [{ kind: 'faction_var', target: { kind: 'player' }, variable: 'legitimacy', op: 'add', value: 0.15 }] },
      { id: 'obj_granaries', label: 'Refill the granaries', description: 'Store 20,000 food in the capital.', condition: { kind: 'settlement_var', target: { kind: 'settlement', id: 'rajapura' }, variable: 'foodStored', op: '>=', value: 20000 }, failCondition: null, optional: true, reward: [{ kind: 'faction_var', target: { kind: 'player' }, variable: 'stability', op: 'add', value: 0.1 }] },
      { id: 'obj_crossings', label: 'Secure the southern crossing', description: 'Control Setupur and keep Giridurgan raiders north of the plateau... or make peace with them.', condition: { kind: 'any', of: [{ kind: 'owns_settlement', faction: { kind: 'player' }, settlementId: 'setupur' }, { kind: 'has_treaty', a: { kind: 'player' }, b: { kind: 'faction', id: 'highland' }, type: 'peace' }] }, failCondition: null, optional: true, reward: [] },
    ],
    outcomes: [
      { id: 'out_united', kind: 'victory', title: 'The Crown Restored', epilogue: 'The realm holds. Granaries are full, the heir is accepted and the southern hills are quiet - for now.', condition: { kind: 'all', of: [{ kind: 'flag_set', flag: 'succession_resolved' }, { kind: 'owns_settlement', faction: { kind: 'player' }, settlementId: 'rajapura' }, { kind: 'faction_var', target: { kind: 'player' }, variable: 'stability', op: '>=', value: 0.6 }] }, priority: 3 },
      { id: 'out_iron', kind: 'mixed', title: 'A Crown of Iron', epilogue: 'You hold the capital by force. The court obeys, but it does not forget.', condition: { kind: 'owns_settlement', faction: { kind: 'player' }, settlementId: 'rajapura' }, priority: 1 },
      { id: 'out_fallen', kind: 'defeat', title: 'The Broken Crown', epilogue: 'Rajapura has fallen. The House of Suvarna scatters to the provinces.', condition: { kind: 'not', cond: { kind: 'owns_settlement', faction: { kind: 'player' }, settlementId: 'rajapura' } }, priority: 5 },
    ],
    timeLimitDays: 360,
    scriptedEvents: [
      { eventId: 'evt_court_succession', day: 3 },
      { eventId: 'evt_grain_requisition', day: 20 },
    ],
    victoryTypes: ['scenario'],
    hints: [
      'Armies eat. Keep supply trains on safe roads, or requisition grain - at a price.',
      'Morale breaks before men do: protect your flanks and your commander.',
      'Not every war needs a battle. Treaties, marriages and tribute are paths to power too.',
    ],
    historicity: 'fictional',
  },
};

export const DEFAULT_SCENARIO_ID: ScenarioId = 'broken_crown';

export function defaultSandbox(seed: number): SandboxSetup {
  return {
    seed,
    playerFactionId: 'heartland',
    rivalFactionIds: ['highland', 'forest', 'frontier'],
    startMonth: 0,
    startingTreasury: 3000,
    fertility: 1,
    monsoonStrength: 1,
    droughtRisk: 0.3,
    rebelliousness: 0.5,
    aiAggression: 0.5,
    difficulty: 'normal',
    victoryTypes: ['unification', 'prosperity', 'diplomatic_hegemony', 'cultural_legacy'],
  };
}
