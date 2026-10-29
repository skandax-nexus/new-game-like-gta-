/**
 * Campaign scenarios (GDD §8) and sandbox setup data (GDD §11). OWNER: Creative Director.
 * Specified in docs/DESIGN_SPEC.md §9 (campaign) and §10 (sandbox).
 *
 * MVP campaign = `broken_crown`: one scenario in two acts covering GDD chapters 1-2
 *   Act I  "The Broken Crown"        - secure the capital, resolve succession, keep the army whole.
 *   Act II "The Grain and the Sword" - feed the realm through a lean year; negotiate with or defeat Giridurga.
 * Three viable victories (conquest / diplomatic hegemony / prosperity), one mixed ending and three defeats.
 * `seven_hills` is the same world seen from the Giridurga Confederacy (second playable faction).
 *
 * Narrative events are gated by scenario flags (`bc_act`, `sh_act`) set by each scenario's prologue event,
 * so chapter-1 content never leaks into sandbox or into the other scenario (see events.ts header).
 * All characters, places and houses are fictional (GDD §7: no real dynasties, no villains by culture).
 */
import type { InitialArmyDef, InitialCharacterDef, SandboxSetup, ScenarioDef, ScenarioId } from '../core/types';
import { all, any, atWar, dayAtLeast, faction, flagSet, fv, hasTreaty, not, owns, PLAYER, soldiersAtLeast, stageAtLeast, ANY_OWNED, addF } from './dsl';

const SKILLS = (martial: number, stewardship: number, diplomacy: number, intrigue: number, learning: number) => ({
  martial,
  stewardship,
  diplomacy,
  intrigue,
  learning,
});

type CharInput = Omit<InitialCharacterDef, 'governsProvinceId' | 'councilSeat' | 'spouseId' | 'parentIds' | 'dynastyId'> &
  Partial<Pick<InitialCharacterDef, 'governsProvinceId' | 'councilSeat' | 'spouseId' | 'parentIds' | 'dynastyId'>>;
const C = (c: CharInput): InitialCharacterDef => ({ dynastyId: null, governsProvinceId: null, councilSeat: null, spouseId: null, parentIds: [], ...c });

