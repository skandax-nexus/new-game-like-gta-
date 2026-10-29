/**
 * Hero exploration content (GDD §3: limited hero mode for missions, negotiations and local inspection).
 * OWNER: Creative Director. Specified in docs/DESIGN_SPEC.md §11. Feel reference: close-up cinematic
 * fidelity and a small, weighty melee set (light/heavy combo, dodge-roll with i-frames, block/parry,
 * stamina, hit-stop + shake + impact VFX) used ONLY in a few missions - explicitly not a full action game.
 *
 * Conventions:
 *  - District anchors are polar around the settlement centre: `angle` uses the facing convention
 *    (dir = (sin a, cos a); 0 = +Z south, PI/2 = +X east, PI = north, 3PI/2 = west); `radius` is a fraction
 *    of the settlement radius (capital 200 m). Rajapura's river side is WEST (the Kanakavati) and SOUTH.
 *  - Clues: knowing clue X == world event flag `clue_X` is set (persists in saves; usable in Conditions).
 *    Inspectables set it on first inspect; dialogue choices may set it via effects.
 *  - Dialogue nodes `win` / `lose` in negotiation trees are jumped to by the scene when the stance crosses
 *    NegotiationProfile.winAt / loseAt (or patience runs out). Choices with effects are one-shot per
 *    campaign (the scene records flag `dlg_<treeId>_<choiceId>`).
 *  - Mission effects are applied with the player scope (faction = player, settlement = mission settlement).
 */
import type {
  CinematicShotDef,
  DialogueChoiceDef,
  DialogueNodeDef,
  DialogueTreeDef,
  FactionId,
  HeroCharacterDef,
  HeroCombatConfig,
  HeroDistrictDef,
  HeroEnemyDef,
  HeroMissionDef,
  NegotiationProfile,
  NegotiationTactic,
} from '../core/types';
import { NEGOTIATION_TACTICS } from '../core/types';
import { addC, addF, addS, all, character, chronicle, dayAtLeast, flagSet, mulS, not, PLAYER, setFlag, settlement, trigger } from './dsl';

const RAJAPURA = settlement('rajapura');
const HEIR = character('char_heir');
const BC = flagSet('bc_act');

// =====================================================================================================
// Districts (hero map anchors + mood). Rajapura: 7 districts. Tirthaghat: 2 (duel set piece).
// =====================================================================================================

export const HERO_DISTRICTS: readonly HeroDistrictDef[] = [
  {
    id: 'd_rajaghat', settlementId: 'rajapura', name: 'Rajaghat', localName: 'The Royal Ghats',
    description: 'Wide stone steps down to the Kanakavati where the royal barges land, pilgrims bathe at dawn and the late king\'s pyre burned nine days ago. Mist on the water until the sun clears the city wall.',
    angle: 4.95, radius: 0.95, architecture: ['ghat', 'chhatri', 'shrine', 'pavilion'], crowd: 0.7, mood: 'dawn_mist', ambience: ['river_lap', 'temple_bells_far', 'boatmen_calls', 'crows'],
    inspectables: [
      { id: 'insp_pyre_steps', label: 'The pyre steps', kind: 'ghat', text: 'Ash still marks the lowest step. The priests say the river takes a king in nine days; the court says it takes longer.', clue: null, effects: [] },
      { id: 'insp_royal_barge', label: 'The royal barge', kind: 'ghat', text: 'Saffron awnings, a carved makara prow, and oarsmen who have not been paid since the funeral.', clue: null, effects: [] },
    ],
    historicity: 'reconstruction', sourceNote: 'River ghats as civic/ritual space; stylized.',
  },
  {
    id: 'd_granary', settlementId: 'rajapura', name: 'Dhanyakoshtha', localName: 'The Granary Quarter',
    description: 'Raised brick granaries on stilts, threshing floors and weighing yards between the river landing and the bazaar. Dust and husk hang in the slanting light; scribes count every sack twice.',
    angle: 5.55, radius: 0.72, architecture: ['granary', 'workshop', 'market_stall'], crowd: 0.5, mood: 'noon_haze', ambience: ['threshing', 'scribes_counting', 'oxcarts'],
    inspectables: [
      { id: 'insp_granary_bins', label: 'Inspect the granary bins', kind: 'granary', text: 'Half the bins are empty and the other half hold last year\'s rice, weevils and all. The treasurer\'s tally on the door says every bin is full.', clue: 'empty_granary', effects: [] },
      { id: 'insp_weighing_yard', label: 'The weighing yard', kind: 'workshop', text: 'Brass weights stamped with the risen sun. Two of them are lighter than they should be.', clue: null, effects: [] },
    ],
    historicity: 'reconstruction', sourceNote: 'Raised granaries are attested archaeologically; layout stylized.',
  },
  {
    id: 'd_bazaar', settlementId: 'rajapura', name: 'Vipani', localName: 'The Great Bazaar',
    description: 'A long street of stalls under cloth awnings - cotton, copper, spices, palm-leaf scribes - opening onto the city well. Golden dust at evening, crowds at every hour, and rumours cheaper than salt.',
    angle: 0.25, radius: 0.45, architecture: ['market_stall', 'brick_house', 'well', 'mansion'], crowd: 1, mood: 'golden_dust', ambience: ['bazaar_crowd', 'hawkers', 'copper_beaten', 'cart_bells'],
    inspectables: [
      { id: 'insp_merchant_ledger', label: 'The grain merchants\' ledger', kind: 'market_stall', text: 'Columns of grain bought after the harvest and never sold - warehoused under the house mark of Lady Utpala, waiting for spring prices.', clue: 'hoarded_grain', effects: [] },
      { id: 'insp_city_well', label: 'Listen at the city well', kind: 'well', text: '"The regent\'s boy walked the ghats this morning." "Walking won\'t fill a pot." "Devavarman\'s men were paying for drinks again."', clue: null, effects: [] },
    ],
    historicity: 'reconstruction',
  },
  {
    id: 'd_temple', settlementId: 'rajapura', name: 'Devalaya', localName: 'The Temple Precinct',
    description: 'A sandstone temple tower above a stepped tank, lamps and incense in the inner hall, carved pillars weathered green with monsoon moss. The quietest place in the city - and the best for being overheard.',
    angle: 0.95, radius: 0.65, architecture: ['shikhara_temple', 'shrine', 'stepwell', 'pillar'], crowd: 0.6, mood: 'incense_dim', ambience: ['temple_bells', 'chanting_low', 'water_drip'],
    inspectables: [
      { id: 'insp_vow_inscription', label: 'Read the vow inscription', kind: 'pillar', text: 'Fresh-cut letters beside the stepwell: the late Maharaja\'s gift to the temple "on behalf of my son Aditya, who shall keep this house after me." Dated the month before his death.', clue: 'temple_vow', effects: [] },
      { id: 'insp_temple_stepwell', label: 'Descend the stepwell', kind: 'stepwell', text: 'Ninety steps down, the water is low and green. The old women who fetch it count the steps aloud.', clue: null, effects: [] },
    ],
    historicity: 'reconstruction', sourceNote: 'Shikhara form is a later style used for visual identity (flagged in buildings.ts).',
  },
  {
    id: 'd_palace', settlementId: 'rajapura', name: 'Rajaprasada', localName: 'The Palace Citadel',
    description: 'The citadel on the city\'s high northern ground: brick walls, a gate of carved teak, courtyards of chhatris and the Hall of Pillars where the court sits. Polished floors throw back lamplight; every pillar hides a listener.',
    angle: 3.14, radius: 0.55, architecture: ['palace', 'pavilion', 'chhatri', 'pillar', 'fort_wall'], crowd: 0.3, mood: 'golden_dust', ambience: ['court_murmur', 'fountain', 'conch_far'],
    inspectables: [
      { id: 'insp_edict_pillar', label: 'Read the edict pillar', kind: 'pillar', text: 'Your grandfather\'s treaty with the hill clans: the tolls of the Setu Bridge shared "for as long as the river runs." Your uncle\'s letters call it a forgery.', clue: 'old_treaty', effects: [] },
      { id: 'insp_hall', label: 'The Hall of Pillars', kind: 'palace', text: 'A hundred polished pillars and one empty throne. The nobles stand by house: swords, silver, temple and fields.', clue: null, effects: [] },
    ],
    historicity: 'reconstruction', sourceNote: 'Pillared halls are archaeologically attested; this palace is fictional.',
  },
  {
    id: 'd_barracks', settlementId: 'rajapura', name: 'Shastrashala', localName: 'The Arms Yard and Elephant Lines',
    description: 'Drill grounds, armouries and the elephant lines by the west wall. Dust, drums and the smell of fodder; the guard trains here at first light.',
    angle: 3.95, radius: 0.75, architecture: ['barracks', 'stable', 'tower'], crowd: 0.4, mood: 'noon_haze', ambience: ['drill_drums', 'elephant_rumble', 'blades_clash'],
    inspectables: [
      { id: 'insp_elephant_lines', label: 'The elephant lines', kind: 'stable', text: 'Eight war elephants of the Royal Corps, painted for the funeral. The mahouts say two of them have not eaten properly since the king died.', clue: null, effects: [] },
      { id: 'insp_armoury', label: 'The armoury', kind: 'barracks', text: 'Bamboo bows, scale coats and racks of spears - and a ledger showing that Prince Devavarman drew forty swords last month.', clue: null, effects: [] },
    ],
    historicity: 'reconstruction',
  },
  {
    id: 'd_artisans', settlementId: 'rajapura', name: 'Shilpivithi', localName: 'The Artisans\' Lane',
    description: 'Potters\' wheels, dye vats and weavers\' looms in a lane of mud-brick houses east of the bazaar. Children everywhere; bright cloth drying on every roof.',
    angle: 1.75, radius: 0.7, architecture: ['workshop', 'mud_house', 'brick_house', 'thatch_hut'], crowd: 0.6, mood: 'golden_dust', ambience: ['potters_wheel', 'looms', 'children'],
    inspectables: [
      { id: 'insp_dye_vats', label: 'The dye vats', kind: 'workshop', text: 'Indigo and madder. The dyers say the river merchants have stopped buying since the king died - nobody spends in an uncertain year.', clue: null, effects: [] },
    ],
    historicity: 'reconstruction',
  },
  {
    id: 'd_tirtha_ghats', settlementId: 'tirthaghat', name: 'The Pilgrim Ghats', localName: 'Tirthaghat',
    description: 'A crescent of stepped ghats on the Rajavahini, shrines on every landing, the oath stone half in the water. At dawn the mist lies waist-deep and the bells answer each other across the river. Sacred, neutral ground.',
    angle: 0.2, radius: 1, architecture: ['ghat', 'shrine', 'chhatri', 'pillar'], crowd: 0.5, mood: 'dawn_mist', ambience: ['river_wide', 'temple_bells', 'conch', 'chanting_far'],
    inspectables: [
      { id: 'insp_oath_stone', label: 'The oath stone', kind: 'shrine', text: 'A black stone worn smooth by hands. Oaths sworn on the water here have been kept, the priests say, for three hundred years.', clue: null, effects: [] },
    ],
    historicity: 'fictional',
  },
  {
    id: 'd_tirtha_temple', settlementId: 'tirthaghat', name: 'The River Temple', localName: 'Tirthaghat',
    description: 'A temple of bells above the ghats where the priests keep the records of oaths. Its stair overlooks the dueling ground in the shallows.',
    angle: 3.3, radius: 0.35, architecture: ['shikhara_temple', 'shrine', 'pavilion'], crowd: 0.4, mood: 'incense_dim', ambience: ['temple_bells', 'chanting_low'],
    inspectables: [
      { id: 'insp_oath_records', label: 'The oath records', kind: 'shikhara_temple', text: 'Palm-leaf bundles tied with coloured thread: treaties, marriages and duels, each with the river\'s name as witness.', clue: null, effects: [] },
    ],
    historicity: 'fictional',
  },
];

