/**
 * Name pools for procedurally generated characters, armies and minor places. OWNER: Creative Director.
 * Fictional Sanskrit/Prakrit-style personal names (DESIGN_SPEC §3.6). Deliberately avoids the names of
 * famous historical or epic figures so generated characters never impersonate real people (GDD §7, §14).
 * Pools differ by region for flavor - every realm still draws from a shared, plausible stock.
 */
import type { FactionArchetype } from '../core/types';

/** Shared pools used by the baseline sim (`PERSON_NAMES[gender]`). Keep the export shape. */
export const PERSON_NAMES = {
  male: ['Aditya', 'Bhadra', 'Chandraketu', 'Devadatta', 'Govindapala', 'Harshadeva', 'Indrasena', 'Jayanta', 'Kirtivarman', 'Madhava', 'Nandivardhana', 'Pushpaka', 'Rudrasena', 'Sudatta', 'Upendra', 'Vikramasena', 'Yashovarman', 'Shatananda', 'Dhruvasena', 'Mahendrapala', 'Ravidatta', 'Vasudeva', 'Somadatta', 'Bhanugupta'],
  female: ['Ambalika', 'Bhanumati', 'Chitralekha', 'Devasena', 'Gauri', 'Indumati', 'Kumudini', 'Lilavati', 'Madhavi', 'Nandini', 'Padmavati', 'Rohini', 'Sumana', 'Tara', 'Uttara', 'Vasanti', 'Yashodevi', 'Sumitra', 'Mallika', 'Prabhavati', 'Kamala', 'Sharmila', 'Vishaka', 'Chandrika'],
} as const;

/** Regional flavor pools (sim may prefer these for a faction's generated characters). */
export const NAME_POOLS: Readonly<Record<FactionArchetype, { male: readonly string[]; female: readonly string[] }>> = {
  imperial_heartland: {
    male: ['Aditya', 'Devadatta', 'Harshadeva', 'Kirtivarman', 'Mahendrapala', 'Vikramasena', 'Yashovarman', 'Ravidatta', 'Somadatta', 'Bhanugupta'],
    female: ['Bhanumati', 'Chitralekha', 'Indumati', 'Lilavati', 'Padmavati', 'Prabhavati', 'Vasanti', 'Yashodevi', 'Chandrika', 'Kamala'],
  },
  highland_confederacy: {
    male: ['Girisena', 'Shailadeva', 'Vindhyasena', 'Durgapala', 'Kandarpa', 'Shilaketu', 'Parvataka', 'Ugradeva', 'Tungabhadra', 'Ajeyasena'],
    female: ['Girija', 'Shailaja', 'Megharani', 'Durgavati', 'Shilavati', 'Kandari', 'Vindhyavati', 'Parvatika', 'Ketaki', 'Nirmala'],
  },
  forest_kingdoms: {
    male: ['Vanapala', 'Shyamadeva', 'Nilaketu', 'Gajendra', 'Aranyaka', 'Saladeva', 'Tamaraka', 'Kesara', 'Madhuka', 'Patalika'],
    female: ['Shyamala', 'Nilambari', 'Vanamala', 'Kadambari', 'Saluki', 'Madhavika', 'Tamala', 'Champaka', 'Ketaki', 'Mrinalini'],
  },
  frontier_principalities: {
    male: ['Virasimha', 'Marusena', 'Lavanadeva', 'Ushtrapala', 'Dhanvaketu', 'Ranadhira', 'Ashvapati', 'Hayasena', 'Tejapala', 'Simhadatta'],
    female: ['Marudevi', 'Lavanya', 'Rajashri', 'Hamsavati', 'Ranavati', 'Tejasvini', 'Ashvini', 'Simhika', 'Dhanvika', 'Viravati'],
  },
  maritime_league: {
    male: ['Samudradatta', 'Nauka', 'Potaka', 'Varunasena', 'Ratnakara', 'Sagarapala', 'Tirthaka', 'Mitravarman', 'Dhanadatta', 'Vanijaka'],
    female: ['Samudrika', 'Sagarika', 'Ratnavali', 'Mitravinda', 'Varuni', 'Dhanashri', 'Tarangini', 'Kalindi', 'Naukavati', 'Lakshmika'],
  },
  fortified_city_states: {
    male: ['Kotapala', 'Nagaradatta', 'Shilpaka', 'Vastupala', 'Dvarapala', 'Prakarasena', 'Gopuraka', 'Sthapati', 'Kosharaja', 'Durjayapala'],
    female: ['Nagarika', 'Kotavati', 'Shilpavati', 'Vastumati', 'Prakarika', 'Dvaravati', 'Koshavati', 'Sthapatika', 'Gopuri', 'Durgika'],
  },
};

export const TITLES = {
  ruler: ['Raja', 'Rani', 'Maharaja', 'Maharani'],
  /** Only for a faction that has reached the Samrajya Age. */
  emperor: ['Samraj', 'Samrajni'],
  general: ['Senapati', 'Nayaka', 'Dandanayaka'],
  governor: ['Kumara', 'Rajuka', 'Mahamatra'],
  minister: ['Mantri', 'Amatya'],
} as const;

export const DYNASTY_NAMES = ['House of Suvarna', 'Clan of the Seven Peaks', 'House of the Blue Grove', 'Line of the Salt Wells', 'House of the Twin Waves', 'House of the Gate Tower', 'House of the Lotus', 'House of the River', 'Line of the Morning Star', 'House of the Banyan'] as const;

/** {adj} = faction adjective, {place} = settlement name, {cmd} = commander name. */
export const ARMY_NAME_PATTERNS = ['{adj} Host', '{adj} Vanguard', 'Army of {place}', '{place} Levy', '{adj} Riders', 'Guard of {place}', 'Host of {cmd}', '{adj} Wardens'] as const;

/** Formation names: {class} = unit name, {n} = ordinal, {place} = recruitment settlement. */
export const FORMATION_NAME_PATTERNS = ['{place} {class}', '{n} {class}', '{class} of {place}'] as const;

export const ORDINALS = ['First', 'Second', 'Third', 'Fourth', 'Fifth', 'Sixth', 'Seventh', 'Eighth', 'Ninth', 'Tenth'] as const;

/** Parts for procedural minor place names (hamlets, fords, battle sites): prefix + suffix. */
export const PLACE_NAME_PARTS = {
  prefixes: ['Ratna', 'Dhanya', 'Kusuma', 'Shila', 'Giri', 'Vana', 'Nila', 'Lavana', 'Tira', 'Setu', 'Kanaka', 'Amra', 'Vata', 'Padma', 'Gaja', 'Ashva'],
  suffixes: ['pura', 'gram', 'pali', 'ghat', 'durga', 'vasa', 'kshetra', 'vati', 'kunda', 'tirtha'],
} as const;