/** The people of the River of Kings at the start of both scenarios (-300, month of Ashvina). */
export const CHARACTERS: readonly InitialCharacterDef[] = [
  // --- Suvarna Kingdom (House of Suvarna) ---
  C({ id: 'char_regent', name: 'Rani Vasumati', factionId: 'heartland', dynastyId: 'dyn_suvarna', gender: 'female', age: 44, roles: ['ruler'], traits: ['shrewd', 'administrator', 'cautious'], skills: SKILLS(6, 14, 12, 10, 11), loyalty: 1, ambition: 0.5, interest: 'family' }),
  C({ id: 'char_heir', name: 'Kumara Aditya', factionId: 'heartland', dynastyId: 'dyn_suvarna', gender: 'male', age: 19, roles: ['heir'], traits: ['brave', 'reckless', 'charismatic'], skills: SKILLS(12, 5, 8, 4, 7), loyalty: 0.85, ambition: 0.6, interest: 'power', parentIds: ['char_regent'] }),
  C({ id: 'char_claimant', name: 'Prince Devavarman', factionId: 'heartland', dynastyId: 'dyn_suvarna', gender: 'male', age: 36, roles: ['claimant', 'governor'], traits: ['ambitious', 'scheming', 'charismatic'], skills: SKILLS(9, 11, 13, 14, 8), loyalty: 0.35, ambition: 0.9, interest: 'power', governsProvinceId: 'prov_ratnadesha' }),
  C({ id: 'char_senapati', name: 'Senapati Bhadrasena', factionId: 'heartland', gender: 'male', age: 51, roles: ['general', 'advisor'], traits: ['strategist', 'loyal'], skills: SKILLS(16, 6, 5, 6, 7), loyalty: 0.75, ambition: 0.4, interest: 'land', councilSeat: 'commander' }),
  C({ id: 'char_mantri', name: 'Mantri Haridatta', factionId: 'heartland', gender: 'male', age: 58, roles: ['advisor'], traits: ['scholarly', 'shrewd'], skills: SKILLS(4, 15, 14, 12, 17), loyalty: 0.8, ambition: 0.3, interest: 'learning', councilSeat: 'chief_minister' }),
  C({ id: 'char_kosha', name: 'Lakshmidhara the Treasurer', factionId: 'heartland', gender: 'male', age: 47, roles: ['advisor'], traits: ['greedy', 'administrator'], skills: SKILLS(3, 16, 8, 9, 10), loyalty: 0.6, ambition: 0.5, interest: 'wealth', councilSeat: 'treasurer' }),
  C({ id: 'char_spymaster', name: 'Charini Nilambari', factionId: 'heartland', gender: 'female', age: 33, roles: ['spy', 'advisor'], traits: ['shrewd', 'loyal'], skills: SKILLS(5, 7, 9, 16, 9), loyalty: 0.75, ambition: 0.3, interest: 'power', councilSeat: 'spymaster' }),
  C({ id: 'char_scholar', name: 'Acharya Vedavrata', factionId: 'heartland', gender: 'male', age: 63, roles: ['advisor'], traits: ['devout', 'scholarly', 'just'], skills: SKILLS(2, 8, 10, 5, 18), loyalty: 0.8, ambition: 0.2, interest: 'faith', councilSeat: 'court_scholar' }),
  C({ id: 'char_dhanya_gov', name: 'Governor Chandralekha', factionId: 'heartland', gender: 'female', age: 39, roles: ['governor'], traits: ['just', 'generous'], skills: SKILLS(5, 13, 11, 6, 9), loyalty: 0.7, ambition: 0.4, interest: 'family', governsProvinceId: 'prov_dhanyakshetra' }),
  // --- Giridurga Confederacy (Clan of the Seven Peaks) ---
  C({ id: 'char_giri_raja', name: 'Raja Vindhyaketu', factionId: 'highland', dynastyId: 'dyn_giri', gender: 'male', age: 41, roles: ['ruler', 'general'], traits: ['brave', 'cautious', 'strategist'], skills: SKILLS(15, 9, 11, 8, 8), loyalty: 1, ambition: 0.6, interest: 'land' }),
  C({ id: 'char_giri_kumari', name: 'Kumari Meghavati', factionId: 'highland', dynastyId: 'dyn_giri', gender: 'female', age: 20, roles: ['heir', 'courtier'], traits: ['diplomat', 'charismatic', 'just'], skills: SKILLS(9, 9, 15, 8, 12), loyalty: 0.9, ambition: 0.5, interest: 'family', parentIds: ['char_giri_raja'] }),
  C({ id: 'char_giri_champion', name: 'Vira Durjaya', factionId: 'highland', gender: 'male', age: 28, roles: ['general'], traits: ['brave', 'reckless', 'robust'], skills: SKILLS(17, 3, 4, 4, 5), loyalty: 0.85, ambition: 0.5, interest: 'power', councilSeat: 'commander' }),
  C({ id: 'char_giri_gov', name: 'Rajuka Ketaki', factionId: 'highland', gender: 'female', age: 45, roles: ['governor'], traits: ['greedy', 'shrewd'], skills: SKILLS(4, 14, 10, 11, 8), loyalty: 0.55, ambition: 0.55, interest: 'wealth', governsProvinceId: 'prov_shilatala' }),
  C({ id: 'char_giri_elder', name: 'Elder Shilabhadra', factionId: 'highland', gender: 'male', age: 60, roles: ['advisor'], traits: ['just', 'cautious'], skills: SKILLS(5, 12, 13, 7, 12), loyalty: 0.8, ambition: 0.2, interest: 'learning', councilSeat: 'chief_minister' }),
  // --- Nilavana Kingdoms ---
  C({ id: 'char_forest_rani', name: 'Rani Shyamala', factionId: 'forest', dynastyId: 'dyn_nila', gender: 'female', age: 52, roles: ['ruler'], traits: ['devout', 'diplomat', 'content'], skills: SKILLS(8, 11, 14, 8, 11), loyalty: 1, ambition: 0.35, interest: 'faith' }),
  // --- Marudesha Principalities ---
  C({ id: 'char_maru_rana', name: 'Rana Virasimha', factionId: 'frontier', dynastyId: 'dyn_maru', gender: 'male', age: 33, roles: ['ruler', 'general'], traits: ['reckless', 'brave', 'greedy'], skills: SKILLS(14, 6, 6, 9, 5), loyalty: 1, ambition: 0.8, interest: 'wealth' }),
];