// =====================================================================================================
// Negotiation rules (DESIGN_SPEC §11.5). The scene applies these; NegotiationProfile tunes each person.
// =====================================================================================================

export const NEGOTIATION_RULES = {
  /** Stance change of a neutral argument. */
  baseDelta: 12,
  strongMultiplier: 2,
  weakMultiplier: 0.5,
  /** Stance change of a tactic in `backfires` (replaces the base delta). */
  backfireDelta: -15,
  revealHit: 30,
  revealMiss: -10,
  /** Repeating the previous tactic multiplies a positive delta by this. */
  repeatMultiplier: 0.5,
  /** Positive deltas gain hero diplomacy skill x this. */
  diplomacyBonusPerPoint: 0.5,
  /** A group objective (persuade N of M) fails once more than M - N members are lost. */
  groupFailsWhenUnreachable: true,
} as const;

export const TACTIC_INFO: Readonly<Record<NegotiationTactic, { name: string; icon: string; hint: string }>> = {
  duty: { name: 'Duty', icon: 'wheel', hint: 'Appeal to oaths, law and dharma.' },
  gain: { name: 'Gain', icon: 'coins', hint: 'Offer land, silver, tolls or office.' },
  strength: { name: 'Strength', icon: 'sword', hint: 'Show power - or threaten it.' },
  kinship: { name: 'Kinship', icon: 'lotus', hint: 'Speak of family, soil and shared memory.' },
  reveal: { name: 'Reveal', icon: 'eye', hint: 'Use something you discovered in the city (needs a clue).' },
};

/** Groups referenced by objectives with target `group:<id>`. */
export const HERO_GROUPS: Readonly<Record<string, readonly string[]>> = {
  court_nobles: ['hc_kirtisena', 'hc_utpala', 'hc_somapala', 'hc_bhavadeva'],
};

/** Hero avatar per playable faction (hero mode from the world map or main menu). */
export const HERO_AVATARS: Readonly<Record<FactionId, string>> = {
  heartland: 'hc_aditya',
  highland: 'hc_meghavati',
};

// =====================================================================================================
// Dialogue helpers
// =====================================================================================================

const say = (id: string, speaker: string, text: string, choices: DialogueChoiceDef[] = []): DialogueNodeDef => ({ id, speaker, text, choices });
const go = (id: string, label: string, next: string | null, extra: Partial<DialogueChoiceDef> = {}): DialogueChoiceDef => ({ id, label, next, tactic: null, requires: null, requiresClue: null, effects: [], startsMission: null, ...extra });
const tree = (id: string, start: string, nodes: DialogueNodeDef[]): DialogueTreeDef => ({ id, start, nodes: Object.fromEntries(nodes.map((n) => [n.id, n])) });

type TacticLines = Record<NegotiationTactic, { label: string; reply: string }>;

