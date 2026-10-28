/**
 * Name pools for procedurally generated characters, armies and minor places. OWNER: Creative Director.
 * Placeholder lists by the CTO - review for regional diversity and period plausibility (GDD §14).
 */
export const PERSON_NAMES = {
  male: ['Aditya', 'Bhadra', 'Chandra', 'Devadatta', 'Govinda', 'Harsha', 'Indrasena', 'Jayanta', 'Kirti', 'Madhava', 'Nanda', 'Pradyota', 'Rudra', 'Somadeva', 'Upendra', 'Vikrama', 'Yashodhara', 'Shatananda', 'Ajatashatru', 'Dhruva'],
  female: ['Amrapali', 'Bhanumati', 'Chitralekha', 'Damayanti', 'Gargi', 'Indumati', 'Kumudini', 'Lilavati', 'Madhavi', 'Nandini', 'Padmavati', 'Rohini', 'Sanghamitra', 'Tara', 'Uttara', 'Vasavadatta', 'Yashoda', 'Sumitra', 'Mallika', 'Prabhavati'],
} as const;

export const TITLES = {
  ruler: ['Samraj', 'Raja', 'Rani', 'Maharaja'],
  general: ['Senapati', 'Nayaka'],
  governor: ['Kumara', 'Rajuka', 'Mahamatra'],
} as const;

export const DYNASTY_NAMES = ['House of Suvarna', 'Clan of the High Forts', 'House of the Lotus', 'House of the River', 'Line of the Sun'] as const;

export const ARMY_NAME_PATTERNS = ['{adj} Host', '{adj} Vanguard', 'Army of {place}', '{place} Levy', '{adj} Riders', 'Guard of {place}'] as const;