/** Starting armies. `army_royal` id is relied on by tests/integration/determinism.test.ts - keep it. */
export const ARMIES: readonly InitialArmyDef[] = [
  { id: 'army_royal', name: 'Royal Host of Rajapura', factionId: 'heartland', settlementId: 'rajapura', commanderId: 'char_senapati', units: [{ unitClass: 'spearmen', formations: 4 }, { unitClass: 'archers', formations: 2 }, { unitClass: 'elite_guards', formations: 1 }, { unitClass: 'cavalry', formations: 1 }, { unitClass: 'war_elephants', formations: 1 }, { unitClass: 'supply_train', formations: 1 }] },
  { id: 'army_south', name: 'Watch of the Setu Bridge', factionId: 'heartland', settlementId: 'setupur', commanderId: null, units: [{ unitClass: 'spearmen', formations: 2 }, { unitClass: 'archers', formations: 1 }, { unitClass: 'scouts', formations: 1 }] },
  { id: 'army_ratna', name: 'Household of Devavarman', factionId: 'heartland', settlementId: 'ratnapura', commanderId: 'char_claimant', units: [{ unitClass: 'spearmen', formations: 2 }, { unitClass: 'archers', formations: 1 }, { unitClass: 'elite_guards', formations: 1 }, { unitClass: 'cavalry', formations: 1 }] },
  { id: 'army_giri', name: 'Host of the Seven Peaks', factionId: 'highland', settlementId: 'shilapur', commanderId: 'char_giri_raja', units: [{ unitClass: 'spearmen', formations: 3 }, { unitClass: 'archers', formations: 2 }, { unitClass: 'cavalry', formations: 2 }, { unitClass: 'engineers', formations: 1 }, { unitClass: 'supply_train', formations: 1 }] },
  { id: 'army_giri_west', name: 'Wardens of the Dvara Pass', factionId: 'highland', settlementId: 'dvaradurga', commanderId: 'char_giri_champion', units: [{ unitClass: 'spearmen', formations: 2 }, { unitClass: 'archers', formations: 2 }] },
  { id: 'army_forest', name: 'Elephant Host of Nilavana', factionId: 'forest', settlementId: 'nilavanapura', commanderId: null, units: [{ unitClass: 'spearmen', formations: 2 }, { unitClass: 'archers', formations: 2 }, { unitClass: 'war_elephants', formations: 1 }, { unitClass: 'scouts', formations: 1 }] },
  { id: 'army_maru', name: 'Riders of the Salt Road', factionId: 'frontier', settlementId: 'lavanapura', commanderId: 'char_maru_rana', units: [{ unitClass: 'cavalry', formations: 2 }, { unitClass: 'chariots', formations: 1 }, { unitClass: 'scouts', formations: 1 }, { unitClass: 'archers', formations: 1 }] },
];

const DYNASTIES: ScenarioDef['dynasties'] = [
  { id: 'dyn_suvarna', name: 'House of Suvarna', factionId: 'heartland', headId: 'char_regent', successionLaw: 'designated_heir' },
  { id: 'dyn_giri', name: 'Clan of the Seven Peaks', factionId: 'highland', headId: 'char_giri_raja', successionLaw: 'council_election' },
  { id: 'dyn_nila', name: 'House of the Blue Grove', factionId: 'forest', headId: 'char_forest_rani', successionLaw: 'seniority' },
  { id: 'dyn_maru', name: 'Line of the Salt Wells', factionId: 'frontier', headId: 'char_maru_rana', successionLaw: 'primogeniture' },
];

const RELATIONS: ScenarioDef['relations'] = [
  { a: 'heartland', b: 'highland', opinion: -35, atWar: true, treaties: [] },
  { a: 'heartland', b: 'forest', opinion: 10, atWar: false, treaties: ['trade'] },
  { a: 'heartland', b: 'frontier', opinion: -10, atWar: false, treaties: [] },
  { a: 'highland', b: 'forest', opinion: 5, atWar: false, treaties: [] },
  { a: 'highland', b: 'frontier', opinion: 20, atWar: false, treaties: ['non_aggression'] },
  { a: 'forest', b: 'frontier', opinion: 0, atWar: false, treaties: [] },
];