/** Negotiation tree: start + one reply node per tactic (each offering every tactic again) + win/lose. */
function negotiationTree(id: string, speaker: string, intro: string, lines: TacticLines, revealClue: string, win: string, lose: string): DialogueTreeDef {
  const tactics = (): DialogueChoiceDef[] => [
    ...NEGOTIATION_TACTICS.map((t) => go(`t_${t}`, lines[t].label, `r_${t}`, { tactic: t, requiresClue: t === 'reveal' ? revealClue : null })),
    go('leave', 'Take your leave', null),
  ];
  return tree(id, 'start', [
    say('start', speaker, intro, tactics()),
    ...NEGOTIATION_TACTICS.map((t) => say(`r_${t}`, speaker, lines[t].reply, tactics())),
    say('win', speaker, win),
    say('lose', speaker, lose),
  ]);
}

const neg = (p: Partial<NegotiationProfile> & Pick<NegotiationProfile, 'strongVs' | 'weakVs' | 'backfires' | 'revealClues'>): NegotiationProfile => ({
  startStance: 40,
  patience: 5,
  winAt: 70,
  loseAt: 15,
  onSuccess: [],
  onFailure: [],
  ...p,
});

// =====================================================================================================
// Dialogue trees
// =====================================================================================================

export const DIALOGUES: Readonly<Record<string, DialogueTreeDef>> = Object.fromEntries(
  [
    tree('dlg_vasumati', 'start', [
      say('start', 'hc_vasumati', 'Aditya. You walked through the city? Good. Then you saw it: the empty granaries, the queues, the soldiers watching each other.', [
        go('ask_court', 'How do I win the court?', 'court'),
        go('ask_uncle', 'What does my uncle want?', 'uncle'),
        go('leave', 'I will return, mother.', null),
      ]),
      say('court', 'hc_vasumati', 'Four houses decide the Hall: Kirtisena\'s swords, Utpala\'s silver, Somapala\'s temple and Bhavadeva\'s fields. Win three and your uncle has nothing. Learn what each of them wants - the city will tell you, if you listen.', [
        go('begin_hall', 'I am ready to face the Hall.', null, { startsMission: 'hm_hall_of_pillars' }),
        go('back', 'Not yet.', 'start'),
      ]),
      say('uncle', 'hc_vasumati', 'Everything your father had, and the war your father never fought. He is clever, Aditya, and he is patient. Do not be either of those things in front of him - be honest. He has no answer for that.', [go('back', 'I understand.', 'start')]),
    ]),
    tree('dlg_haridatta', 'start', [
      say('start', 'hc_haridatta', 'The arithmetic of a kingdom, Kumara: twenty-four thousand mouths, ninety days of grain, four months to the winter harvest. The arithmetic does not care who sits on the throne.', [
        go('advice', 'What would you do?', 'advice'),
        go('leave', 'Thank you, Mantri.', null),
      ]),
      say('advice', 'hc_haridatta', 'Buy grain now, while the merchants still believe in the regency. In spring they will not - and then you will have to take it, and the farmers will remember.', [go('leave', 'I will remember.', null)]),
    ]),
    tree('dlg_lakshmidhara', 'start', [
      say('start', 'hc_lakshmidhara', 'Kumara! The granaries are in perfect order. Perfect. As my tally shows.', [
        go('leave', 'Carry on, treasurer.', null),
        go('confront', 'Your tally says the bins are full. I have just walked through them.', 'confess', { requiresClue: 'empty_granary' }),
      ]),
      say('confess', 'hc_lakshmidhara', 'The tally may be... optimistic. Some silver went to keep certain lords comfortable in a difficult season. I can return it. Quietly.', [
        go('take_silver', 'Return it. Quietly.', null, { effects: [addF(PLAYER, 'treasury', 600), addC(character('char_kosha'), 'loyalty', -0.1), setFlag('treasurer_exposed')] }),
        go('expose', 'No. You will confess it to the regent.', null, { effects: [addF(PLAYER, 'treasury', 600), addF(PLAYER, 'legitimacy', 0.02), addC(character('char_kosha'), 'loyalty', -0.3), setFlag('treasurer_exposed'), chronicle('The royal treasurer confessed to falsifying the granary tallies.')] }),
      ]),
    ]),
    tree('dlg_pushkala', 'start', [
      say('start', 'hc_pushkala', 'The bins? Half full, my prince, and that half is last year\'s rice with weevils in it. Don\'t tell the treasurer I said so - he counts with his eyes shut.', [go('leave', 'Your secret is safe.', null, { effects: [setFlag('clue_empty_granary')] })]),
    ]),
    tree('dlg_bhadrasena', 'start', [
      say('start', 'hc_bhadrasena', 'Kumara. Your father could split a coconut on a spear-point at a gallop. Can you?', [
        go('train', 'Teach me.', null, { startsMission: 'hm_training_yard' }),
        go('army', 'How is the army?', 'army'),
        go('leave', 'Another day, Senapati.', null),
      ]),
      say('army', 'hc_bhadrasena', 'Loyal - today. The Household of Devavarman drills in Ratnapura every morning where everyone can see. That is a message, Kumara. Answer it before the army has to.', [go('leave', 'I will.', null)]),
    ]),
    tree('dlg_ugrasena', 'start', [
      say('start', 'hc_ugrasena', 'Block high, roll low, and never stand where an elephant wants to be. When you are ready, the yard is ready.', [go('leave', 'Understood, captain.', null)]),
    ]),
    tree('dlg_nilambari', 'start', [
      say('start', 'hc_nilambari', 'Walk with me, Kumara - slowly, as if we were buying cloth.', [
        go('news', 'What have you heard?', 'news'),
        go('leave', 'Another time.', null),
      ]),
      say('news', 'hc_nilambari', 'Grain barges come down the Kanakavati after the harvest. Someone is paying Marudeshi blades to wait for them at the royal ghat at dusk. Someone with a prince\'s seal.', [
        go('ambush', 'Then we will be waiting too.', null, { startsMission: 'hm_ambush_ghat' }),
        go('later', 'Keep watching.', null),
      ]),
    ]),
    tree('dlg_devavarman', 'start', [
      say('start', 'hc_devavarman', 'Nephew. Come to count the votes? Count carefully - some of them are mine, and the rest are for sale.', [
        go('kneel', 'Kneel to the crown, uncle, and keep Ratnapura.', 'kneel'),
        go('seal', 'I found your seal ring on a dead man at the ghat.', 'seal', { requiresClue: 'seal_ring', effects: [addC(character('char_claimant'), 'loyalty', -0.1)] }),
        go('leave', 'Good day, uncle.', null),
      ]),
      say('kneel', 'hc_devavarman', 'Kneel? To a regent\'s son who has never seen a battle? Win the Hall, Aditya, and perhaps I will. Lose it and I will be generous to your mother.', [go('leave', 'We will see.', null)]),
      say('seal', 'hc_devavarman', '...You have your father\'s eyes, and his bad timing. Rings are stolen every day in this city. Take care on the ghats at night, nephew.', [go('leave', 'You too, uncle.', null)]),
    ]),
    tree('dlg_vedavrata', 'start', [
      say('start', 'hc_vedavrata', 'The inscription by the stepwell, Kumara - have you read it? Your father was not a sentimental man, but he was a careful one. He wrote things down.', [go('leave', 'I will read it.', null)]),
    ]),
    tree('dlg_kevala', 'start', [
      say('start', 'hc_kevala', 'Barges? I see them all, my prince. Three came down yesterday with no flags. Their crews had swords under the rice sacks and paid for nothing in the bazaar.', [go('leave', 'Keep your eyes open, boatman.', null)]),
    ]),
    tree('dlg_ratnakara', 'start', [
      say('start', 'hc_ratnakara', 'The guild of grain merchants serves the city, Kumara. At a fair profit, naturally.', [
        go('leave', 'Naturally.', null),
        go('hoard', 'Your guild\'s warehouses are full while the city queues. Open them.', 'open', { requiresClue: 'hoarded_grain', effects: [addF(PLAYER, 'foodReserve', 2000), mulS(RAJAPURA, 'grainPrice', 0.9)] }),
      ]),
      say('open', 'hc_ratnakara', '...The guild has always been the crown\'s loyal servant. The warehouses will open at dawn - at the old price.', [go('leave', 'At dawn.', null)]),
    ]),
    tree('dlg_gomati', 'start', [
      say('start', 'hc_gomati', 'My prince, I walked four days from Dhanyagram with this petition. Will anyone at court read it?', [
        go('read', 'I will read it.', 'petition', { effects: [setFlag('clue_farmers_petition')] }),
        go('leave', 'Give it to the scribes.', null),
      ]),
      say('petition', 'hc_gomati', 'We ask for seed grain for the winter sowing and relief from the requisition. Not charity, my prince - seed. Give us seed and we will feed your city.', [go('leave', 'You will have an answer.', null)]),
    ]),
    tree('dlg_durjaya', 'start', [
      say('start', 'hc_durjaya', 'So the plains send their prince. Good. I was afraid they would send their treasurer.', [
        go('duel', 'Let us begin.', null, { startsMission: 'hm_duel_oath' }),
        go('leave', 'Not yet.', null),
      ]),
    ]),
    tree('dlg_meghavati', 'start', [
      say('start', 'hc_meghavati', 'You came. My father said you would send a letter instead.', [
        go('why', 'Why this custom?', 'why'),
        go('leave', 'I will not keep your champion waiting.', null),
      ]),
      say('why', 'hc_meghavati', 'Because a man who will stand in the river for an oath will keep it on dry land too. And because Durjaya would never forgive us if he did not get to try.', [go('leave', 'Then let him try.', null)]),
    ]),
    tree('dlg_tirthapala', 'start', [
      say('start', 'hc_tirthapala', 'This is sacred ground, Kumara. Whatever is decided here is sworn on the water - and the water remembers.', [go('leave', 'I will remember too.', null)]),
    ]),
    negotiationTree('dlg_kirtisena', 'hc_kirtisena', 'Kumara. They say you can barely hold a sword, let alone a kingdom.', {
      duty: { label: 'You swore your sword to the Suvarna crown, not to my uncle.', reply: 'I swore to a king. Show me one.' },
      gain: { label: 'Stand with me and the southern command is yours.', reply: 'A bribe. Your uncle offers better ones.' },
      strength: { label: 'I will take the bridge back from the hill clans this season. Ride with me.', reply: '...Now that is a prince talking.' },
      kinship: { label: 'My father called you brother.', reply: 'Your father is ash on the river. Do not hide behind him.' },
      reveal: { label: 'Read the edict pillar: my grandfather shared the bridge tolls with the clans. Devavarman means to sell the bridge again for their help.', reply: '...He would trade our bridge for a crown? Then he is no soldier.' },
    }, 'old_treaty', 'I will stand behind you in the Hall. Do not make me regret it.', 'Come back when you have bled for something.'),
    negotiationTree('dlg_utpala', 'hc_utpala', 'Prince Aditya. Have you come to buy my vote, or to beg for it?', {
      duty: { label: 'The realm needs its great houses now.', reply: 'The realm needs many things. Which of them pays?' },
      gain: { label: 'Back the regency and the river tolls of Naukapattana pass through your warehouses.', reply: 'Now we are speaking the same language.' },
      strength: { label: 'Remember whose soldiers guard your caravans.', reply: 'Threats. How very like your uncle.' },
      kinship: { label: 'Our grandmothers were sisters, Lady Utpala.', reply: 'Spare me the family trees, Kumara.' },
      reveal: { label: 'Your warehouses are full of grain while the city queues for bread. The merchants\' ledger says so.', reply: '...What do you want?' },
    }, 'hoarded_grain', 'Very well. My house stands with the regency - and my granaries open at fair prices.', 'We are done, I think.'),
    negotiationTree('dlg_somapala', 'hc_somapala', 'The gods do not choose kings, Kumara. Men do - badly.', {
      duty: { label: 'A king serves dharma, not his appetite. My uncle serves his.', reply: 'Hm. Words are cheap in the Hall, but those are good words.' },
      gain: { label: 'The crown will endow a new hall for the temple.', reply: 'You think piety is for sale? Your uncle thought so too.' },
      strength: { label: 'The army is with me.', reply: 'Then why do you need me? Go and count your spears.' },
      kinship: { label: 'You blessed my naming, Lord Somapala.', reply: 'I did. You cried through the whole thing.' },
      reveal: { label: 'The vow inscribed at the temple: my father named me heir before the gods, a month before he died.', reply: '...You have read it. Then the gods have spoken, and so will I.' },
    }, 'temple_vow', 'The temple will speak for you.', 'Go with the gods, Kumara. Alone.'),
    negotiationTree('dlg_bhavadeva', 'hc_bhavadeva', 'My fields in Dhanyakshetra are dust and my tenants are hungry. What will your crown do about that?', {
      duty: { label: 'It is your duty to stand with the crown.', reply: 'Duty? Go and tell my tenants about duty.' },
      gain: { label: 'The crown will forgive Dhanyakshetra\'s grain tax for a season.', reply: 'That is a start.' },
      strength: { label: 'The army will protect your fields from raiders.', reply: 'From raiders, yes. From hunger?' },
      kinship: { label: 'My grandmother was born on your estates. We are of one soil.', reply: '...She was. A good woman. Go on.' },
      reveal: { label: 'Gomati of Dhanyagram gave me the farmers\' petition. They ask for seed grain, not soldiers. They will have it.', reply: 'Then you have listened to them, which is more than anyone at court has done.' },
    }, 'farmers_petition', 'My house stands with you, Kumara.', 'I will look after my own fields, then.'),
  ].map((t) => [t.id, t]),
);