const FACTION_IDS = ['heartland', 'highland', 'forest', 'frontier'];
const TREASURY = { heartland: 4000, highland: 2600, forest: 1800, frontier: 1500 };
const MATERIALS = { heartland: { timber: 600, stone: 300 }, highland: { timber: 300, stone: 900 }, forest: { timber: 1200, stone: 100 }, frontier: { timber: 150, stone: 250 } };
const STARTING_AGES: ScenarioDef['startingAges'] = { heartland: 'mahajanapada', highland: 'mahajanapada', forest: 'mahajanapada', frontier: 'janapada' };

const HIGHLAND = faction('highland');
const HEARTLAND = faction('heartland');
const FOREST = faction('forest');
const FRONTIER = faction('frontier');
const noRevolt = not(stageAtLeast(ANY_OWNED, 'revolt'));
const noProtest = not(stageAtLeast(ANY_OWNED, 'protest'));

export const SCENARIOS: Readonly<Record<ScenarioId, ScenarioDef>> = {
  broken_crown: {
    id: 'broken_crown',
    chapter: 1,
    title: 'The Broken Crown',
    subtitle: 'Act I: The Broken Crown  ·  Act II: The Grain and the Sword',
    description:
      'Maharaja Vishvavarman is dead and the monsoon failed him in his last year. In Rajapura the regent, Rani Vasumati, holds the crown for her son Kumara Aditya - and Prince Devavarman, the late king\'s brother, holds the nobles. The granaries are half empty, the Giridurgan hill clans are raiding the Setu Bridge, and every faction at court is counting soldiers. Hold the realm together through a lean year: by grain, by word, or by the sword.',
    playerFactionId: 'heartland',
    factionIds: FACTION_IDS,
    startYear: -300,
    startMonth: 6,
    seed: 20240,
    settlementOwners: {},
    armies: ARMIES.slice(),
    characters: CHARACTERS.slice(),
    dynasties: DYNASTIES,
    relations: RELATIONS,
    treasury: TREASURY,
    materials: MATERIALS,
    startingAges: STARTING_AGES,
    monsoonStrength: 0.7,
    heroCharacterId: 'char_heir',
    acts: [
      { id: 'act_crown', number: 1, title: 'The Broken Crown', subtitle: 'Secure the capital, resolve the succession, keep the army whole.', flag: 'bc_act', flagValue: 1, summary: 'The court is divided between the regent and Prince Devavarman. Win the nobles, name an heir the realm will accept and keep the household armies from choosing sides.' },
      { id: 'act_grain', number: 2, title: 'The Grain and the Sword', subtitle: 'Feed the realm through the lean year; settle with Giridurga.', flag: 'bc_act', flagValue: 2, summary: 'A thin harvest means a hungry spring. Requisition, buy or ration grain - and end the war in the hills by treaty, marriage, tribute or siege before the realm starves itself.' },
    ],
    objectives: [
      { id: 'obj_hold_capital', act: 1, label: 'Hold Rajapura', description: 'Rajapura must remain in your hands until the year turns (day 540).', condition: dayAtLeast(540), failCondition: not(owns('rajapura')), optional: false, reward: [] },
      { id: 'obj_succession', act: 1, label: 'Resolve the succession', description: 'Name an heir the court will accept, win over the claimant - or silence him.', condition: flagSet('succession_resolved'), failCondition: flagSet('usurped'), optional: false, reward: [addF(PLAYER, 'legitimacy', 0.1)] },
      { id: 'obj_court', act: 1, label: 'Win the Hall of Pillars', description: 'As Kumara Aditya, walk the capital and persuade three of the four great nobles (hero mission).', condition: flagSet('court_won'), failCondition: flagSet('court_lost'), optional: true, reward: [addF(PLAYER, 'stability', 0.05)] },
      { id: 'obj_army_whole', act: 1, label: 'Keep the army whole', description: 'Resolve the succession with at least 1,800 soldiers under arms and no household army defecting.', condition: all(flagSet('succession_resolved'), soldiersAtLeast(PLAYER, 1800), not(flagSet('claimant_defected'))), failCondition: flagSet('claimant_defected'), optional: true, reward: [addF(PLAYER, 'prestige', 15)] },
      { id: 'obj_settle_hills', act: 2, label: 'Settle with Giridurga', description: 'Make peace with the Confederacy - by treaty, marriage or tribute - or take Giridurg.', condition: any(hasTreaty(PLAYER, HIGHLAND, 'peace'), hasTreaty(PLAYER, HIGHLAND, 'marriage_alliance'), hasTreaty(PLAYER, HIGHLAND, 'tributary'), owns('giridurg')), failCondition: null, optional: false, reward: [addF(PLAYER, 'stability', 0.05)] },
      { id: 'obj_lean_year', act: 2, label: 'Feed the realm through the lean year', description: 'Reach the next kharif harvest (day 420) with no settlement in revolt.', condition: all(dayAtLeast(420), noRevolt), failCondition: null, optional: false, reward: [addF(PLAYER, 'legitimacy', 0.05)] },
      { id: 'obj_royal_granaries', act: 2, label: 'Refill the royal granaries', description: 'Hold 20,000 measures of grain in the royal reserve.', condition: fv(PLAYER, 'foodReserve', '>=', 20000), failCondition: null, optional: true, reward: [addF(PLAYER, 'stability', 0.05)] },
      { id: 'obj_bridge', act: 2, label: 'Hold the Setu Bridge', description: 'Setupur must be yours when the year turns.', condition: all(dayAtLeast(530), owns('setupur')), failCondition: null, optional: true, reward: [] },
    ],
    outcomes: [
      { id: 'out_fallen', kind: 'defeat', title: 'The Broken Crown', epilogue: 'Rajapura has fallen. The House of Suvarna scatters to the provinces, and the river carries other kings now.', condition: not(owns('rajapura')), priority: 10, immediate: true },
      { id: 'out_usurped', kind: 'defeat', title: 'The Usurper\'s Crown', epilogue: 'Prince Devavarman sits in the Hall of Pillars. The regent and her son ride for Setupur with what guards remain - and the chronicle of their reign ends here.', condition: flagSet('usurped'), priority: 9, immediate: true },
      { id: 'out_collapse', kind: 'defeat', title: 'A Realm Unmade', epilogue: 'No one obeys the crown any more. Governors keep their taxes, generals keep their armies, and the kingdom becomes a map of quarrelling lordships.', condition: all(fv(PLAYER, 'stability', '<=', 0.1), fv(PLAYER, 'legitimacy', '<=', 0.25)), priority: 8, immediate: true },
      { id: 'out_conquest', kind: 'victory', victoryType: 'unification', title: 'The Sword of Suvarna', epilogue: 'Giridurg has opened its gates. The plains and the plateau answer to one crown, and the hill clans swear a new oath - to Rajapura. Whether it holds will be the next king\'s burden.', condition: all(flagSet('succession_resolved'), owns('rajapura'), owns('setupur'), owns('giridurg')), priority: 7, immediate: true },
      { id: 'out_hegemony', kind: 'victory', victoryType: 'diplomatic_hegemony', title: 'The Oath of the River', epilogue: 'At the ghats of Tirthaghat the hill clans and the plains swore on the same water. No army crosses the Setu Bridge now but merchants, and every court on the river sends its envoys to Rajapura first.', condition: all(flagSet('succession_resolved'), owns('rajapura'), hasTreaty(PLAYER, HIGHLAND, 'peace'), any(hasTreaty(PLAYER, HIGHLAND, 'marriage_alliance'), hasTreaty(PLAYER, HIGHLAND, 'tributary')), any(hasTreaty(PLAYER, FOREST, 'trade'), hasTreaty(PLAYER, FRONTIER, 'trade'))), priority: 6, immediate: true },
      { id: 'out_prosperity', kind: 'victory', victoryType: 'prosperity', title: 'The Full Granary', epilogue: 'The lean year passed and no one starved who could be fed. The granaries are full, the roads are safe, and the farmers of Dhanyakshetra sing the regent\'s name at the threshing floors.', condition: all(flagSet('succession_resolved'), owns('rajapura'), owns('setupur'), fv(PLAYER, 'stability', '>=', 0.65), fv(PLAYER, 'foodReserve', '>=', 20000), fv(PLAYER, 'treasury', '>=', 6000), noProtest, not(atWar(PLAYER, null))), priority: 5 },
      { id: 'out_restored', kind: 'mixed', title: 'The Crown Restored', epilogue: 'The heir is accepted and the capital holds, but the hills are not quiet and the granaries are not full. The realm survives - which, this year, was enough.', condition: all(flagSet('succession_resolved'), owns('rajapura'), fv(PLAYER, 'stability', '>=', 0.45)), priority: 3 },
      { id: 'out_iron', kind: 'mixed', title: 'A Crown of Iron', epilogue: 'You hold the capital by force. The court obeys, but it does not forget.', condition: owns('rajapura'), priority: 1 },
    ],
    timeLimitDays: 540,
    scriptedEvents: [
      { eventId: 'evt_bc_prologue', day: 1 },
      { eventId: 'evt_court_succession', day: 3 },
      { eventId: 'evt_bc_council_of_war', day: 14 },
      { eventId: 'evt_bc_envoys_hills', day: 32 },
      { eventId: 'evt_bc_thin_harvest', day: 46 },
      { eventId: 'evt_bc_act2', day: 120 },
      { eventId: 'evt_bc_siege_grain', day: 138 },
      { eventId: 'evt_bc_temple_town', day: 180 },
      { eventId: 'evt_bc_lean_months', day: 245 },
      { eventId: 'evt_bc_monsoon_omens', day: 300 },
      { eventId: 'evt_bc_port_charter', day: 330 },
      { eventId: 'evt_bc_last_envoy', day: 430 },
      { eventId: 'evt_bc_year_turns', day: 515 },
    ],
    victoryTypes: ['scenario', 'unification', 'diplomatic_hegemony', 'prosperity'],
    hints: [
      'Armies eat. A host of 1,600 eats about 300 measures a day - keep supply trains on safe roads or requisition grain, at a price.',
      'Morale breaks before men do: guard your flanks, keep your commander alive and never let archers stand alone.',
      'Not every war needs a battle. Treaties, a marriage at Tirthaghat, or tribute can end the war in the hills.',
      'The lean months are grishma and early varsha: fill the royal granaries before the hot season.',
      'Visit Rajapura as Kumara Aditya (Hero button): what you see in the granaries and the bazaar can win arguments in the Hall of Pillars.',
      'Every province governor has an interest - wealth, power, faith, family, land or learning. Feed it and they stay loyal.',
    ],
    historicity: 'fictional',
    sourceNote: 'GDD §8 chapters 1-2. Fictional realm and people; statecraft details are game simplifications.',
  },
  seven_hills: {
    id: 'seven_hills',
    chapter: 1,
    title: 'The Seven Hills',
    subtitle: 'Giridurga: feed the hills, hold the passes, win the river.',
    description:
      'The plains king is dead and his court is at war with itself. On the plateau, the seven clans of Giridurga have stone, horses and forts - and barely enough grain to reach the monsoon. Raja Vindhyaketu must decide: take the Setu Bridge and the river fields by force, or bargain for grain with a crown that may not survive the year.',
    playerFactionId: 'highland',
    factionIds: FACTION_IDS,
    startYear: -300,
    startMonth: 6,
    seed: 30751,
    settlementOwners: {},
    armies: ARMIES.slice(),
    characters: CHARACTERS.slice(),
    dynasties: DYNASTIES,
    relations: RELATIONS,
    treasury: TREASURY,
    materials: MATERIALS,
    startingAges: STARTING_AGES,
    monsoonStrength: 0.7,
    heroCharacterId: 'char_giri_kumari',
    acts: [
      { id: 'act_hunger', number: 1, title: 'The Hungry Plateau', subtitle: 'Find grain before the hot season.', flag: 'sh_act', flagValue: 1, summary: 'The plateau harvest is thin and the clans are restless. Raid, trade or bargain for grain - and keep the oath of the seven clans.' },
      { id: 'act_river', number: 2, title: 'The River Oath', subtitle: 'Win the river by treaty or by the bridge.', flag: 'sh_act', flagValue: 2, summary: 'The lowland succession is settled one way or another. Now the river crossings decide whether the hills starve or prosper.' },
    ],
    objectives: [
      { id: 'obj_sh_hold', act: 1, label: 'Hold Giridurg', description: 'The citadel of the seven clans must stand until the year turns (day 540).', condition: dayAtLeast(540), failCondition: not(owns('giridurg')), optional: false, reward: [] },
      { id: 'obj_sh_grain', act: 1, label: 'Secure grain for the hills', description: 'Take the Setu Bridge, or sign a trade treaty with the plains or the forest.', condition: any(owns('setupur'), hasTreaty(PLAYER, HEARTLAND, 'trade'), hasTreaty(PLAYER, FOREST, 'trade')), failCondition: null, optional: false, reward: [addF(PLAYER, 'stability', 0.05)] },
      { id: 'obj_sh_oath', act: 2, label: 'Keep the oath of the seven clans', description: 'Confederacy stability at 0.5 or more when the year turns.', condition: all(dayAtLeast(535), fv(PLAYER, 'stability', '>=', 0.5)), failCondition: null, optional: false, reward: [] },
      { id: 'obj_sh_reserve', act: 2, label: 'Fill the cliff cisterns and granaries', description: 'Hold 12,000 measures in the Confederacy reserve.', condition: fv(PLAYER, 'foodReserve', '>=', 12000), failCondition: null, optional: true, reward: [addF(PLAYER, 'prestige', 15)] },
    ],
    outcomes: [
      { id: 'out_sh_fallen', kind: 'defeat', title: 'The Citadel Falls', epilogue: 'Giridurg has fallen. The seven clans scatter to their own hills, and the oath stone stands alone.', condition: not(owns('giridurg')), priority: 10, immediate: true },
      { id: 'out_sh_broken_oath', kind: 'defeat', title: 'The Broken Oath', epilogue: 'The clans walk out of the assembly one by one. There is no Confederacy any more - only seven hungry hills.', condition: all(fv(PLAYER, 'stability', '<=', 0.1), fv(PLAYER, 'legitimacy', '<=', 0.25)), priority: 8, immediate: true },
      { id: 'out_sh_bridge', kind: 'victory', victoryType: 'unification', title: 'The Bridge Is Ours', epilogue: 'The Setu Bridge flies the seven peaks and the river fields feed the hills. Rajapura will want them back - let it come uphill.', condition: all(owns('giridurg'), owns('setupur'), owns('shilapur'), any(owns('tirthaghat'), owns('rajapura'), owns('dhanyagram'))), priority: 7, immediate: true },
      { id: 'out_sh_river_oath', kind: 'victory', victoryType: 'diplomatic_hegemony', title: 'The River Oath', epilogue: 'Grain comes up the escarpment roads by treaty, not by raid. The clans keep their forts and their pride - and their envoys sit at every court on the river.', condition: all(owns('giridurg'), hasTreaty(PLAYER, HEARTLAND, 'peace'), hasTreaty(PLAYER, HEARTLAND, 'trade'), any(hasTreaty(PLAYER, FOREST, 'mutual_defense'), hasTreaty(PLAYER, FRONTIER, 'mutual_defense'), hasTreaty(PLAYER, HEARTLAND, 'marriage_alliance'))), priority: 6, immediate: true },
      { id: 'out_sh_cisterns', kind: 'victory', victoryType: 'prosperity', title: 'The Full Cisterns', epilogue: 'Stone for the temples of three realms goes down the escarpment; grain and silver come up. The hills have never been so rich.', condition: all(owns('giridurg'), fv(PLAYER, 'foodReserve', '>=', 12000), fv(PLAYER, 'stability', '>=', 0.65), fv(PLAYER, 'treasury', '>=', 4500), noProtest), priority: 5 },
      { id: 'out_sh_endure', kind: 'mixed', title: 'The Hills Endure', epilogue: 'The citadel holds and the clans keep their oath - hungry, proud and waiting for a better year.', condition: owns('giridurg'), priority: 1 },
    ],
    timeLimitDays: 540,
    scriptedEvents: [
      { eventId: 'evt_sh_prologue', day: 1 },
      { eventId: 'evt_sh_hungry_plateau', day: 8 },
      { eventId: 'evt_sh_lowland_envoy', day: 28 },
      { eventId: 'evt_sh_clan_assembly', day: 70 },
      { eventId: 'evt_sh_act2', day: 140 },
      { eventId: 'evt_sh_salt_riders', day: 170 },
      { eventId: 'evt_bc_monsoon_omens', day: 300 },
      { eventId: 'evt_sh_last_offer', day: 430 },
    ],
    victoryTypes: ['scenario', 'unification', 'diplomatic_hegemony', 'prosperity'],
    hints: [
      'The hills have stone and horses but little grain: trade stone for grain at the market, or take the river fields.',
      'Fight uphill battles: Hill Bowmen on high ground and Fort Wardens in the passes bleed any plains army.',
      'Your recruitment pool is small. Every formation lost is a season of training gone.',
      'The Confederacy keeps its word: treaties and marriages come easier to you than to any other realm.',
    ],
    historicity: 'fictional',
    sourceNote: 'Alternate start for the second playable faction (GDD §15 two playable factions).',
  },
};