// =====================================================================================================
// Characters
// =====================================================================================================

type HeroCharInput = Omit<HeroCharacterDef, 'historicity' | 'negotiation' | 'barks' | 'characterId' | 'dialogueId'> &
  Partial<Pick<HeroCharacterDef, 'negotiation' | 'barks' | 'characterId' | 'dialogueId'>>;
const H = (c: HeroCharInput): HeroCharacterDef => ({ historicity: 'fictional', negotiation: null, barks: [], characterId: null, dialogueId: null, ...c });

export const HERO_CHARACTERS: readonly HeroCharacterDef[] = [
  // --- Avatars ---
  H({ id: 'hc_aditya', name: 'Kumara Aditya', title: 'Heir of Suvarna', role: 'You. Nineteen, brave, reckless - and the only person in Rajapura who has not yet chosen a side.', characterId: 'char_heir', settlementId: 'rajapura', districtId: 'd_rajaghat', appearance: { silhouette: 'noble', garment: '#e0801f', accent: '#f2cf63', headgear: 'turban', prop: 'sword', scale: 1.02 }, traits: ['brave', 'reckless', 'charismatic'], interest: 'power' }),
  H({ id: 'hc_meghavati', name: 'Kumari Meghavati', title: 'Daughter of the Seven Peaks', role: 'Envoy of the hill clans and their raja\'s heir; quick, honest and more patient than her father.', characterId: 'char_giri_kumari', settlementId: 'tirthaghat', districtId: 'd_tirtha_ghats', appearance: { silhouette: 'envoy', garment: '#2c4fa3', accent: '#e9b949', headgear: 'veil', prop: 'staff', scale: 0.97 }, traits: ['diplomat', 'charismatic', 'just'], interest: 'family', dialogueId: 'dlg_meghavati', barks: ['The mist lifts at the third bell.', 'Durjaya has not lost in seven years.'] }),
  // --- The court of Rajapura ---
  H({ id: 'hc_vasumati', name: 'Rani Vasumati', title: 'Regent of Suvarna', role: 'Your mother. Holds the seal and the treasury keys; trusts the Mantri, fears the Treasurer, and has not slept since the funeral.', characterId: 'char_regent', settlementId: 'rajapura', districtId: 'd_palace', appearance: { silhouette: 'noble', garment: '#f4efe6', accent: '#7a1f1f', headgear: 'veil', prop: 'scroll', scale: 0.96 }, traits: ['shrewd', 'administrator', 'cautious'], interest: 'family', dialogueId: 'dlg_vasumati' }),
  H({ id: 'hc_haridatta', name: 'Mantri Haridatta', title: 'Chief Minister', role: 'Old, dry and usually right. Thinks in measures of grain and months to harvest.', characterId: 'char_mantri', settlementId: 'rajapura', districtId: 'd_palace', appearance: { silhouette: 'scholar', garment: '#d8c9a3', accent: '#5a4632', headgear: 'topknot', prop: 'ledger', scale: 0.98 }, traits: ['scholarly', 'shrewd'], interest: 'learning', dialogueId: 'dlg_haridatta', barks: ['Ninety days. Perhaps eighty.', 'Arithmetic, Kumara, not omens.'] }),
  H({ id: 'hc_lakshmidhara', name: 'Lakshmidhara', title: 'Royal Treasurer', role: 'Keeps the tallies and some of the silver. Nervous around anyone who can count.', characterId: 'char_kosha', settlementId: 'rajapura', districtId: 'd_granary', appearance: { silhouette: 'merchant', garment: '#c9a227', accent: '#3b2a1a', headgear: 'turban', prop: 'ledger', scale: 1.05 }, traits: ['greedy', 'administrator'], interest: 'wealth', dialogueId: 'dlg_lakshmidhara', barks: ['Perfect order. Perfect.', 'The tally is the tally.'] }),
  H({ id: 'hc_bhadrasena', name: 'Senapati Bhadrasena', title: 'Commander of the Royal Host', role: 'Your father\'s general. Loyal to the crown, impatient with the court, fond of you in a way he will never admit.', characterId: 'char_senapati', settlementId: 'rajapura', districtId: 'd_barracks', appearance: { silhouette: 'warrior', garment: '#7a1f1f', accent: '#c0c0c0', headgear: 'helmet', prop: 'spear', scale: 1.06 }, traits: ['strategist', 'loyal'], interest: 'land', dialogueId: 'dlg_bhadrasena', barks: ['Shields up! Again!', 'Your father was faster. Older, too.'] }),
  H({ id: 'hc_ugrasena', name: 'Ugrasena', title: 'Captain of the Palace Guard', role: 'Your sparring master. Scarred, cheerful and merciless in the yard.', settlementId: 'rajapura', districtId: 'd_barracks', appearance: { silhouette: 'guard', garment: '#8a3324', accent: '#d4af37', headgear: 'helmet', prop: 'sword', scale: 1.08 }, traits: ['brave', 'loyal', 'robust'], interest: 'power', dialogueId: 'dlg_ugrasena', barks: ['Block high, roll low!', 'Again, Kumara. Slower is faster.'] }),
  H({ id: 'hc_nilambari', name: 'Charini Nilambari', title: 'Spymaster', role: 'The regent\'s eyes in the bazaar. Dresses like a cloth-seller; is not one.', characterId: 'char_spymaster', settlementId: 'rajapura', districtId: 'd_bazaar', appearance: { silhouette: 'merchant', garment: '#3d4f7c', accent: '#b5835a', headgear: 'veil', prop: 'basket', scale: 0.95 }, traits: ['shrewd', 'loyal'], interest: 'power', dialogueId: 'dlg_nilambari', barks: ['Fine cotton, my lord? No? Pity.', 'Walk slowly. People are watching.'] }),
  H({ id: 'hc_devavarman', name: 'Prince Devavarman', title: 'Governor of Ratnadesha', role: 'Your uncle and the claimant. Charming, patient, and certain the crown should have been his.', characterId: 'char_claimant', settlementId: 'rajapura', districtId: 'd_palace', appearance: { silhouette: 'noble', garment: '#4b2a5c', accent: '#e9b949', headgear: 'crown', prop: 'none', scale: 1.03 }, traits: ['ambitious', 'scheming', 'charismatic'], interest: 'power', dialogueId: 'dlg_devavarman', barks: ['Nephew.', 'The Hall is so much larger without your father in it.'] }),
  H({ id: 'hc_vedavrata', name: 'Acharya Vedavrata', title: 'Court Scholar', role: 'Keeper of the temple records and of most of the court\'s secrets.', characterId: 'char_scholar', settlementId: 'rajapura', districtId: 'd_temple', appearance: { silhouette: 'priest', garment: '#f1e3c6', accent: '#c96f2d', headgear: 'topknot', prop: 'scroll', scale: 0.97 }, traits: ['devout', 'scholarly', 'just'], interest: 'faith', dialogueId: 'dlg_vedavrata' }),
  // --- The four great houses (Hall of Pillars negotiation) ---
  H({ id: 'hc_kirtisena', name: 'Lord Kirtisena', title: 'House of Swords', role: 'Commands the city cavalry. Wants a king who will fight - and a share of the glory.', settlementId: 'rajapura', districtId: 'd_palace', appearance: { silhouette: 'warrior', garment: '#5c1f1f', accent: '#c0c0c0', headgear: 'helmet', prop: 'sword', scale: 1.05 }, traits: ['brave', 'ambitious'], interest: 'power', dialogueId: 'dlg_kirtisena', negotiation: neg({ startStance: 40, strongVs: ['strength', 'duty'], weakVs: ['gain'], backfires: ['kinship'], revealClues: ['old_treaty'], onSuccess: [setFlag('noble_kirtisena')], onFailure: [] }) }),
  H({ id: 'hc_utpala', name: 'Lady Utpala', title: 'House of Silver', role: 'Grain-merchant dynasty and moneylender to half the court. Wants profit - and to be asked, not told.', settlementId: 'rajapura', districtId: 'd_palace', appearance: { silhouette: 'noble', garment: '#1f6f5c', accent: '#f2cf63', headgear: 'veil', prop: 'ledger', scale: 0.95 }, traits: ['greedy', 'shrewd'], interest: 'wealth', dialogueId: 'dlg_utpala', negotiation: neg({ startStance: 35, strongVs: ['gain'], weakVs: ['duty', 'kinship'], backfires: ['strength'], revealClues: ['hoarded_grain'], onSuccess: [setFlag('noble_utpala'), addF(PLAYER, 'foodReserve', 1500)], onFailure: [] }) }),
  H({ id: 'hc_somapala', name: 'Lord Somapala', title: 'House of the Temple', role: 'Patron of the great temple. Wants a just king, and proof the gods agree.', settlementId: 'rajapura', districtId: 'd_palace', appearance: { silhouette: 'priest', garment: '#e8d9b5', accent: '#a0522d', headgear: 'turban', prop: 'lamp', scale: 1 }, traits: ['devout', 'just'], interest: 'faith', dialogueId: 'dlg_somapala', negotiation: neg({ startStance: 50, strongVs: ['duty'], weakVs: ['gain'], backfires: ['strength'], revealClues: ['temple_vow'], onSuccess: [setFlag('noble_somapala')], onFailure: [] }) }),
  H({ id: 'hc_bhavadeva', name: 'Lord Bhavadeva', title: 'House of the Fields', role: 'Old landholder of Dhanyakshetra. Wants his tenants fed and his family respected.', settlementId: 'rajapura', districtId: 'd_palace', appearance: { silhouette: 'farmer', garment: '#7c6a3c', accent: '#d9c27a', headgear: 'turban', prop: 'staff', scale: 0.98 }, traits: ['cautious', 'content'], interest: 'land', dialogueId: 'dlg_bhavadeva', negotiation: neg({ startStance: 45, strongVs: ['kinship', 'gain'], weakVs: ['strength'], backfires: ['duty'], revealClues: ['farmers_petition'], onSuccess: [setFlag('noble_bhavadeva')], onFailure: [] }) }),
  // --- The city ---
  H({ id: 'hc_pushkala', name: 'Pushkala', title: 'Granary-keeper', role: 'Has kept the royal granaries for thirty years and the treasurer\'s secrets for three.', settlementId: 'rajapura', districtId: 'd_granary', appearance: { silhouette: 'farmer', garment: '#a67c52', accent: '#efe3c8', headgear: 'veil', prop: 'basket', scale: 0.9 }, traits: ['loyal', 'shrewd'], interest: 'family', dialogueId: 'dlg_pushkala', barks: ['Mind the weevils, my prince.', 'Thirty years and never a full bin in a bad year.'] }),
  H({ id: 'hc_kevala', name: 'Kevala', title: 'Boatman of the Royal Ghat', role: 'Sees every barge on the river and is paid by none of them.', settlementId: 'rajapura', districtId: 'd_rajaghat', appearance: { silhouette: 'farmer', garment: '#6b8e9e', accent: '#e8e0d0', headgear: 'none', prop: 'staff', scale: 0.98 }, traits: ['content'], interest: 'wealth', dialogueId: 'dlg_kevala', barks: ['Across, my lord? Two coppers.', 'The river is low this year.'] }),
  H({ id: 'hc_ratnakara', name: 'Sreshthi Ratnakara', title: 'Head of the Grain Guild', role: 'Speaks for the merchants of the bazaar - and for their warehouses.', settlementId: 'rajapura', districtId: 'd_bazaar', appearance: { silhouette: 'merchant', garment: '#b5651d', accent: '#f2cf63', headgear: 'turban', prop: 'ledger', scale: 1.04 }, traits: ['greedy', 'shrewd'], interest: 'wealth', dialogueId: 'dlg_ratnakara', barks: ['A fair price is a happy city.', 'Supply, my prince, and demand.'] }),
  H({ id: 'hc_gomati', name: 'Gomati', title: 'Headwoman of Dhanyagram', role: 'Walked four days with a petition from the grain villages.', settlementId: 'rajapura', districtId: 'd_bazaar', appearance: { silhouette: 'farmer', garment: '#8f7a4a', accent: '#c94f2c', headgear: 'veil', prop: 'scroll', scale: 0.93 }, traits: ['just', 'robust'], interest: 'land', dialogueId: 'dlg_gomati', barks: ['Seed, not charity.', 'Four days on foot, and the scribes say come back tomorrow.'] }),
  H({ id: 'hc_kumbha', name: 'Kumbha', title: 'Potter', role: 'Makes the city\'s water jars and opinions.', settlementId: 'rajapura', districtId: 'd_artisans', appearance: { silhouette: 'farmer', garment: '#9c5a3c', accent: '#e8d2b0', headgear: 'none', prop: 'basket', scale: 0.97 }, traits: ['content'], interest: 'family', barks: ['Nobody buys jars in a year like this.', 'The prince! Mind the clay, my prince.'] }),
  H({ id: 'hc_gajaratha', name: 'Gajaratha', title: 'Mahout of the Royal Corps', role: 'Talks to elephants more than to people, and prefers it.', settlementId: 'rajapura', districtId: 'd_barracks', appearance: { silhouette: 'farmer', garment: '#5d6b3a', accent: '#d9a441', headgear: 'turban', prop: 'staff', scale: 0.95 }, traits: ['loyal'], interest: 'land', barks: ['Easy, easy, my beauty.', 'She has not eaten since the funeral.'] }),
  // --- Tirthaghat (duel) ---
  H({ id: 'hc_durjaya', name: 'Vira Durjaya', title: 'Champion of the Seven Peaks', role: 'The hill clans\' champion. Seven years unbeaten; fights barefoot in the shallows with a curved blade and a round shield.', characterId: 'char_giri_champion', settlementId: 'tirthaghat', districtId: 'd_tirtha_ghats', appearance: { silhouette: 'warrior', garment: '#2c4fa3', accent: '#e9b949', headgear: 'none', prop: 'sword', scale: 1.1 }, traits: ['brave', 'reckless', 'robust'], interest: 'power', dialogueId: 'dlg_durjaya', barks: ['The river is cold, plainsman. Wake up.', 'Again!'] }),
  H({ id: 'hc_tirthapala', name: 'Acharya Tirthapala', title: 'Keeper of Oaths', role: 'High priest of Tirthaghat; witness to every oath sworn on the water.', settlementId: 'tirthaghat', districtId: 'd_tirtha_temple', appearance: { silhouette: 'priest', garment: '#f6efe0', accent: '#c96f2d', headgear: 'topknot', prop: 'lamp', scale: 0.95 }, traits: ['devout', 'just'], interest: 'faith', dialogueId: 'dlg_tirthapala' }),
];

// =====================================================================================================
// Combat (DESIGN_SPEC §11.7). Frame data in seconds; damage in hero HP points.
// =====================================================================================================

export const HERO_COMBAT: HeroCombatConfig = {
  hp: 400,
  stamina: 100,
  staminaRegenPerSec: 30,
  staminaRegenDelaySec: 0.6,
  lightCombo: [
    { id: 'light_1', input: 'light', damage: 18, poiseDamage: 10, staminaCost: 12, startupSec: 0.12, activeSec: 0.08, recoverySec: 0.3, cancelAfterSec: 0.22, hitStopMs: 45, shake: 0.03, lunge: 0.6, vfx: 'slash_spark' },
    { id: 'light_2', input: 'light', damage: 20, poiseDamage: 12, staminaCost: 12, startupSec: 0.1, activeSec: 0.08, recoverySec: 0.32, cancelAfterSec: 0.22, hitStopMs: 50, shake: 0.035, lunge: 0.5, vfx: 'slash_spark' },
    { id: 'light_3', input: 'light', damage: 34, poiseDamage: 25, staminaCost: 18, startupSec: 0.18, activeSec: 0.12, recoverySec: 0.55, cancelAfterSec: 0.4, hitStopMs: 90, shake: 0.08, lunge: 1.2, vfx: 'finisher_burst' },
  ],
  heavy: {
    min: { id: 'heavy_min', input: 'heavy (tap)', damage: 30, poiseDamage: 30, staminaCost: 20, startupSec: 0.35, activeSec: 0.1, recoverySec: 0.6, cancelAfterSec: 0.5, hitStopMs: 80, shake: 0.07, lunge: 0.8, vfx: 'heavy_dust' },
    max: { id: 'heavy_max', input: 'heavy (hold 0.9 s)', damage: 70, poiseDamage: 70, staminaCost: 30, startupSec: 0.25, activeSec: 0.12, recoverySec: 0.7, cancelAfterSec: 0.6, hitStopMs: 140, shake: 0.14, lunge: 1.6, vfx: 'heavy_dust' },
    chargeSec: 0.9,
  },
  dodge: { durationSec: 0.55, iframeStartSec: 0.05, iframeEndSec: 0.35, distance: 4.5, staminaCost: 20, perfectWindowSec: 0.12, perfectSlowMoSec: 0.6, perfectTimeScale: 0.35 },
  block: { damageReduction: 0.75, staminaPerDamage: 0.6, regenWhileBlocking: 0.3, guardBreakStaggerSec: 1.2 },
  parry: { windowSec: 0.18, staggerSec: 1.4, ripostMultiplier: 2.5, hitStopMs: 120, shake: 0.06 },
  remedy: { charges: 3, heal: 160, durationSec: 1.2 },
  lockOn: { range: 14, coneRad: 1.2 },
  hitStunSec: 0.35,
  camera: { exploreDistance: 4.2, combatDistance: 5.5, height: 1.65, shoulder: 0.55, fovExplore: 50, fovCombat: 58 },
};