export const DEFAULT_SCENARIO_ID: ScenarioId = 'broken_crown';

// ---------------------------------------------------------------------------------------------------
// Sandbox (GDD §11): custom start, factions and world conditions. DESIGN_SPEC §10.2.
// ---------------------------------------------------------------------------------------------------

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

/** Slider ranges for the sandbox setup screen (UI reads these; values outside are clamped). */
export const SANDBOX_RANGES = {
  startingTreasury: { min: 500, max: 12000, step: 500, label: 'Starting treasury', help: 'Wealth in the royal treasury on day one.' },
  fertility: { min: 0.5, max: 1.5, step: 0.05, label: 'Fertility', help: 'Multiplies every province\'s fertility (harvest size).' },
  monsoonStrength: { min: 0.5, max: 1.5, step: 0.05, label: 'Monsoon strength', help: 'Mean monsoon strength (1 = normal). Low means droughts; high means floods.' },
  droughtRisk: { min: 0, max: 1, step: 0.05, label: 'Drought risk', help: 'Chance per year that the monsoon fails (strength below 0.7).' },
  rebelliousness: { min: 0, max: 1, step: 0.05, label: 'Rebelliousness', help: 'Scales unrest gain everywhere (0.5 = normal).' },
  aiAggression: { min: 0, max: 1, step: 0.05, label: 'AI aggression', help: 'Added to every AI personality\'s war appetite (0.5 = as designed).' },
} as const;