export const HERO_ENEMIES: readonly HeroEnemyDef[] = [
  { id: 'he_swordsman', name: 'Hired Blade', archetype: 'swordsman', hp: 90, poise: 30, damage: { light: 14, heavy: 26, unblockable: 0 }, attackInterval: 2.2, moveSpeed: 3.2, telegraphSec: 0.5, phases: [] },
  { id: 'he_spearman', name: 'Raider Spearman', archetype: 'spearman', hp: 100, poise: 35, damage: { light: 12, heavy: 28, unblockable: 0 }, attackInterval: 2.6, moveSpeed: 3, telegraphSec: 0.6, phases: [] },
  { id: 'he_archer', name: 'Raider Archer', archetype: 'archer', hp: 60, poise: 15, damage: { light: 16, heavy: 0, unblockable: 0 }, attackInterval: 3, moveSpeed: 3.4, telegraphSec: 0.7, phases: [] },
  { id: 'he_captain', name: 'Raider Captain', archetype: 'captain', hp: 260, poise: 80, damage: { light: 18, heavy: 34, unblockable: 45 }, attackInterval: 1.8, moveSpeed: 3.4, telegraphSec: 0.55, phases: [0.5] },
  { id: 'he_champion', name: 'Vira Durjaya', archetype: 'champion', hp: 520, poise: 140, damage: { light: 20, heavy: 40, unblockable: 60 }, attackInterval: 1.5, moveSpeed: 3.8, telegraphSec: 0.5, phases: [0.66, 0.33] },
  { id: 'he_sparring', name: 'Ugrasena (sparring)', archetype: 'captain', hp: 200, poise: 60, damage: { light: 8, heavy: 16, unblockable: 0 }, attackInterval: 2.4, moveSpeed: 3, telegraphSec: 0.8, phases: [] },
];

/** Training-yard tutorial sequence (hm_training_yard). `done` names the hero-controller event that completes the step. */
export const TRAINING_STEPS: readonly { id: string; prompt: string; touchPrompt: string; done: 'light_combo' | 'heavy_full' | 'dodge' | 'perfect_dodge' | 'block' | 'parry' | 'lock_on' | 'remedy' | 'defeat' }[] = [
  { id: 'ts_lock', prompt: 'Lock on to Ugrasena (middle mouse / Tab).', touchPrompt: 'Tap Ugrasena to lock on.', done: 'lock_on' },
  { id: 'ts_light', prompt: 'Land a full three-strike combo (left mouse x3).', touchPrompt: 'Tap ATTACK three times.', done: 'light_combo' },
  { id: 'ts_heavy', prompt: 'Hold heavy attack until the blade glows, then release (right mouse).', touchPrompt: 'Hold HEAVY until the blade glows, then release.', done: 'heavy_full' },
  { id: 'ts_block', prompt: 'Block a strike (hold Q).', touchPrompt: 'Hold GUARD as he strikes.', done: 'block' },
  { id: 'ts_parry', prompt: 'Parry: press block just as the strike lands.', touchPrompt: 'Tap GUARD just as the strike lands.', done: 'parry' },
  { id: 'ts_dodge', prompt: 'Roll through an attack (Space).', touchPrompt: 'Swipe or tap ROLL.', done: 'dodge' },
  { id: 'ts_perfect', prompt: 'Roll at the last moment for a perfect dodge (time slows).', touchPrompt: 'ROLL at the last moment.', done: 'perfect_dodge' },
  { id: 'ts_remedy', prompt: 'Drink a salve to heal (R).', touchPrompt: 'Tap the SALVE flask.', done: 'remedy' },
  { id: 'ts_defeat', prompt: 'Now beat him.', touchPrompt: 'Now beat him.', done: 'defeat' },
];

// =====================================================================================================
// Missions
// =====================================================================================================

const shot = (id: string, camera: CinematicShotDef['camera'], subject: string, durationSec: number, hour: number, mood: CinematicShotDef['mood'], line: string | null, playerControl = false): CinematicShotDef => ({ id, durationSec, camera, subject, hour, mood, line, playerControl });