export const SANDBOX_START_MONTHS: readonly { month: number; label: string }[] = [
  { month: 0, label: 'Chaitra - spring, rabi harvest coming' },
  { month: 3, label: 'Ashadha - before the monsoon (lean season)' },
  { month: 6, label: 'Ashvina - after the monsoon, campaign season' },
  { month: 9, label: 'Pausha - cool season, rabi sown' },
];

export interface SandboxPreset {
  id: string;
  name: string;
  description: string;
  patch: Partial<Omit<SandboxSetup, 'seed' | 'playerFactionId' | 'rivalFactionIds'>>;
}

export const SANDBOX_PRESETS: readonly SandboxPreset[] = [
  { id: 'river_of_kings', name: 'The River of Kings', description: 'The default world: four realms, a normal monsoon, a war on the river.', patch: {} },
  { id: 'golden_age', name: 'A Golden Age', description: 'Rich harvests, gentle monsoons and patient rivals. Build, trade and grow.', patch: { fertility: 1.25, monsoonStrength: 1.05, droughtRisk: 0.1, rebelliousness: 0.3, aiAggression: 0.25, startingTreasury: 6000, victoryTypes: ['prosperity', 'cultural_legacy', 'diplomatic_hegemony'] } },
  { id: 'year_of_drought', name: 'The Year of Drought', description: 'A failing monsoon and hungry neighbours. Every measure of grain is a weapon.', patch: { fertility: 0.85, monsoonStrength: 0.75, droughtRisk: 0.7, rebelliousness: 0.6, aiAggression: 0.6, startingTreasury: 2500 } },
  { id: 'warring_river', name: 'The Warring River', description: 'Aggressive rivals and full war chests. Conquer or be conquered.', patch: { aiAggression: 0.9, startingTreasury: 5000, victoryTypes: ['unification'] } },
  { id: 'restless_provinces', name: 'Restless Provinces', description: 'Ambitious governors and short tempers. Can you hold a kingdom together?', patch: { rebelliousness: 0.9, aiAggression: 0.4, startingTreasury: 3500 } },
];