export const HERO_MISSIONS: readonly HeroMissionDef[] = [
  {
    id: 'hm_homecoming',
    title: 'The Walk to the Hall',
    kind: 'cinematic',
    settlementId: 'rajapura',
    description: 'Dawn, nine days after the king\'s pyre. Kumara Aditya steps off the royal barge and walks through his city to the palace - past the ghats, the granaries and the bazaar - and sees for himself what the court will not tell him.',
    availability: all(BC, not(flagSet('homecoming_done'))),
    startDistrict: 'd_rajaghat',
    hour: 6.2,
    objectives: [
      { id: 'o_reach_palace', kind: 'reach', label: 'Walk to the palace gate', target: 'd_palace', count: 1, optional: false },
      { id: 'o_granary', kind: 'inspect', label: 'Look into the granaries', target: 'insp_granary_bins', count: 1, optional: true },
      { id: 'o_bazaar', kind: 'talk', label: 'Hear the headwoman of Dhanyagram', target: 'hc_gomati', count: 1, optional: true },
      { id: 'o_mother', kind: 'talk', label: 'Speak with the regent', target: 'hc_vasumati', count: 1, optional: false },
    ],
    waves: [],
    cinematic: [
      shot('c1', 'aerial', 'kanaka_confluence', 6, 6.0, 'dawn_mist', 'Rajapura. Nine days since the king\'s pyre burned on these steps.'),
      shot('c2', 'crane_down', 'd_rajaghat', 5, 6.05, 'dawn_mist', 'The river does not mourn. It carries grain, and pilgrims, and kings.'),
      shot('c3', 'tracking_behind', 'hc_aditya', 5, 6.1, 'dawn_mist', null),
      shot('c4', 'steadicam_side', 'hc_aditya', 90, 6.2, 'dawn_mist', null, true),
      shot('c5', 'low_angle', 'd_temple', 4, 6.8, 'golden_dust', null),
      shot('c6', 'over_shoulder', 'd_palace', 4, 7.0, 'golden_dust', 'The Hall of Pillars. Whoever holds it holds the crown.'),
      shot('c7', 'close_up', 'hc_vasumati', 4, 7.1, 'golden_dust', 'You are late, my son. The court is not.'),
    ],
    timeLimitSec: null,
    onSuccess: [setFlag('homecoming_done'), addF(PLAYER, 'legitimacy', 0.02), chronicle('Kumara Aditya walked through Rajapura at dawn, and the city saw its prince.')],
    onFailure: [],
    retryable: true,
    historicity: 'fictional',
  },
  {
    id: 'hm_hall_of_pillars',
    title: 'The Hall of Pillars',
    kind: 'negotiation',
    settlementId: 'rajapura',
    description: 'The four great houses wait in the Hall: swords, silver, temple and fields. Win three and Prince Devavarman\'s faction collapses. Arguments are stronger with proof - what did you see in the city?',
    availability: all(flagSet('homecoming_done'), not(flagSet('succession_resolved')), not(flagSet('court_won')), not(flagSet('court_lost'))),
    startDistrict: 'd_palace',
    hour: 10,
    objectives: [
      { id: 'o_persuade', kind: 'persuade', label: 'Win three of the four great houses', target: 'group:court_nobles', count: 3, optional: false },
      { id: 'o_uncle', kind: 'talk', label: 'Face Prince Devavarman', target: 'hc_devavarman', count: 1, optional: true },
    ],
    waves: [],
    cinematic: [
      shot('h1', 'orbit', 'd_palace', 6, 10, 'golden_dust', 'A hundred pillars, and one empty throne.'),
      shot('h2', 'close_up', 'hc_devavarman', 3, 10, 'golden_dust', 'Nephew. Count carefully.'),
    ],
    timeLimitSec: null,
    onSuccess: [setFlag('court_won'), addF(PLAYER, 'legitimacy', 0.05), chronicle('Three of the four great houses declared for Kumara Aditya in the Hall of Pillars.')],
    onFailure: [setFlag('court_lost'), addF(PLAYER, 'stability', -0.03)],
    retryable: false,
    historicity: 'fictional',
  },
  {
    id: 'hm_training_yard',
    title: 'The Arms Yard',
    kind: 'training',
    settlementId: 'rajapura',
    description: 'Captain Ugrasena of the palace guard has agreed to spar with the prince - with blunted blades and no mercy. Learn the strikes, the guard, the parry and the roll.',
    availability: all(flagSet('homecoming_done'), not(flagSet('training_done'))),
    startDistrict: 'd_barracks',
    hour: 16.5,
    objectives: [{ id: 'o_spar', kind: 'defeat', label: 'Best Ugrasena in the yard', target: 'he_sparring', count: 1, optional: false }],
    waves: [{ id: 'w_spar', enemies: [{ enemy: 'he_sparring', count: 1 }], delaySec: 0, spawn: 'd_barracks' }],
    cinematic: [shot('t1', 'orbit', 'd_barracks', 4, 16.5, 'golden_dust', 'Blunted blades. Sharp lessons.')],
    timeLimitSec: null,
    onSuccess: [setFlag('training_done'), addC(HEIR, 'prestige', 5)],
    onFailure: [],
    retryable: true,
    historicity: 'fictional',
  },
  {
    id: 'hm_ambush_ghat',
    title: 'Blades at the Royal Ghat',
    kind: 'combat',
    settlementId: 'rajapura',
    description: 'Dusk at the royal ghat. Grain barges are unloading - and the spymaster says hired blades are hidden among the rice sacks. Protect the grain carts and find out who paid for this.',
    availability: all(BC, flagSet('homecoming_done'), dayAtLeast(50), not(flagSet('ambush_done'))),
    startDistrict: 'd_rajaghat',
    hour: 18.6,
    objectives: [
      { id: 'o_carts', kind: 'protect', label: 'Keep at least two of the three grain carts', target: 'grain_carts', count: 2, optional: false },
      { id: 'o_waves', kind: 'defeat', label: 'Defeat the raider captain', target: 'w_captain', count: 1, optional: false },
      { id: 'o_seal', kind: 'inspect', label: 'Search the captain', target: 'insp_captain_body', count: 1, optional: true },
    ],
    waves: [
      { id: 'w_blades', enemies: [{ enemy: 'he_swordsman', count: 4 }, { enemy: 'he_spearman', count: 2 }], delaySec: 0, spawn: 'd_rajaghat' },
      { id: 'w_granary', enemies: [{ enemy: 'he_spearman', count: 3 }, { enemy: 'he_archer', count: 3 }], delaySec: 4, spawn: 'd_granary' },
      { id: 'w_captain', enemies: [{ enemy: 'he_captain', count: 1 }, { enemy: 'he_swordsman', count: 2 }], delaySec: 6, spawn: 'd_rajaghat' },
    ],
    cinematic: [
      shot('a1', 'aerial', 'd_rajaghat', 4, 18.5, 'golden_dust', 'Dusk. The barges come in low with grain.'),
      shot('a2', 'low_angle', 'd_rajaghat', 3, 18.55, 'golden_dust', null),
      shot('a3', 'close_up', 'hc_aditya', 2, 18.6, 'golden_dust', 'Under the rice sacks - swords.'),
    ],
    timeLimitSec: null,
    onSuccess: [setFlag('ambush_done'), setFlag('seal_ring'), setFlag('clue_seal_ring'), addF(PLAYER, 'foodReserve', 1500), addC(HEIR, 'prestige', 10), chronicle('Kumara Aditya fought off hired blades at the royal ghat; the captain wore Prince Devavarman\'s seal.')],
    onFailure: [setFlag('ambush_done'), addF(PLAYER, 'foodReserve', -1000), addS(RAJAPURA, 'unrest', 0.05)],
    retryable: true,
    historicity: 'fictional',
  },
  {
    id: 'hm_duel_oath',
    title: 'Duel at the Oath Stone',
    kind: 'duel',
    settlementId: 'tirthaghat',
    description: 'Dawn mist on the sacred ghats of Tirthaghat. By the custom of the hills, Kumara Aditya must stand in the river against Vira Durjaya, champion of the seven clans, seven years unbeaten. Kumari Meghavati watches from the temple stair.',
    availability: all(flagSet('duel_accepted'), not(flagSet('duel_done'))),
    startDistrict: 'd_tirtha_ghats',
    hour: 5.9,
    objectives: [{ id: 'o_duel', kind: 'duel', label: 'Defeat Vira Durjaya', target: 'he_champion', count: 1, optional: false }],
    waves: [{ id: 'w_duel', enemies: [{ enemy: 'he_champion', count: 1 }], delaySec: 0, spawn: 'd_tirtha_ghats' }],
    cinematic: [
      shot('d1', 'aerial', 'd_tirtha_ghats', 5, 5.8, 'dawn_mist', 'Tirthaghat. Sacred ground. What is sworn here is kept.'),
      shot('d2', 'crane_down', 'hc_meghavati', 4, 5.85, 'dawn_mist', null),
      shot('d3', 'low_angle', 'hc_durjaya', 4, 5.9, 'dawn_mist', 'The river is cold, plainsman. Wake up.'),
      shot('d4', 'orbit', 'hc_aditya', 4, 5.9, 'dawn_mist', null),
    ],
    timeLimitSec: null,
    onSuccess: [setFlag('duel_done'), setFlag('duel_won'), addC(HEIR, 'prestige', 20), trigger('evt_bc_duel_aftermath', 0)],
    onFailure: [setFlag('duel_done'), setFlag('duel_lost'), trigger('evt_bc_duel_lost', 0)],
    retryable: true,
    historicity: 'fictional',
  },
];

/** Mission-only inspectables (spawned by the mission, not part of a district). */
export const MISSION_INSPECTABLES: readonly { id: string; missionId: string; label: string; text: string; clue: string | null }[] = [
  { id: 'insp_captain_body', missionId: 'hm_ambush_ghat', label: 'Search the captain', text: 'Under the captain\'s jerkin, on a cord: a gold seal ring cut with a lotus and a crown. Prince Devavarman\'s seal.', clue: 'seal_ring' },
];

export function getHeroMission(id: string): HeroMissionDef | undefined {
  return HERO_MISSIONS.find((m) => m.id === id);
}

export function getHeroCharacter(id: string): HeroCharacterDef | undefined {
  return HERO_CHARACTERS.find((c) => c.id === id);
}
