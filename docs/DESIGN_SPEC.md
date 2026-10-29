# SAMRAJYA: Echoes of Bharat - Design Specification (MVP)

Owner: **Creative Director**. Status: **v1 - implementable**. Intent comes from `docs/GDD.md` (source of truth
for *what* and *why*); this document is the source of truth for *how much, when and in what order*.
Engineering contracts: `src/core/types.ts`, `src/app/contracts.ts`, `docs/ARCHITECTURE.md`.
Content: `src/data/**` (every number below that names a data symbol is authoritative in that file).

> **One-line pitch.** Hold a river kingdom together through a broken succession and a lean year - with
> grain, words or the sword - then walk its streets in person when only a prince's presence will do.

---

## Contents

0. [How to read this document](#0-how-to-read-this-document)
1. [Vision, pillars and reference games](#1-vision-pillars-and-reference-games)
2. [Core loop and the three perspectives](#2-core-loop-and-the-three-perspectives)
3. [The MVP region: The River of Kings](#3-the-mvp-region-the-river-of-kings)
4. [Factions](#4-factions)
5. [Units](#5-units)
6. [Battlefield rules (field command)](#6-battlefield-rules-field-command)
7. [Strategic simulation (world command)](#7-strategic-simulation-world-command)
8. [The Age of Empires layer](#8-the-age-of-empires-layer)
9. [Campaign: The Broken Crown](#9-campaign-the-broken-crown)
10. [Skirmish, sandbox, difficulty and AI personalities](#10-skirmish-sandbox-difficulty-and-ai-personalities)
11. [Hero exploration](#11-hero-exploration)
12. [UX flows, tutorial and accessibility](#12-ux-flows-tutorial-and-accessibility)
13. [Balance targets and QA checks](#13-balance-targets-and-qa-checks)
14. [Implementation handoff](#14-implementation-handoff)
- [Appendix A - Glossary](#appendix-a---glossary)
- [Appendix B - Historical care](#appendix-b---historical-care)

---

## 0. How to read this document

### 0.1 Units and conventions

| Quantity | Unit | Notes |
|---|---|---|
| Distance | meters (m) | Strategic map meters are compressed: real distance = map m x `BALANCE.military.travelScale` (30). The 6,144 m region is ~184 km. |
| Time (battle) | seconds | 20 Hz fixed step (0.05 s). |
| Time (strategic) | game hours / days | 1 tick = 1 hour; 1 day = 2 s real at 1x; 1 month = 30 days = 60 s; 1 year = 12 min. |
| Angles | radians | Facing θ: forward = (sin θ, cos θ); θ = 0 faces +Z (south); +X east. |
| Money | **wealth** | Silver coin. Treasury, costs, upkeep. |
| Food | **grain measures** | 1 measure = rations for 10 person-days. A civilian eats 0.1/day; a soldier 0.15 (horse, elephant and ox fodder more). |
| Materials | timber **loads**, stone **blocks** | Faction stockpiles. |
| Work | **person-days** of labor | Building cost `labor`; builders supply person-days per day. |
| Ratios | 0..1 | Morale is 0..100; opinion -100..100; skills 0..20. |

Formula notation: `clamp(x, a, b)`, `clamp01(x)`, `U(a,b)` = uniform draw from the battle/world RNG (never
`Math.random`), `Σ` over owned items. "Per day" values are applied once at the day rollover; "per month" at
the month rollover. All formulas must use the deterministic math helpers (`core/math.ts`).

### 0.2 Where the numbers live

| Topic | Data symbol | File |
|---|---|---|
| Global tuning (economy, military, morale weights, combat scales, politics, diplomacy, espionage) | `BALANCE` | `src/data/balance.ts` |
| Design constants not in `BalanceConfig` (storage, harvest, prices, tax, trade, market, construction, supply, siege, rebellion ladder, diplomacy weights, battle shapes, victory, score) | `RULES` | `src/data/rules.ts` |
| Factions, heraldry, variants | `FACTIONS` | `src/data/factions.ts` |
| Unit classes | `UNITS` | `src/data/units.ts` |
| Buildings | `BUILDINGS` | `src/data/buildings.ts` |
| Ages and landmarks | `AGES`, `LANDMARKS` | `src/data/ages.ts` |
| Region, lore, map features | `REGION`, `SETTLEMENT_LORE`, `REGION_FEATURES` | `src/data/region.ts` |
| Scenarios, sandbox presets | `SCENARIOS`, `SANDBOX_PRESETS`, `SANDBOX_RANGES` | `src/data/campaign.ts` |
| Events | `EVENTS` | `src/data/events.ts` |
| Hero mode | `HERO_DISTRICTS`, `HERO_CHARACTERS`, `DIALOGUES`, `HERO_MISSIONS`, `HERO_COMBAT`, `HERO_ENEMIES` | `src/data/hero.ts` |
| Difficulty, AI personalities | `DIFFICULTY_DEFS`, `AI_PERSONALITY_DEFS` | `src/data/difficulty.ts` |
| Tutorial hints | `TUTORIAL_HINTS` | `src/data/tutorial.ts` |
| Skirmish options | `SKIRMISH_*` | `src/data/skirmish.ts` |
| Resource presentation | `RESOURCE_DISPLAY` | `src/data/resources.ts` |
| End-game statistics | `END_GAME_STATS` | `src/data/statistics.ts` |
| Names | `PERSON_NAMES`, `NAME_POOLS` | `src/data/names.ts` |
| DSL builders for conditions/effects | `all`, `flagSet`, `addF`, ... | `src/data/dsl.ts` |

`tests/data.test.ts` validates every reference in these files (ids, roads, events, dialogue graphs, flags) and
two economy design targets (§13.2). If you change a number here, change it in the data file - the data wins.

### 0.3 Status tags

- **[BASE]** the CTO baseline already behaves this way (keep it).
- **[REQ]** required for the MVP; the owner named in §14 implements it.
- **[STRETCH]** desirable, post-MVP or if time allows.

---

## 1. Vision, pillars and reference games

### 1.1 Pillars (GDD §1) as player-facing promises

| Pillar | Promise in the MVP | Where it shows |
|---|---|---|
| Living civilization | Every settlement has people, fields, granaries, water, loyalty and a mood you can read and visit. | §7.2, §8.3, §11 |
| Large-scale warfare | You command formations of 8-120 models, not soldiers; 1,000-5,000 on screen. | §5, §6 |
| Power beyond combat | Marriage, tribute, treaties, relief and a court negotiation win the campaign as surely as a siege. | §7.10, §9.6, §11.5 |
| Persistent consequences | Requisitions raise prices for months; burned bridges stay burned; a lost duel scars a prince. | §7.13, §9.5 |
| Historical care | Every authored item carries `historicity`; fictional realms, no villains by culture. | Appendix B |

### 1.2 Reference games: what we take, what we refuse

**Age of Empires (II DE / IV) -> the strategic and battle layers.**

| AoE element | SAMRAJYA equivalent | Spec |
|---|---|---|
| Food / wood / stone / gold | Grain / timber / stone / wealth (+ labor, recruits) | §8.1 |
| Villagers gathering and building | Settlement labor allocation; visible farmers, builders, carriers | §7.6, §8.3 |
| Building placement on a grid + scaffolding | 4 m settlement grid, footprints, foundation -> scaffolding -> roofing | §8.2 |
| Ages + civ landmarks | Janapada -> Mahajanapada -> Samrajya; two landmarks per faction per age | §8.4, §8.5 |
| Unique units / civ bonuses | Faction unit variants and modifiers | §4, §5.7 |
| Walls, gates, siege | Walls & Gates levels, rams/ladders/elephants, siege battles | §6.6.5, §8.6 |
| Minimap, control groups, idle hotkeys, command card | Same; QWERT/ASDFG/ZXCVB card | §8.7, §8.8 |
| Selection circles, health bars, readable silhouettes | Formation footprints, strength/morale bars, 9 silhouettes, team colors | §5.6, §6.13 |
| End-of-game statistics | Summary / military / economy / society / diplomacy + timelines | §8.9 |

Refused: unit-by-unit micromanagement (we command formations - GDD §5), resource nodes that deplete into
nothing (our land regrows; the scarce thing is *time and grain*), build-order races in the campaign.

**Black Myth: Wukong -> close-up fidelity and the hero.**

| Wukong element | SAMRAJYA equivalent | Spec |
|---|---|---|
| Dense, weathered materials; volumetric light through mist | Hero districts with mood presets (dawn mist ghats, incense temple, golden-dust bazaar) | §11.2 |
| A camera that frames the hero heroically | Third-person shoulder camera, cinematic shot list, lock-on framing | §11.3, §11.8 |
| Weighty melee: light/heavy, dodge-roll i-frames, block/parry, stamina, hit-stop, shake | A 3-hit combo, charged heavy, roll, guard, parry and salve - frame data in `HERO_COMBAT` | §11.7 |
| Set-piece duels | One champion duel at the Tirthaghat ghats; one ambush | §11.6 |

Refused (GDD §3 scope): skill trees, loot, equipment, open-world traversal between settlements, more than
three combat missions, boss rush. Hero mode is a *window into the strategy game*, not a second game.

### 1.3 MVP scope guardrails

One region (16 settlements), two playable factions + two AI minors in the campaign (+2 skirmish/sandbox-only),
9 unit classes, 21 building types, 3 ages, 16 landmarks, one two-act campaign + one alternate start, 51
events, 5 hero missions (2 of them with combat + 1 training), skirmish and sandbox. Anything else is
[STRETCH].

---

## 2. Core loop and the three perspectives

### 2.1 The loop (GDD §3) in minutes of play

```
  EXPLORE ---> DEVELOP ---> GOVERN ---> CAMPAIGN ---> ADAPT ---+
  scout map,   build, set    taxes,      march, supply, fight,   respond to prices,
  read lore,   labor, trade  governors,  negotiate, besiege      revolts, floods, rivals
  visit city                 court       (field command)         (events, council)
     ^                                                            |
     +------------------------------------------------------------+
```

Target rhythm at 1x speed: a meaningful decision every 20-40 s of world time (a building, a recruitment,
an army order, an event), a battle every 6-12 world minutes in war, a hero mission available roughly once per
act.

### 2.2 The three perspectives

| Perspective | Scene | Camera | Time | Player does | Leaves via |
|---|---|---|---|---|---|
| **World command** (strategic map, administration) | `world` | RTS 3/4 top-down, zoom 120 m - 6 km; close zoom shows settlements | 1 h per tick, pause, 0.5x-8x | Build, recruit, set labor/taxes, move armies, diplomacy, council, events | Engagement prompt -> Fight; settlement panel -> Visit; mission card |
| **Field command** (battles) | `battle` | RTS 3/4, zoom 15-700 m, cinematic close cams | 20 Hz, pause, 0.5x-4x (8x in skirmish) | Deploy, order formations, intent orders, commander rally | Results screen -> world/menu |
| **Hero exploration** (missions, negotiation, inspection) | `hero` | Third-person shoulder | Real time (world clock frozen) | Walk, inspect, talk, negotiate, fight (3 missions) | Exit prompt / mission end -> world |

### 2.3 Transitions (state machine)

```
            +-------------------- quit / defeat / victory ------------------------+
            v                                                                     |
 MENU --> WORLD --(contact)--> ENGAGEMENT PROMPT --Fight--> BATTLE --> RESULTS ---+--> WORLD
            |  ^                    |  Autoresolve (same rules, headless) ------> WORLD
            |  |                    |  Retreat (rearguard loss 10%, army falls back) WORLD
            |  +--- return ---------+
            +--(Visit / mission card)--> HERO --(exit / mission end)--> WORLD
 MENU --> SKIRMISH SETUP --> BATTLE --> RESULTS --> MENU
 MENU --> HERO (free exploration of the default capital; no missions) --> MENU
```

Rules:
1. **The world clock stops** while the player is in Battle or Hero. A field battle consumes exactly 1 game
   hour of world time when it resolves (`Engagement.startedHour + 1`); a hero mission consumes none.
2. **State that persists across a transition is authoritative and saved**: the `BattleState` of a world battle
   lives inside `world.engagements[id].battle` [BASE]; hero mission results are applied as effects at mission
   end (§11.9) and only then. Quitting a hero mission mid-way applies nothing.
3. **Autosave** on: entering a battle, leaving a battle, entering hero mode, each new month [BASE monthly].
4. Two engagements at once: the second waits in the prompt queue (oldest first); autoresolve all is offered
   when more than one is pending.

---

## 3. The MVP region: The River of Kings

### 3.1 Geography and GDD §2 zones

A 6,144 m (≈184 km at travel scale 30) square window of the procedural subcontinent, `REGION_SEED = 1337`.
The **Rajavahini** ("she who carries kings") flows west -> east across the middle (v ≈ 0.45-0.58) with fords;
the **Kanakavati** tributary comes down from the northern hills (u ≈ 0.33) and joins it south-west of
Rajapura. Rajapura stands on the east bank of the Kanakavati (water ≈280 m west) with the Rajavahini ≈500 m
south.

```
 u ->  0.0          0.2          0.4          0.6          0.8          1.0   (north at top)
 v 0.1 . . . dry hills . . . . . ridged hills . . . hills . . . . . forest . .
   0.3 [Lavanapura]  [Kusumpur]                [Ratnapura]          [Gajavana]
       salt flats          ~Kanakavati~                                  
   0.4      [Dhanyagram]   ~   [RAJAPURA]                       [Naukapattana]
   0.5 [Ushtragram] ~~~~~~~~~~ sangam ~~~~ [SETUPUR]=bridge ~~~ [Tirthaghat]~~ river mouth
   0.6             ~~~~ Rajavahini meanders, fords ~~~~~~~~~~~~~      [Nilavanapura]
   0.7 [Dvaradurga] plateau scarp   [Shilapur]                      forest
   0.8 [Pashanagram]  [GIRIDURG]                                    
   0.9 . . . . Deccan-like plateau . . . . [Kandaravasa] . . scrub . . forest . .
```

| GDD §2 zone | Where | Terrain (biomes) | Gameplay |
|---|---|---|---|
| Northern plains | Rajakshetra, Dhanyakshetra, Ratnadesha, Tira | farmland, floodplain, grassland | Grain, big towns, royal roads, recruitment, taxes |
| Western frontier | Dhanvadesha (u < 0.2) | dry plain, scrub | Salt road, wells, horses, raids; thin food |
| Deccan plateau | Dakshinagiri, Shilatala (south-west) | plateau, hills, rocky | Hill forts, stone and iron, upland millet, defensible passes |
| Eastern forests | Nilavana (u > 0.78) | forest, dense forest | Timber, elephants, spices; difficult terrain |
| Southern peninsula | not in the MVP region (the river mouth port hints at it) | - | [STRETCH] |

### 3.2 Provinces

| Province | Zone | Capital | Settlements | Fertility | Resources |
|---|---|---|---|---|---|
| Rajakshetra (`prov_rajakshetra`) | northern_plains | Rajapura | Rajapura | 0.9 | grain, rice, cotton |
| Dhanyakshetra (`prov_dhanyakshetra`) | northern_plains | Dhanyagram | Dhanyagram, Kusumpur | 0.95 | grain, cotton |
| Ratnadesha (`prov_ratnadesha`) | northern_plains | Ratnapura | Ratnapura, Naukapattana | 0.75 | cotton, gems, spices |
| Tira (`prov_tira`) | northern_plains | Setupur | Setupur, Tirthaghat | 0.95 | rice, grain |
| Dakshinagiri (`prov_dakshinagiri`) | deccan_plateau | Giridurg | Giridurg, Dvaradurga, Pashanagram | 0.5 | iron, stone, horses |
| Shilatala (`prov_shilatala`) | deccan_plateau | Shilapur | Shilapur, Kandaravasa | 0.65 | stone, copper, grain |
| Dhanvadesha (`prov_dhanvadesha`) | western_frontier | Lavanapura | Lavanapura, Ushtragram | 0.35 | salt, horses |
| Nilavana (`prov_nilavana`) | eastern_forests | Nilavanapura | Nilavanapura, Gajavana | 0.7 | timber, elephants, spices |

A province is owned by the owner of its capital settlement. Provinces with an owner but a different owner for
some members are **contested** (UI hatching on the border).

### 3.3 Settlements

16 settlements: 1 capital, 1 city, 3 towns, 3 forts, 6 villages, 1 port, 1 temple town. Positions are
normalized (u west->east, v north->south) and resolved to buildable sites by `core/terrain/sites.ts`.

| Settlement | Kind | Province | Owner | Pop | Site (u, v) | Fort | Resources | Starting buildings (level) |
|---|---|---|---|---|---|---|---|---|
| Rajapura | capital | Rajakshetra | Suvarna | 24,000 | riverside (0.40, 0.37) | 2 | grain, rice, cotton | Palace 1, Granary 2, Market 2, Barracks 2, Stables 1, Elephant Stables 1, Temple 2, Walls 2, Ghat 1, Farm Fields 3, Housing 3, Workshops 2, Drains & Wells 1 |
| Dhanyagram | village | Dhanyakshetra | Suvarna | 2,800 | plain (0.22, 0.40) | 0 | grain, cotton | Farm Fields 3, Granary 2, Village Tank 1 |
| Kusumpur | village | Dhanyakshetra | Suvarna | 2,400 | plain (0.28, 0.25) | 0 | grain | Farm Fields 3, Village Tank 1, Granary 1 |
| Ratnapura | town | Ratnadesha | Suvarna | 7,200 | plain (0.62, 0.31) | 1 | cotton, gems | Market 2, Workshops 2, Farm Fields 2, Housing 1, Temple 1, Road Station 1, Walls 1 |
| Setupur | fort | Tira | Suvarna | 2,200 | crossing (0.48, 0.53) | 1 | grain, timber | Walls 1, Barracks 1, Farm Fields 2, Watchtower 1 |
| Tirthaghat | temple town | Tira | independent | 6,000 | riverside (0.66, 0.56) | 0 | rice | Temple 3, Ghat 2, Stupa 1, Farm Fields 2, Market 1, Housing 2 |
| Naukapattana | port | Ratnadesha | independent | 5,200 | riverside (0.90, 0.41) | 1 | spices, salt | Harbor 2, Market 2, Granary 1, Workshops 1, Ghat 1, Walls 1, Farm Fields 1 |
| Giridurg | fort | Dakshinagiri | Giridurga | 6,000 | hilltop (0.23, 0.80) | 3 | iron, stone | Walls 2, Barracks 2, Stables 1, Stepwell 1, Granary 2, Temple 1, Mine 1, Housing 1, Workshops 1, Farm Fields 2 |
| Shilapur | town | Shilatala | Giridurga | 5,600 | plain (0.38, 0.72) | 1 | stone, copper | Workshops 1, Mine 2, Market 1, Farm Fields 3, Temple 1, Housing 1, Walls 1 |
| Dvaradurga | fort | Dakshinagiri | Giridurga | 2,400 | hilltop (0.12, 0.62) | 2 | stone, horses | Walls 2, Barracks 1, Watchtower 1, Village Tank 1, Farm Fields 2, Mine 1 |
| Pashanagram | village | Dakshinagiri | Giridurga | 1,600 | hilltop (0.09, 0.78) | 0 | horses | Farm Fields 2, Barracks 1, Stables 1, Village Tank 1 |
| Kandaravasa | village | Shilatala | Giridurga | 1,800 | plain (0.52, 0.86) | 0 | grain | Farm Fields 2, Village Tank 1 |
| Lavanapura | town | Dhanvadesha | Marudesha | 4,400 | plain (0.10, 0.28) | 1 | salt, horses | Market 2, Barracks 1, Stables 1, Village Tank 2, Walls 1, Farm Fields 3 |
| Ushtragram | village | Dhanvadesha | Marudesha | 1,300 | plain (0.08, 0.46) | 0 | salt | Village Tank 1, Farm Fields 2 |
| Nilavanapura | city | Nilavana | Nilavana | 9,500 | forest edge (0.85, 0.62) | 1 | timber, elephants, spices | Elephant Stables 1, Stables 1, Barracks 1, Temple 1, Market 1, Walls 1, Workshops 2, Farm Fields 3, Granary 1 |
| Gajavana | village | Nilavana | Nilavana | 1,400 | forest edge (0.88, 0.26) | 0 | elephants, timber | Farm Fields 2, Watchtower 1 |

Each settlement has an epithet, a two-sentence description and role tags in `SETTLEMENT_LORE` (UI header of the
settlement panel; hero mode loading card). Example: *Setupur - "The Bridge Fort": a fort and toll-house
guarding the only bridge over the Rajavahini.*

Settlement visual radius [BASE]: capital 200 m, city 150 m, town/fort/port/temple town 110 m, village 70 m.

### 3.4 Roads, crossings and chokepoints

22 roads (`REGION.roads`); the graph is connected (tested). Quality sets march speed (§7.7):
royal road 30 km/day, road 24, track 18, off-road 12.

| Settlement | Neighbours (road quality) |
|---|---|
| Rajapura | Ratnapura (royal), Setupur (royal), Kusumpur (road), Dhanyagram (road) |
| Dhanyagram | Rajapura (road), Lavanapura (road), Kusumpur (track) |
| Kusumpur | Rajapura (road), Dhanyagram (track) |
| Ratnapura | Rajapura (royal), Naukapattana (road), Gajavana (track), Tirthaghat (track) |
| Setupur | Rajapura (royal), Tirthaghat (road), Shilapur (road, **Setu Bridge**) |
| Tirthaghat | Setupur (road), Nilavanapura (road), Ratnapura (track, **Pilgrim Ford**) |
| Naukapattana | Ratnapura (road), Nilavanapura (road), Gajavana (track) |
| Gajavana | Ratnapura (track), Naukapattana (track) |
| Nilavanapura | Naukapattana (road), Tirthaghat (road), Kandaravasa (track) |
| Shilapur | Setupur (road), Giridurg (road), Kandaravasa (track), Dvaradurga (track) |
| Giridurg | Shilapur (road), Pashanagram (road) |
| Pashanagram | Giridurg (road), Dvaradurga (track) |
| Dvaradurga | Pashanagram (track), Shilapur (track), Ushtragram (track, **Dvara Pass**) |
| Kandaravasa | Shilapur (track), Nilavanapura (track) |
| Ushtragram | Dvaradurga (track), Lavanapura (track) |
| Lavanapura | Ushtragram (track), Dhanyagram (road) |

Whether a traced road crosses water is decided by the terrain (`traceRoad().crossesWater`): such an edge is a
**bridge** if its quality is road/royal road and a **ford** if it is a track [BASE].

Named crossings and features (`REGION_FEATURES`):

| Feature | Kind | Rule |
|---|---|---|
| The Setu Bridge (Setupur) | bridge | The only all-season crossing of the Rajavahini for carts and elephants. A bridge edge with condition < 0.3 is impassable for supply trains, elephants and chariots. |
| The Pilgrim Ford (Tirthaghat) | ford | Tracks that cross water are fords: **closed while `weather.flood > 0.5`** (monsoon peaks); otherwise infantry/cavalry cross at 0.4x speed. |
| Sangam of the Two Rivers | confluence | Label and hero cinematic subject. |
| The Dvara Pass (Dvaradurga) | pass | Only cart road from the salt flats onto the plateau. |
| The Red Quarries (Shilapur) | quarry | Stone deposit marker for the Quarry & Mine. |
| The White Flats (Lavanapura) | salt pan | Salt resource marker. |
| The Nilavana | forest | Elephant country. |
| The Dakshina Scarp | escarpment | Plateau edge; the three roads up are the only non-rough approaches. |

Strategic chokepoints (designed): **Setu Bridge** (plains <-> plateau), **Dvara Pass** (frontier <-> plateau),
**Shilapur escarpment roads** (approach to Giridurg), **Ratnapura-Naukapattana road** (trade artery to the sea).

### 3.5 Resources

Settlement resources (`ResourceKind`) feed the economy as follows (`RESOURCE_KIND_FEEDS`):
grain/rice -> grain; timber -> timber (workshops at full rate); stone/iron/copper -> stone (mines need a
deposit); salt, cotton, spices -> trade income (+10% settlement trade per kind); horses -> -20% wealth cost of
mounted units for the owner; elephants -> enables war elephant recruitment for the owner; gems -> +10% local
wealth.

Design intent: **Suvarna has grain and roads but no stone**; **Giridurga has stone, iron and horses but no
grain surplus**; Nilavana has timber and elephants; Marudesha has salt and horses. Every realm needs another -
by trade, treaty or conquest.

### 3.6 Naming and cultural care

All names are fictional Sanskrit/Prakrit-style compounds with readable meanings (Rajapura "city of kings",
Dhanyagram "grain village", Giridurg "hill fort"). No real dynasty, city, ruler or epic hero is depicted;
generated character pools (`NAME_POOLS`) exclude famous historical and epic names. No faction is "evil": each
has a grievance, a strength and a cost (GDD §7). Forest communities are a settled, trading, council-governed
kingdom, never "tribes"; the frontier is a culture of caravan princes, not "barbarians".

---

## 4. Factions

Six factions exist (`FACTIONS`); the campaign region holds four. The two playable factions are deliberately
asymmetric along the GDD §4 archetype axis **mass vs. terrain**.

### 4.1 Suvarna Kingdom (Imperial Heartland) - playable

*"The granary is the root of the kingdom."* Heraldry: **The Risen Sun of Suvarna** - saffron field, a golden
twelve-rayed sun above a maroon river-wave base. Colors: saffron `#e0801f` / gold `#f2cf63` / maroon `#7a1f1f`.
Architecture: `heartland_brick`. AI personality: expansionist. Starting age: Mahajanapada.

- **Strengths:** largest recruitment pool (x1.35) and fastest levies; efficient taxation (x1.15), royal roads
  and granaries (supply x1.15); the only realm that can field elephants, chariots and horse together.
- **Weaknesses:** governing costs x1.3 and rising with every settlement beyond its governor slots; hunger turns
  into unrest fastest in its crowded plains; no stone of its own; elephants depend on the Royal Corps or trade.
- **Variants:** *Royal Levy* (spearmen: recruit time x0.8, upkeep x0.85, morale x0.95); *Royal Elephant Corps*
  (elephants: HP x1.1, discipline x1.25, unruliness x0.7).
- **Landmarks:** Mahajanapada - *Hall of a Hundred Pillars* or *The Royal Granary*; Samrajya - *Pillars of the
  Spoken Law* or *The Great Road* (§8.5).
- **Plays like:** out-produce and out-recruit; win by conquest, by grain, or by marriage - the court is the
  second battlefield.

### 4.2 Giridurga Confederacy (Highland Confederacy) - playable

*"One oath, seven hills."* Heraldry: **The Seven Peaks** - indigo field, seven white peaks, a gold lamp above the
highest. Colors: indigo `#2c4fa3` / sky `#a9c1ea` / gold `#e9b949`. Architecture: `highland_stone`. AI
personality: defensive. Starting age: Mahajanapada.

- **Strengths:** fort defense x1.4; hill movement x1.35; diplomacy opinion x1.2 (oaths are kept); construction
  x1.15; stone, iron and horses at home.
- **Weaknesses:** recruitment pool x0.75; no elephants or chariots; a structural grain deficit (≈ -9% in a normal
  year, §13.2) - grain must come by trade, treaty or the river fields.
- **Variants:** *Hill Bowmen* (archers: range x1.15, accuracy x1.15, morale x1.1); *Fort Wardens* (spearmen:
  defense x1.1, discipline x1.1, recruit time x1.2); *Plateau Riders* (cavalry: fatigue x0.8, turn x1.15,
  charge x0.9).
- **Landmarks:** Mahajanapada - *Oath Stone of the Seven Clans* or *The Cliff Cistern*; Samrajya - *Citadel of a
  Thousand Steps* or *Assembly Caves of the League*.
- **Plays like:** make every battle uphill; bleed armies at forts and passes, raid supply, win friends.

### 4.3 AI minor powers in the campaign

| Faction | Archetype | Personality | Role in the campaign | Identity |
|---|---|---|---|---|
| **Nilavana Kingdoms** (`forest`) - "The forest gives to those who ask." Jade/leaf/gold, *The Elephant under the Canopy* | Forest Kingdoms | opportunist | Trade partner of Suvarna; target of Prince Devavarman's intrigue; seller of elephants (Elephant Fair) | Elephants and timber, forest movement x1.5, scouting x1.4, poor sieges (x0.7) |
| **Marudesha Principalities** (`frontier`) - "Water is the only border." Violet/lilac/black, *The Dune Chevron* | Frontier Principalities | raider | Raider on the salt road; tempts Dhanyakshetra to secede; trade/alliance offers | Fast (march x1.25), trade x1.25, fragile in long fights (x1.35 penalty) |

Both minors are never "the enemy": their AI picks war only when weakness invites it (§7.14).

### 4.4 Skirmish- and sandbox-only

**Samudra League** (`maritime`, mercantile; trade x1.5, supply x1.25; *Deck Archers*) and **Kotanagara
City-States** (`citystates`, diplomatic; siege x1.35, construction x1.35, smallest recruitment x0.7; *Guild
Engineers*). They have landmarks and full data and can be picked in skirmish and sandbox.

### 4.5 Faction modifiers

Multipliers (1 = neutral) read by the systems named in the right column.

| Modifier | Suvarna | Giridurga | Nilavana | Marudesha | Samudra | Kotanagara | Applied in |
|---|---|---|---|---|---|---|---|
| recruitmentPool | 1.35 | 0.75 | 0.85 | 0.8 | 0.85 | 0.7 | recruit pool cap & regen §7.6 |
| governanceCost | 1.3 | 0.8 | 0.9 | 0.85 | 1 | 0.9 | administration §7.5 |
| taxEfficiency | 1.15 | 0.9 | 0.9 | 0.85 | 1 | 1.2 | tax §7.5 |
| tradeIncome | 1.05 | 0.95 | 1 | 1.25 | 1.5 | 1.2 | trade §7.5 |
| fortDefense | 1 | 1.4 | 0.9 | 0.9 | 1 | 1.3 | wall HP, siege battles §7.8 |
| siegeStrength | 1.1 | 0.9 | 0.7 | 0.8 | 0.9 | 1.35 | wall damage §7.8 |
| constructionSpeed | 1.1 | 1.15 | 1 | 0.9 | 1.05 | 1.35 | construction §7.6 |
| marchSpeed | 1 | 1 | 1.1 | 1.25 | 1 | 0.95 | army speed §7.7 |
| forestMovement | 0.9 | 1 | 1.5 | 0.85 | 0.9 | 0.9 | off-road forest/marsh legs |
| hillMovement | 0.9 | 1.35 | 1.1 | 1 | 0.85 | 0.9 | off-road hills/rough legs |
| scoutRange | 1 | 1.15 | 1.4 | 1.3 | 1 | 1 | visibility §7.7 |
| supplyEfficiency | 1.15 | 1 | 0.95 | 1.05 | 1.25 | 1 | army consumption / supply §7.8 |
| prolongedEngagement | 0.95 | 0.85 | 1.2 | 1.35 | 1 | 0.9 | battle fatigue & morale after 4 min §6.9 |
| diplomacyOpinion | 0.9 | 1.2 | 1.1 | 0.95 | 1.15 | 1.05 | AI acceptance utility §7.10 |
| espionage | 1.1 | 1 | 1.15 | 1.1 | 1.2 | 1 | spy success §7.11 |

Ages multiply further (`AgeDef.bonuses`, landmarks' `factionEffects`); multipliers stack multiplicatively.

### 4.6 Heraldry, team colors and readability

- Team color = `FactionDef.colors.primary` (cloth masks, banners, formation footprints, army tokens, borders);
  secondary for trims/selection rings; accent for banner emblems.
- The four campaign colors (saffron, indigo, jade, violet) were chosen to stay distinct under deutan/protan
  vision; under `GameSettings.colorblind != 'none'` the UI adds **shape coding**: every faction marker uses its
  banner pattern (sun, mountain, elephant, chevron, wave, tower) as an emblem, and player/enemy relation is
  shown with a ring style (solid = own, dashed = ally, spiked = enemy).
- Banners: `BannerPattern` + heraldry blazon (Art Director renders the emblem procedurally).

---

## 5. Units

### 5.1 Classes (GDD §4)

| Class (local term) | Role | Key constraint | Model |
|---|---|---|---|
| Spearmen (*Padati*) | Hold ground | Morale and formation discipline matter | 120 levies, tall shields, bamboo spears |
| Archers (*Dhanvin*) | Ranged support | Need protection, visibility and ammunition (20 volleys) | 100 bowmen, long bamboo bows |
| Royal Guards (*Maula*) | Protect commanders, reinforce key formations | Expensive (900) | 60 hereditary warriors, scale, sword, round shield |
| Horsemen (*Ashvaroha*) | Reconnaissance, maneuver, pursuit | Terrain-dependent | 60 riders with lance and sword |
| Chariots (*Ratha*) | Specialized shock/archery platform | Terrain + period: retired in the Samrajya Age | 16 two-horse cars (driver + archer) |
| War Elephants (*Gaja*) | Shock and disruption | Expensive upkeep; panic under missiles | 8 armored bulls with mahout + 2 archers |
| Engineers (*Vishti*) | Siege works and construction | Need time and protection | 40 carpenters and diggers |
| Scouts (*Charaka*) | Reveal threats and routes | Vulnerable in melee | 30 light riders with javelins |
| Supply Train (*Shakata*) | Sustain campaigns | Roads and escorts | 12 ox carts, 300 grain each |

"Men" are **models**: a war-elephant formation of 8 is 8 beasts with crews; HP is per model.

### 5.2 Combat stats

| Class | Men | HP | Melee atk | Melee def | Charge | Ranged atk | Range m | Ammo | Reload s | Acc | Armor | Walk m/s | Run m/s | Turn rad/s | Mass | Morale | Discipline | Vision m |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Spearmen | 120 | 10 | 6 | 9 | 3 | 0 | 0 | 0 | 0 | 0 | 2 | 1.5 | 3.5 | 0.55 | 1 | 60 | 0.6 | 300 |
| Archers | 100 | 8 | 3 | 3 | 0 | 6 | 160 | 20 | 6 | 0.3 | 0.5 | 1.6 | 3.8 | 0.8 | 1 | 50 | 0.45 | 350 |
| Royal Guards | 60 | 14 | 10 | 11 | 5 | 0 | 0 | 0 | 0 | 0 | 4 | 1.5 | 3.6 | 0.7 | 1.2 | 85 | 0.9 | 300 |
| Horsemen | 60 | 18 | 8 | 5 | 12 | 0 | 0 | 0 | 0 | 0 | 2 | 2.4 | 8.5 | 1.0 | 3 | 65 | 0.55 | 450 |
| Chariots | 16 | 45 | 9 | 4 | 18 | 5 | 120 | 12 | 5 | 0.3 | 3 | 2.2 | 8.0 | 0.5 | 4 | 60 | 0.5 | 400 |
| War Elephants | 8 | 160 | 20 | 8 | 30 | 3 | 80 | 10 | 6 | 0.3 | 4 | 1.8 | 4.5 | 0.35 | 9 | 70 | 0.4 | 350 |
| Engineers | 40 | 9 | 3 | 3 | 0 | 0 | 0 | 0 | 0 | 0 | 1 | 1.5 | 3.2 | 0.6 | 1 | 45 | 0.5 | 300 |
| Scouts | 30 | 12 | 4 | 3 | 4 | 3 | 40 | 6 | 4 | 0.4 | 0.5 | 2.8 | 10.0 | 1.2 | 2.2 | 50 | 0.45 | 750 |
| Supply Train | 12 | 30 | 1 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 1 | 1.2 | 1.8 | 0.3 | 5 | 30 | 0.3 | 300 |

### 5.3 Logistics and cost

| Class | Age | Cost per formation (wealth / grain / recruits) | Days | Grain /model/day | Wealth /model/month | Formation upkeep /month | Fatigue rate | Spacing X x Z m | Siege | Stealth | Unruly | Default shape (allowed) | Card key |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Spearmen | I | 360 / 60 / 120 | 10 | 0.15 | 0.25 | 30 | 0.010 | 1.0 x 1.4 | 0 | 0 | 0 | line (column, square, wedge, circle) | Q |
| Archers | I | 400 / 50 / 100 | 12 | 0.15 | 0.3 | 30 | 0.010 | 1.2 x 1.6 | 0 | 0 | 0 | line (loose, column) | W |
| Royal Guards | II | 900 / 40 / 60 | 20 | 0.18 | 1.0 | 60 | 0.009 | 1.1 x 1.4 | 0 | 0 | 0 | square (line, column, wedge, circle) | E |
| Horsemen | II | 720 / 60 / 60 | 16 | 0.45 | 0.9 | 54 | 0.012 | 1.8 x 3.2 | 0 | 0 | 0 | wedge (line, column, loose) | R |
| Chariots | I (retired III) | 640 / 60 / 32 | 18 | 1.2 | 3.0 | 48 | 0.012 | 4 x 6 | 0 | 0 | 0 | line (column, loose) | T |
| War Elephants | II | 1,600 / 300 / 40 | 30 | 6 | 8 | 64 | 0.011 | 6 x 8 | 5 | 0 | 0.12 | line (column, loose) | A |
| Engineers | I | 300 / 40 / 40 | 14 | 0.15 | 0.6 | 24 | 0.010 | 1.1 x 1.4 | 4 | 0 | 0 | loose (column, line) | S |
| Scouts | I | 240 / 40 / 30 | 8 | 0.4 | 0.5 | 15 | 0.011 | 2.5 x 3.5 | 0 | 0.6 | 0 | loose (line, column) | D |
| Supply Train | I | 300 / 100 / 24 | 6 | 0.6 | 0.5 | 6 | 0.010 | 4 x 7 | 0 | 0 | 0 | column (loose) | F |

Notes: `upkeepWealth` is **per model per month** (contract in `types.ts`; the baseline sim currently multiplies by
0.1 - see §14). A supply train also carries 12 x 300 = 3,600 grain, loaded from the recruiting settlement's store
when raised. Age column: I Janapada, II Mahajanapada, III Samrajya.

### 5.4 Terrain modifiers (speed / attack / defense / fatigue)

| Profile | open | road | farmland | forest | hills | rough | marsh | shallow water | deep water | urban |
|---|---|---|---|---|---|---|---|---|---|---|
| Spear infantry | 1/1/1/1 | 1.15/1/0.95/0.8 | 0.9/1/1/1.05 | 0.75/0.9/1.2/1.15 | 0.75/1.05/1.25/1.3 | 0.65/0.9/1.1/1.35 | 0.45/0.8/0.85/1.6 | 0.4/0.7/0.7/1.8 | 0.05/0.3/0.3/3 | 0.85/1/1.25/1 |
| Guards | 1/1/1/1 | 1.15/1/0.95/0.8 | 0.9/1/1/1.05 | 0.75/0.9/1.2/1.15 | 0.75/1.05/1.15/1.3 | 0.65/0.9/1.1/1.35 | 0.45/0.8/0.85/1.6 | 0.4/0.7/0.7/1.8 | 0.05/0.3/0.3/3 | 0.85/1.1/1.3/1 |
| Archers, engineers | 1/1/1/1 | 1.15/1/0.95/0.8 | 0.9/1/1/1.05 | 0.75/0.9/1.2/1.15 | 0.75/1.05/1.15/1.3 | 0.65/0.9/1.1/1.35 | 0.45/0.8/0.85/1.6 | 0.4/0.7/0.7/1.8 | 0.05/0.3/0.3/3 | 0.85/1/1.2/1 |
| Horsemen | 1/1.1/1/1 | 1.1/1/0.95/0.8 | 0.85/1/1/1.1 | 0.45/0.6/0.8/1.5 | 0.6/0.85/0.9/1.4 | 0.4/0.6/0.8/1.6 | 0.3/0.5/0.7/2 | 0.45/0.6/0.7/1.6 | 0.05/0.2/0.2/3 | 0.6/0.7/0.85/1.2 |
| Scouts | 1/1.1/1/1 | 1.1/1/0.95/0.8 | 0.85/1/1/1.1 | 0.65/0.8/1/1.2 | 0.7/0.9/1/1.25 | 0.55/0.75/0.9/1.4 | 0.3/0.5/0.7/2 | 0.45/0.6/0.7/1.6 | 0.05/0.2/0.2/3 | 0.6/0.7/0.85/1.2 |
| Chariots | 1/1.2/1/1 | 1.1/1.1/1/0.8 | 0.7/0.9/0.9/1.2 | 0.2/0.3/0.5/2 | 0.4/0.5/0.7/1.8 | 0.2/0.3/0.6/2 | 0.15/0.2/0.5/2.5 | 0.25/0.3/0.5/2 | 0.03/0.1/0.2/3 | 0.35/0.4/0.6/1.5 |
| Elephants | 1/1/1/1 | 1.05/1/1/0.9 | 0.95/1/1/1 | 0.8/1/1.1/1.1 | 0.7/0.95/1.05/1.4 | 0.7/0.95/1/1.3 | 0.5/0.8/0.9/1.5 | 0.75/0.9/0.9/1.2 | 0.2/0.4/0.5/2.5 | 0.6/1.1/0.9/1.2 |
| Ox carts | 1/1/1/1 | 1.25/1/1/0.7 | 0.8/1/1/1.2 | 0.3/1/1/1.8 | 0.45/1/1/1.8 | 0.3/1/1/2 | 0.2/1/0.8/2.5 | 0.3/1/0.8/2 | 0.03/1/0.5/3 | 0.7/1/1/1.1 |

### 5.5 Counters (rock-paper-scissors)

Attack multiplier of the row class against the column class (`bonusVs`, blank = 1.0). Applies to melee **and**
missiles (§6.6).

| vs | SPR | ARC | GRD | CAV | CHR | ELE | ENG | SCT | SUP |
|---|---|---|---|---|---|---|---|---|---|
| **SPR** |  |  |  | 1.8 | 1.7 | 1.35 |  | 1.4 |  |
| **ARC** |  |  |  | 0.9 | 1.4 | 1.5 | 1.4 |  | 1.3 |
| **GRD** | 1.25 | 1.3 |  |  |  | 1.1 | 1.3 |  |  |
| **CAV** | 0.7 | 1.8 |  |  | 1.2 | 0.6 | 1.8 | 1.4 | 2.0 |
| **CHR** | 0.7 | 1.6 | 0.8 |  |  | 0.5 | 1.5 | 1.3 | 1.5 |
| **ELE** | 1.5 | 1.2 | 1.3 | 1.7 | 1.8 |  | 1.5 |  | 1.8 |
| **SCT** |  | 1.2 |  |  |  | 1.3 | 1.5 |  | 1.8 |

The triangle the player must learn: **spears beat horse and chariots; horse beats archers, engineers and carts;
archers beat elephants, chariots and slow spear blocks; elephants beat everything in melee except when panicked
by missiles; guards beat spears.** Bracing (§6.6.2) is what makes spears beat a charge; panic (§6.6.4) is what
makes archers beat elephants.

### 5.6 Readability (AoE-level at strategic zoom, Wukong-level close up)

- 9 silhouettes (`SilhouetteKind`) readable at 200 m: tall shields + spear forest, bows, crested helmets + round
  shields, horse, two-wheel car, elephant with howdah, tool-carriers, light rider, ox cart.
- Each formation has a **marker**: team-colored rectangle footprint (selection ring when selected), a floating
  card with class icon + `shortName` (SPR, ARC, GRD, CAV, CHR, ELE, ENG, SCT, SUP), a strength bar and a morale
  bar; hovering shows the full tooltip (soldiers/max, morale + dominant factor, fatigue tier, ammo pips,
  experience chevrons, order).
- Standard bearers and drummers per formation (`hasStandard`) carry the faction banner; a fallen standard is a
  visual cue for a routing formation.
- Team color masks on cloth; enemy formations get a thin red outline under the footprint when the player has
  "relation coloring" enabled (colorblind assist §12.5).

### 5.7 Faction variants

| Faction | Variant (class) | Effect |
|---|---|---|
| Suvarna | Royal Levy (spearmen) | recruitDays x0.8, upkeepWealth x0.85, baseMorale x0.95 |
| Suvarna | Royal Elephant Corps (war elephants) | hp x1.1, discipline x1.25, unruliness x0.7 |
| Giridurga | Hill Bowmen (archers) | range x1.15, accuracy x1.15, baseMorale x1.1 |
| Giridurga | Fort Wardens (spearmen) | meleeDefense x1.1, discipline x1.1, recruitDays x1.2 |
| Giridurga | Plateau Riders (cavalry) | fatigueRate x0.8, turnRate x1.15, chargeBonus x0.9 |
| Nilavana | Forest Runners (scouts) | stealth x1.35, visionRange x1.2 |
| Nilavana | Herd Elephants (war elephants) | recruitDays x0.7, upkeepWealth x0.75, unruliness x1.3 |
| Marudesha | Salt Road Riders (cavalry) | runSpeed x1.1, chargeBonus x1.15, fatigueRate x1.15 |
| Samudra | Deck Archers (archers) | accuracy x1.1, reloadSec x0.9, meleeDefense x0.9 |
| Kotanagara | Guild Engineers (engineers) | siege x1.4, recruitDays x0.8 |

Multipliers apply to `UnitStats` **at formation creation** (battle) and to recruitment/upkeep (strategic) [REQ].
The variant name replaces the class name in UI ("Hill Bowmen").

### 5.8 Period availability

- Chariots are recruitable in Janapada and Mahajanapada and **retired in the Samrajya Age** (existing chariots
  remain until destroyed or disbanded; the command-card button disappears).
- War elephants require an **elephant source**: own a settlement with the `elephants` resource, or a trade treaty
  with a faction that owns one, or the event flag `elephant_source` (Elephant Fair, 360 days).
- Mounted classes cost 20% less wealth for a faction owning a `horses` resource (`RULES.recruitment.horsesDiscount`).

---

## 6. Battlefield rules (field command)

Battles are resolved **at formation level** (`sim/tactical/battle.ts`, 20 Hz). The soldier layer only shows the
result (GDD §9). Distant battles run the same code headless (autoresolve) [BASE].

### 6.1 Battle setup

| Item | Rule |
|---|---|
| Map | 1,024 m square window of the region terrain centered on the engagement (513^2, 2 m cells) [BASE]. Skirmish uses a preset window (`SKIRMISH_MAPS`). |
| Battle kind | `field` default; `river_crossing` if deep water lies within 300 m between the armies; `siege` when an army assaults a settlement with fort level >= 1; `ambush` when the defender stands in forest and the attacker had no scouts (the defender deploys hidden, see §6.10). |
| Deploy zones | Two 300 x 220 m rectangles centered 150 m either side of the map center along the axis across the river [BASE]; siege: defender inside the wall ring, attacker 250 m outside the main gate. |
| Deployment phase | World battles: **60 s** (`RULES.battle.deploymentSecWorld`); skirmish: **30 s**; the game starts paused in deployment; the player drags formations inside the zone (cannot leave it), sets facing/shape; "Begin battle" ends it early. AI auto-deploys by line order (elephants front, spears, archers 20 m behind, horse on wings, carts rear) [BASE]. |
| Time limit | World: 30 min; skirmish: 40 min [BASE skirmish]. At the limit the stronger side by strength wins; within 10% = draw [BASE]. |
| Commander | The side commander rides with the elite guards formation if any, else the largest formation [BASE]. |
| Soldier budget | Up to `QualitySettings.maxSoldiers` models visualized; formation strengths are never capped by quality (the sim is authoritative). |

### 6.2 Formations and spacing

`files = round(sqrt(n x aspect))`, `ranks = ceil(n / files)`, `width = files x spacingX x spread`,
`depth = ranks x spacingZ x spread`; frontage in combat = files [BASE]. Shape modifiers (`RULES.battle.shapes`):

| Shape | Aspect (files:ranks) | Spread | Speed | Melee atk | Melee def | Missile dmg taken | Charge impact dealt | All-round | Use |
|---|---|---|---|---|---|---|---|---|---|
| Line | 5 | 1.0 | 1.0 | 1.0 | 1.0 | 1.0 | 1.0 | no | Default; maximum frontage |
| Column | 0.25 | 1.0 | 1.15 | 0.8 | 0.8 | 1.1 | 0.8 | no | Marching, roads, fords |
| Square | 1 | 1.0 | 0.8 | 0.9 | 1.1 | 1.1 | 0.9 | **yes** | Against cavalry from any side |
| Wedge | 1.6 | 1.1 | 1.0 | 1.1 | 0.85 | 1.0 | 1.3 | no | Charges, breaking lines |
| Loose | 3 | 1.8 | 1.1 | 0.85 | 0.75 | **0.5** | 0.7 | no | Against arrows; skirmishers |
| Circle | 1 | 1.15 | 0.3 | 0.9 | 1.15 | 1.0 | 0.8 | **yes** | Last stand; protects archers inside |

All-round shapes ignore flank/rear multipliers (attacks always count as frontal). Changing shape takes
`3 s + 0.02 s x soldiers` during which cohesion is capped at 0.6.

### 6.3 Orders (`FormationOrder`)

| Order | Behavior | Edge cases |
|---|---|---|
| **hold** | Stop; keep facing; fight anything that contacts; ranged formations shoot targets in range unless `hold_fire`. Turns to face an attacker only if stance is aggressive or defensive and not engaged. | Hold under missile fire costs morale via perceived risk; no auto-retreat. |
| **advance** (`distance`) | Walk forward along facing, keeping the line; stops early on contact. | Default distance 30 m per key press (`T`). |
| **move_to** (x, z, facing, run) | Path to the point (flow field on the battle grid [REQ]); arrive and turn to `facing`. Right-drag sets facing and frontage (width -> files). | Water: only through fords/shallows; deep water impassable [BASE detour]. |
| **attack_target** | Approach at walk; melee classes engage on contact; ranged classes move until in range then shoot and keep distance (as skirmish). | Target routing -> pursue only if stance aggressive; otherwise stop at 40 m. |
| **charge** | Approach at walk until **40 m (foot) / 90 m (mounted, elephants)** then run; on contact apply charge impact (§6.6.2) once, then melee. | Charge impact requires >= 20 m of running at >= 60% run speed (`RULES.battle.charge`); exhausted formations cannot charge. |
| **flank** (target, side) | Run to a point 35 m beyond the target's chosen flank and 10 m behind its front, then attack (impact counts as flank). | If the target turns to face, re-route once; after 30 s convert to attack_target. |
| **withdraw** (x, z or own zone) | Back away at 50% speed facing the enemy for 20 m, then turn and walk. Disengaging from melee: enemies in contact deal x1.5 damage for 3 s. | Not a rout: no morale penalty; cohesion kept. |
| **regroup** | Stop; cohesion recovers x2.5; one-off +5 morale if not engaged; a rallying formation becomes controllable. | Ignored while engaged. |
| **defend** (x, z, radius) | Hold inside the radius; engage enemies entering it; return to the anchor when they leave or rout. | Radius min 20 m, max 150 m. |
| **skirmish** (target) | Ranged: keep the target between 0.4x and 0.9x range; step back (walk) when an enemy closes within 0.4x range. | Out of ammo -> converts to hold and shows "No arrows". |
| **construct** (work, x, z) | Engineers only: walk to the spot and build (§6.6.5). | Interrupted by contact; progress kept. |
| **resupply** (target) | Supply train moves to within 30 m of a ranged formation; +25% max ammo every 30 s while both stand still. | Carts lost -> no resupply. |

Shift-queue: orders with `queue: true` append; the formation executes them in sequence [BASE].

### 6.4 Intent orders (GDD §5)

The player states an objective; every **1 s** the battle AI translates it into a concrete order for each
formation that carries the intent [BASE hook]. Translation rules [REQ]:

| Intent | Translation |
|---|---|
| **hold_crossing** (x, z, r) | Place spearmen/guards in line across the ford axis at the near bank, facing the far bank; archers 25 m behind; mounted 60 m back on the flanks as reserve. Engage only enemies inside `r`; never pursue past the far bank. |
| **protect_formation** (target) | Stay between the protected formation and the nearest threat at 25 m; intercept any enemy melee formation that comes within 120 m of it (attack_target), then return. |
| **hold_high_ground** (x, z, r) | Move to the highest terrain point within `r` (sample 16 points), face the nearest enemy, hold; archers use it as a firing platform (+10% range per 10 m of height advantage). |
| **pin_enemy** (target) | Advance to 60 m of the target and hold (ranged: shoot); retreat 30 m if charged; purpose is to draw it while others flank. |
| **screen_flank** (protect, side) | Keep 40 m beyond the protected formation's chosen flank, facing outward; intercept mounted enemies inside 150 m. |
| **pursue_routers** | Mounted/scouts only: attack the nearest routing enemy within 400 m; never engage a steady formation; return when none remain. |
| **scout_area** (x, z, r) | Run to the area, reveal it, keep 100 m from any enemy (withdraw if closer). |
| **escort_supply** (target) | Follow the supply train at 20 m on the enemy side; intercept attackers within 80 m. |

UI: intent orders are on the battle command card's second page and in the touch radial wheel (§8.8).

### 6.5 Stances and movement

| Stance | Melee | Ranged | Pursuit |
|---|---|---|---|
| aggressive (default melee) | Engages enemies within 30 m even without orders | Fires at will | Pursues routers 60 m |
| defensive | Engages only when contacted; turns to face | Fires at will | Never |
| skirmish (default ranged) | Avoids melee: steps back when enemies close within 0.4x range | Fires at will | Never |
| hold_fire | As defensive | Does not fire (ambushes, avoiding friendly fire) | Never |

Movement speed (m/s) = `walkSpeed | runSpeed` x `terrain.speed` x `(1 - 0.35 x fatigue)` x `shape.speed` x
weather mud factor (§6.10) [BASE except shape/weather]. Formations turn at `turnRate` rad/s; a formation turning
more than 90° in place loses 0.1 cohesion. Formations do not interpenetrate except: routers pass through
friends (the friend loses 0.05 cohesion), and elephants/chariots trample through infantry (§6.6.4).

### 6.6 Combat resolution

All damage is HP applied to the formation's `damagePool`; whole casualties are realized when the pool exceeds one
model's HP [BASE]. Constants: `K = 10 x BALANCE.combat.meleeDamageScale = 0.45`,
`Kr = 10 x BALANCE.combat.rangedDamageScale = 0.45`.

#### 6.6.1 Melee (per tick, both directions)

```
frontage  = min(soldiers_A, files_A) x (A routing ? 0.1 : 1) x (A spearmen in line/square with ranks >= 2 ? 1.25 : 1)
ATK       = meleeAttack_A x bonusVs[A->D] x terrain_A.attack x height x (0.5 + morale_A/200)
            x (1 - 0.4 fatigue_A) x (0.6 + 0.4 cohesion_A) x (1 + 0.25 exp_A) x shape_A.meleeAttack
DEF       = meleeDefense_D x terrain_D.defense x (0.6 + 0.4 cohesion_D) x (1 + 0.15 exp_D) x shape_D.meleeDefense
            x (D on walls ? 1.3 : 1) + armor_D
height    = 1 + clamp((h_A - h_D) x 0.012, -0.3, 0.3)
aspect    = 1 (front) | 1.5 (flank) | 2.0 (rear)     ; all-round shapes: always 1
rout      = 3 if D is routing else 1
dmgHP     = frontage x ATK / max(1, DEF) x aspect x rout x K x dt x U(0.85, 1.15)
```

Side effects per tick: D's cohesion -0.01 x aspect x dt; A's fatigue +0.003 x dt x fatigueRate x 100; flank/rear
hits add a morale event with probability `0.5 x dt`.

*Worked example:* two fresh spear blocks (24 files, morale 60) fight front-to-front: ATK = 6 x 0.8 = 4.8, DEF = 11
-> 24 x 4.8 / 11 x 0.45 = **4.7 HP/s ≈ 0.47 men/s** each way. A 25% loss takes ~60 s; morale (perceived risk +
fatigue) usually decides it first. Same pair, one hit in the flank: x1.5 damage plus -0.35 morale shocks.

#### 6.6.2 Charge impact

Applied once when a charging formation makes contact after >= 20 m at >= 60% run speed:

```
impactHP = min(soldiers_A, 2 x files_A) x chargeBonus_A x mass_A / (mass_D + 1) x 0.35 (chargeImpulse)
           x shape_A.chargeImpact x U(0.8, 1.2) x braced
braced   = 0.35 if D is spearmen or guards, not moving, not routing, hit from the front (or D in square/circle)
recoil   = 0.5 x impactHP applied to A when braced
morale   = D gets 'charged' (-0.25, x0.3 if braced, decay 20 s)
```

*Worked examples:* 8 elephants into unbraced spearmen = 378 HP ≈ **38 men in one blow**; into braced spears =
13 men, and the elephants take 189 HP back (≈1.2 elephants). 60 horsemen into archers ≈ 126 HP ≈ **16 archers**,
then 1.8x melee bonus. This is why archers must never stand alone and why horse must never charge braced spears.

#### 6.6.3 Missiles (volleys)

A ranged formation fires one volley per `reloadSec x U(0.9, 1.1)` at a target within range [BASE]:

```
range_eff = min(range, 0.5 x weather.visibility) x (1 + 0.1 x max(0, h_A - h_D)/10) x (on walls ? 1.2 : 1)
flight    = 0.3 + distance / 55 s (arrows lead the target's velocity) [BASE]
hits      = count x accuracy x (0.4 + 0.6 density) x onTarget x (1 - 0.4 rain) x (night ? 0.7 : 1)
            x (on walls ? 1.2 : 1) x U(0.8, 1.2)
density   = clamp01(2.2 x soldiers_D / (width_D x depth_D)) ; onTarget = clamp01(1 - miss / (max(w,d)/2 + 6))
dmgHP     = hits x rangedAttack x bonusVs[A->D] x Kr / (1 + 0.5 armor_D) x shape_D.missileDamageTaken
            x (D in forest ? 0.6 : 1)
```

- Ammo -1 per volley; at 0 the formation shows "No arrows" and stops shooting; `resupply` refills.
- Wet bows: reload x1.25 in `monsoon_rain`/`storm`.
- **Friendly fire:** a volley at a target engaged in melee with friends applies 30% of its hits to the friendly
  formation in contact (`RULES.battle.friendlyFireShare`), unless the shooter is on `hold_fire`.
- Morale: `volley_hit` (-0.08, 10 s) when hits > 5% of the target's soldiers [BASE].

*Worked example:* 100 archers into a spear block: 24 hits -> 32 HP ≈ **3.2 men per volley (6 s)**; into 8
elephants (armor 4, bonus 1.5): 32 HP ≈ 0.2 elephants per volley - the damage is slow, **the panic is the
counter** (§6.6.4).

#### 6.6.4 War elephants: panic and trample

After each volley (or javelin hit) on an elephant formation:

```
p_panic = clamp(unruliness x 0.8 x (1 - morale/100) x hits / soldiers, 0, 0.5)
```

(8 elephants at morale 70 taking 24 hits: 0.12 x 0.8 x 0.3 x 3 = 8.6% per volley; ~40% after six volleys; Royal
Corps x0.7.) On panic: for **8 s** the elephants run away from the shooter at run speed ignoring orders, and
every formation (friend or foe) whose footprint they cross within 6 m takes `0.5 x impactHP` (unbraced) and an
`elephant_panic` morale event (-0.3, 20 s); afterwards elephant morale -20 and order = regroup. Elephants also
inflict `charged` shocks on horsemen within 30 m (horses fear them: cavalry morale -0.2 when an elephant
formation closes within 30 m, once per 20 s).

#### 6.6.5 Siege works and fortifications

| Element | Rule |
|---|---|
| Wall ring | `RULES.battle.walls.segments` = 12 segments on the settlement radius; segment HP = `fortLevel x 1000 x fortDefense / 12`. Gates: 1 (fort), 2 (town/port/temple town), 4 (city/capital); gate HP = 1.5 x segment HP. Towers: 1 per 2 segments per fort level, each a shooting position (+20% range/accuracy for archers inside 10 m). |
| Engineers' works (`EngineerWork`) | palisade (40 s, 20 m wall, 300 HP), ditch (60 s, slows crossers to 0.4x), bridge (90 s over shallow water or a ford, makes it passable at road speed), ram (60 s; then moved to a gate, damage 4 HP/s x engineers/10), ladder (20 s per segment; allows assault over intact walls with escalade penalty: attackers' melee x0.7 and morale -0.15 on the climb), repair_gate (defender engineers +10 HP/s). |
| Elephants vs gates | Elephants adjacent to a gate deal `siege x soldiers` HP/s to it (5 x 8 = 40 HP/s). |
| Defenders on walls | Defense x1.3, missile accuracy x1.2, range x1.2 (`RULES.battle.walls`). |
| Breach | A segment or gate at 0 HP becomes passable. |
| Siege battle victory | Attacker wins when a formation holds the inside of a breach/gate for **60 s** with the defenders broken, or defenders are broken; defender wins at the time limit or if attackers break. Objective markers: `breach_gate`. |

### 6.7 Morale (GDD §5)

Morale is a tunable gameplay model, not a historical equation. Each tick every formation computes a **target**
and drifts toward it at `BALANCE.morale.driftPerSec` = 4 points/s [BASE]:

```
target = baseMorale + 15 x experience + playerMoraleBonus(difficulty, player side only)
       + (L - 0.5) x 18                       leadership
       + (C - 0.5) x 22                       cohesion
       -  F        x 24                       fatigue
       + (S - 0.5) x 10                       supply
       +  T        x 14                       tactical position
       +  R        x 36 x (1 - 0.5 discipline) recent events
       -  P        x 50 x (1 - 0.5 discipline) perceived risk
clamped to 0..100
```

Weights are `BALANCE.morale.weights` (leadership 18, cohesion 22, fatigue 24, supply 10, tactical position 14,
recent events 36, perceived risk 50). The dominant negative contribution is shown in the tooltip ("Morale 34 -
falling: flanked").

| Input | Range | Computation [REQ where beyond BASE] |
|---|---|---|
| L leadership | 0..1 | §6.11 |
| C cohesion | 0..1 | §6.9 |
| F fatigue | 0..1 | §6.9 |
| S supply | 0..1 | Side supply entering battle (army supply days / 10, cap 1); -0.3 while the side's supply train is engaged/destroyed or the strategic army's `lineIntact` is false |
| T tactical position | -1..1 | `0.5 x clamp(Δh/10, -1, 1)` (vs current target) `+ 0.3` both flanks covered (friend within 30 m each side) `+ 0.3` behind works/walls `+ 0.2` infantry in forest `- 0.4` in water/marsh `- 0.5` surrounded (enemies on >= 3 aspects within 30 m) |
| R recent events | -1..1 | Decaying sum of morale events (table below) [BASE] |
| P perceived risk | 0..1 | `enemyWeight / (friend + enemy) - 0.2 + 0.7 x losses` within 80 m [BASE] `+ 0.2` if charged by elephants in the last 10 s `+ 0.15` enemy mounted within 60 m on a flank/rear |

Morale events (`MoraleEventKind`, magnitude / decay seconds):

| Event | Magnitude | Decay | Trigger |
|---|---|---|---|
| commander_fallen | -0.7 | 60 | Side commander killed/captured (all formations of the side) [BASE] |
| flank_attacked | -0.35 | 25 | Taking melee damage from a flank (p = 0.5·dt per tick) [BASE] |
| rear_attacked | -0.5 | 25 | Same, rear [BASE] |
| ally_routed | -0.3 | 40 | A friend within 120 m routs [BASE] |
| enemy_routed | +0.15 | 30 | Any enemy routs [BASE] |
| charged | -0.25 (x0.3 braced) | 20 | Charge impact [BASE] |
| heavy_casualties | -0.12 | 20 | Losing >= 2% of max in one tick (max once per 3 s) [BASE] |
| volley_hit | -0.08 | 10 | Volley hits > 5% of soldiers [BASE] |
| elephant_panic | -0.3 | 20 | Trampled by panicking elephants |
| supply_threatened | -0.2 | 60 | Own supply train attacked, or strategic line cut |
| reinforced | +0.2 | 30 | A fresh friendly formation joins its melee |
| general_nearby | +0.1 | 10 | Commander within 60 m (refreshed every 10 s) |
| victory_near | +0.25 | 30 | Enemy side below 35% of its starting strength |
| rallied | +0.2 | 20 | On rally [BASE] |

Thresholds: **wavering** below 40 (UI pulse + hint), **rout** below 30 (`routThreshold`), **rally** above 50
(`rallyThreshold`) after 10 s without damage, **surrender** below 8 (`surrenderMorale`).

*GDD example, worked:* a spear formation at target 70 loses its commander (-0.7 x 36 x 0.7 = -17.6), has its
flank collapse (-0.35 x 36 x 0.7 = -8.8, and perceived risk +0.3 -> -10.5) and its supply route threatened (-0.2
event -> -5, S -0.3 -> -3): target ≈ 25 -> it routs with 80% of its men alive.

### 6.8 Rout, rally, surrender, capture, pursuit

| State | Rule |
|---|---|
| **Routing** | Morale < 30: order = withdraw to own map edge at run; ignores commands; takes x3 melee damage; cohesion -0.05/s; routers passing through friends cost them 0.05 cohesion and trigger `ally_routed`. A router reaching the map edge **leaves the battle** (survivors return to the army). |
| **Rallying** | Morale > 50 and no damage for 10 s -> `rallying` for 15 s (regroup, cohesion x2.5), then controllable. Max **2 rallies** per formation per battle; the third rout is final ("shattered"). The commander's Rally ability (§6.11) can force a rally check at morale > 35. |
| **Surrender** | Routing **and** morale < 8 **and** (enemy formations within 30 m on >= 2 aspects **or** cornered: water, wall or map edge within 20 m in the flee direction) -> `surrendered`; all remaining soldiers are **captured**. |
| **Side broken** | All combat formations (not engineers/supply) routing, destroyed or surrendered -> battle ends [BASE]. |
| **Pursuit** | When a side breaks: `pursuitLosses = routing soldiers x (0.15 + 0.1 x winnerMountedShare) x (1 - 0.5 x loserMountedShare)`; 70% killed, 30% captured. Mounted share = mounted soldiers / combat soldiers still fighting. |
| **Prisoners** | Results screen choice per battle: **Ransom** (loser pays 5 wealth per prisoner, capped at 30% of its treasury; opinion -5) or **Release** (opinion +5 per 100 released, max +20). AI: ransom if greedy/expansionist else release. Captured commanders: ransom 500 or held (event). |

### 6.9 Fatigue and cohesion

- Fatigue (0..1): running +0.004/s x fatigueRate x 100; fighting +0.003/s x fatigueRate x 100; standing
  -0.0015/s [BASE]; heat (> 34 °C) x1.3; after 4 minutes of battle all fatigue gain x `prolongedEngagement`
  (faction modifier). Tiers: Fresh < 0.25, Tired < 0.5, **Exhausted** < 0.8 (cannot run), **Spent** >= 0.8
  (cannot charge, -10 morale). Effects: speed x(1 - 0.35F), attack x(1 - 0.4F), morale -24F.
- Cohesion (0..1): moving -0.01/s (x2 running) down to 0.2; turning > 90° in place -0.1; melee from flank/rear
  -0.01 x aspect per s; recovers +0.02/s standing (+0.05 regroup) [BASE]. Effects: attack/defense x(0.6 + 0.4C),
  morale +(C - 0.5) x 22.

### 6.10 Terrain, weather and time of day

| Factor | Effect |
|---|---|
| Terrain class | Unit terrain table §5.4 (speed/attack/defense/fatigue) [BASE]. |
| Height | Melee x(1 ± 0.012/m, ±30%) [BASE]; archers +10% range per 10 m above the target; morale T term. |
| Forest | Missile damage taken x0.6; mounted -40% speed; infantry T +0.2; hidden until within 60 m unless scouted (ambush). |
| Rain (`weather.rain`) | Missile hits x(1 - 0.4 rain) [BASE]; reload x1.25 in heavy rain. |
| Mud (`weather.wetness`) | Mounted/chariot speed x(1 - 0.5 wetness); infantry x(1 - 0.25 wetness). |
| Fog / dust storm | Effective range <= 0.5 x visibility (fog 350 m -> 175 m); formations beyond `visibility` are not shown to the enemy. |
| Heat (grishma, >= 34 °C) | Fatigue gain x1.3. |
| Night (hour < 5 or > 20) | Vision x0.4, missile accuracy x0.7, morale -5 for non-guard classes; torches visible on formation standards. |
| River | Shallow water: infantry speed x0.4, defense x0.7 (§5.4); deep water impassable except fords/bridges. |

### 6.11 Commanders and experience

- **Leadership L** per formation [BASE]: commander's own formation 0.9; within 180 m of it 0.7; otherwise 0.5;
  all + commanderSkill/100 (skill 0..20 = the character's martial); fallen commander -> 0.35 for the whole side.
- **Commander falls** when the commander's formation drops below 35% of its starting strength [BASE], or while it
  routs with enemy mounted within 20 m (chance 0.25/s), or when the hero loses a duel. Fate on the results screen:
  50% killed, 30% wounded (character health -0.3), 20% captured (always captured if the formation surrendered).
- **Rally** ability [REQ]: commander formation not engaged; every own formation within 120 m gains +15 morale and a
  `rallied` event; routing formations there with morale > 35 start rallying; cooldown 90 s. Button on the battle
  HUD and key `L` (classic preset; §8.8).
- **Experience** (0..1): new formations 0.1 + barracks/age bonuses (§7.6); after a battle survivors gain +0.1 (won)
  or +0.05 (lost), +0.05 more for each enemy formation they routed; effects attack x(1 + 0.25e), defense
  x(1 + 0.15e), morale +15e. Shown as 0-3 chevrons (0.25/0.5/0.75).

### 6.12 Victory conditions and outcome write-back

| Ends when | Winner |
|---|---|
| One side broken (§6.8) | The other side (reason rout / annihilation / surrender) [BASE] |
| A side withdraws (`withdraw_all`) and has disengaged | The other side (withdrawal) [BASE] |
| Siege conditions (§6.6.5) | siege_breach / siege_held |
| Objective complete (scripted battles) | Objective owner |
| Time limit | Stronger side, draw within 10% [BASE] |

Write-back to the world [BASE core + REQ details]:
1. Casualties by `armyUnitId` (survivors); units below 10% strength merge into a same-class unit of the same army.
2. Army morale: winner +10, loser -25 (clamp 5..100); fatigue +0.1 winner / +0.2 loser.
3. Loser retreats along roads to the nearest friendly settlement or depot; if it has none it disbands.
4. Captured supply: each destroyed/surrendered enemy supply train gives the winner 50% of its carried grain.
5. Prisoners (§6.8), commander fate (§6.11), experience (§6.11).
6. War score: `20 x (enemy losses - own losses) / (both sides' starting soldiers)` to the winner (±20 max per battle).
7. Chronicle line: "The Battle of {place}: {winner} defeated {loser}; {killed} fell." `{place}` = nearest
   `REGION_FEATURES` name within 600 m, else the nearest settlement.
8. A won siege battle captures the settlement (§7.8).

### 6.13 Pause, speed and battle readability

- Space pauses; orders can be issued while paused; speeds 0.5x / 1x / 2x / 4x (8x skirmish only) [BASE loop].
  Auto-pause options (settings, default on): battle start, commander fallen, own formation routed.
- **Readability (AoE):** selection = team-colored footprint ring + formation card highlight; hover = strength bar +
  morale bar + fatigue/ammo pips; order preview: dragging shows the destination footprint and facing arrow;
  queued waypoints shown as dotted lines with numbered pins; projectile arcs visible as instanced arrows following
  `volleyPoint` [BASE]; charge = brief motion streak + dust; routing formations show a broken banner icon and a red
  arrow toward their edge; minimap (§8.7).
- **Close-up (Wukong):** the cinematic camera (`camera_toggle_cinematic`, V-key in classic preset) frames the
  selected formation at 15-30 m with depth of field; impacts get sparks/dust; elephants' charges get a camera
  shake of 0.05 within 60 m (disabled by reduced motion).

### 6.14 Autoresolve and the pre-battle prediction

- Autoresolve runs the same battle headless on a 65^2 terrain window with both sides AI [BASE]; the player-side
  AI uses the player's army stance (aggressive/balanced/cautious -> AI aggression 0.75/0.5/0.3).
- The engagement prompt shows a `BattlePrediction`: attacker win chance, expected losses and up to 4 factor lines
  ("Their elephants outweigh your horse", "You hold the high ground", "Your army is hungry: -10 morale"). Chance =
  logistic(4 x (log(attackerStrength / defenderStrength) + terrain + morale terms)) using `armyStrength` [BASE].
- **Retreat** from the prompt: the retreating army loses 10% of its soldiers (rearguard) unless it is faster than
  the enemy by 20% (then 3%), and moves 1 day's march toward its nearest friendly settlement.

---

## 7. Strategic simulation (world command)

### 7.1 Time model and update order

One tick = 1 game hour; 12 ticks per real second at 1x (day = 2 s). Speeds 0.5x-8x and pause [BASE]. Calendar:
12 months x 30 days; month 0 = Chaitra. Six seasons of two months: vasanta (0-1), grishma (2-3), varsha (4-5),
sharad (6-7), hemanta (8-9), shishira (10-11) [BASE].

Order inside `tickWorld` [BASE skeleton; REQ contents]:

| When | Systems, in this order |
|---|---|
| Every hour | player commands -> calendar -> army movement + contacts -> distant battles |
| New day | weather -> **economy daily** (trickle production, harvest if due, consumption, distribution, storage, prices, population, labor, construction, recruitment) -> **armies daily** (supply, foraging, attrition, fatigue, sieges) -> **politics daily** (loyalty, unrest, rebellion stage) -> diplomacy daily (proposal expiry) -> espionage daily -> events -> AI factions -> objectives/outcomes |
| New month | economy monthly (taxes, trade, tribute, upkeep, administration, ledger, recruit pool regen, debt) -> diplomacy monthly (opinion drift, grievance decay, war weariness) -> politics monthly (stability, legitimacy) -> stats sample -> autosave |
| Month 4 day 1 | **monsoon roll** (§7.3.3) |
| New year | aging, births, deaths, succession checks, governor reviews |

**SettlementModifiers semantics** (building `effects` per level, landmark `settlementEffects`/`realmEffects`):

| Key | Meaning | Example |
|---|---|---|
| foodCapacity | **days** of grain storage (x the settlement's daily consumption) | Granary +45 days/level |
| housing | people housed (absolute) | Housing Quarter +1,500 |
| fortLevel | fort levels (absolute) | Walls & Gates +1 |
| waterAvailability, irrigation, sanitation, publicOrder, loyalty, disasterResistance | absolute points on the 0..1 scale (clamped) | Temple +0.1 order, +0.05 loyalty |
| foodProduction, wealth, taxEfficiency, recruitmentPotential | fractional bonus | Farm Fields +15% production |
| tradeIncome | x `RULES.trade.effectScale` (160) wealth/month | Market L1 +40/month |
| culture | x10 cultural-legacy points per month | Temple L1 +2/month |

Building effects scale with building **condition** (0..1): `effect x level x condition`.

### 7.2 Settlement variables (GDD §6) and their update rules

Initial values come from `makeSettlement` [BASE]; the rules below are the target behavior [REQ].

| Variable | Daily update (unless noted) |
|---|---|
| **population** | `+ pop x 0.012/360 x health x housingFactor`; housingFactor = 1 if pop <= housing else `max(-1, 1 - 2 x (pop/housing - 1))`. Famine (store empty and net < 0): `- pop x 0.0015 x deficitShare` per day. Emigration 0.05%/day to the nearest same-owner settlement when loyalty < 0.3 and price > 2. Floor 50. |
| **labor** | `pop x 0.45 x (0.5 + 0.5 x health)` workers; split by `laborAllocation` (farming / construction / crafts / military; unallocated = idle). Defaults: village 0.75/0.1/0.1/0.05, town/city/capital/port/temple town 0.55/0.1/0.25/0.1, fort 0.55/0.1/0.1/0.25 (`RULES.population.defaultLabor`). |
| **food** | §7.3. |
| **waterAvailability** | `clamp01(0.45 + 0.5 x terrain moisture + Σ water effects - 0.2 x drought)`; drought = monsoon failed (M < 0.7) during grishma/varsha. |
| **irrigation** | `clamp01(0.15 + Σ irrigation effects)`. |
| **waterInfrastructure** | Mean condition of water buildings (tank, stepwell, canal); 0.3 if none. |
| **housing** | `pop0 x 1.1 + 1,500 x housing levels`. |
| **sanitation** | `clamp01(0.4 + Σ sanitation effects - 0.3 x max(0, pop/housing - 1))`. |
| **health** | Drifts 2%/day of the gap toward `0.5 + 0.4 sanitation + 0.1 water - 0.3 hunger - epidemic`. |
| **publicOrder** | Drifts 2%/day toward `0.5 + Σ order effects + 0.1 x (garrison >= 2% of pop) - 0.2 x unrest`. |
| **wealth** (local) | `+ crafts x 0.004/day x (1 + Σ wealth effects)`; lost 30% to looting on capture; feeds trade volume. |
| **taxRate** | Player-set 0-60% (default 15%); `negotiate_rebels tax_cut` lowers it temporarily. |
| **taxIncome / tradeIncome** | Monthly, §7.5. |
| **recruitmentPotential** | Pool cap: `pop x 0.06 x (1 + Σ recruitment effects) x faction recruitmentPool x age bonus`. |
| **recruitPool** | Monthly regen `cap x 0.1 x (0.5 + 0.5 loyalty) x (1 / price) x stage.recruitment`, clamp <= cap; recruiting spends it. |
| **loyalty / unrest / rebellionStage** | §7.9. |
| **infrastructure** | -0.0004/day decay [BASE]; +0.01/day repair while builders are idle and the treasury is positive. Multiplies trade. |
| **damage** | 0..1 from floods, fires, riots, sieges; repaired 0.005/day by idle builders; production x(1 - 0.5 damage). |
| **disasterExposure** | flood = 0.5 within 500 m of a river else 0.1; drought = 1 - moisture; fire = 0.15 + 0.1 x overcrowding; epidemic = 0.1 + 0.3 x (1 - sanitation). Disaster severity x(1 - disasterResistance). |
| **fortLevel / wallHp** | From Walls & Gates (+ landmarks); wallHp = fortLevel x 1,000 x fortDefense; repaired 2%/day when not besieged. |
| **requisitionedFood** | Memory of requisitions; decays 25%/month; drives the loyalty penalty (§7.9). |

### 7.3 Food: harvests, monsoon, storage and distribution

#### 7.3.1 Production

```
P (annual potential) = farmers x 0.32 (foodPerFarmerPerDay) x 360
                     x (1 + Σ foodProduction effects)             fields, canals
                     x (0.5 + 0.5 x max(waterAvailability, irrigation))
                     x (0.6 + 0.5 x province fertility x sandbox fertility)
                     x (1 - 0.5 damage) x stage.production x (besieged ? 0.3 : 1)
farmers              = labor x laborAllocation.farming
daily trickle        = P / 360 x 0.4 x seasonTrickle[season]      (vasanta 1.1, grishma 0.7, varsha 0.9,
                                                                   sharad 1.2, hemanta 1.0, shishira 1.1)
kharif harvest       = P x 0.35 x kharifYield x kharif.health      on day 15 of month 7 (Kartika)
rabi harvest         = P x 0.25 x rabiYield  x rabi.health         on day 15 of month 1 (Vaishakha)
```

`RULES.harvest` holds the shares (0.4 / 0.35 / 0.25 - sum 1), sowing months (kharif 4, rabi 8) and the harvest
day. Crop health starts at 1 when sown; -0.3 if an enemy army camps or forages within 600 m during the sowing
month; reduced pro rata if farming labor is cut below the level at sowing; -0.2 for riverside settlements on a
flood event.

#### 7.3.2 Monsoon yields

```
Ym          = M >= 1 ? 1 + 0.25 x (M - 1)/0.4          (monsoonYieldBonus 0.25 at M = 1.4)
                     : max(0.3, 1 - 0.45 x (1 - M)/0.3)  (droughtYieldPenalty 0.45 at M = 0.7)
kharifYield = Ym x (1 - 0.6 irr) + 0.6 irr x 1.3          (irrigation shields the monsoon crop)
rabiYield   = (0.7 + 0.3 x min(M, 1.2)) x (1 - 0.5 irr) + 0.5 irr x 1.3
```

#### 7.3.3 The monsoon roll

On day 1 of month 4: `M = clamp(normal(1.0 x sandbox.monsoonStrength, 0.18), 0.4, 1.4)`; in sandbox, with
probability `droughtRisk` the year is a drought (`M = U(0.45, 0.7)`). A scenario's `monsoonStrength` sets M for
the starting year (The Broken Crown: 0.7). The sim stores it in `WorldState.monsoon` [REQ] and sets world event
flags `monsoon_failed` (M < 0.7) / `monsoon_flood` (M > 1.2), cleared in month 8. Floods: `weather.flood =
clamp01((M - 0.9) x 2)` at the varsha peak (month 5) - fords close above 0.5; riverside settlements roll the
flood event. The UI shows a monsoon forecast bar in month 3 (±0.15 accuracy; exact with a court scholar learning
>= 12).

*Calibration (tested, §13.2):* normal monsoon annual civilian balance - Suvarna +15%, Giridurga -9%, Nilavana
+3%, Marudesha -8%, free towns -4%. M = 0.7: every realm in deficit, Suvarna about -3% before feeding its armies
(-12% with them) - the Act II crisis.

#### 7.3.4 Consumption, storage, spoilage

- Consumption/day = `pop x 0.1 x (rationing ? 0.85 : 1)` + garrison soldiers x upkeepFood.
- Capacity = `pop x 0.1 x (90 + Σ foodCapacity days x level)`; grain above capacity **spoils immediately**
  (toast: "312 measures spoiled at Kusumpur - build a granary").
- Spoilage = `stored x 0.0008/day x (granary ? 0.6 : 1) x (Royal Granary landmark ? 0.5 : 1)`.
- Reserve days `rd = foodStored / consumption` drive prices (§7.4) and the UI color (green > 90, amber 30-90,
  red < 30).

#### 7.3.5 Moving grain inside a realm (`RULES.distribution`)

1. **Internal market (daily):** for each connected component of owned settlements (roads with condition >= 0.5,
   not blocked by an enemy army), settlements with rd > 120 export 5%/day of their stock above 120 days into a
   pool; settlements with rd < 60 import from the pool in proportion to their need (to 60 days), losing 10% in
   transport. Exporters receive `0.1 x price x amount` wealth (sales).
2. **Grain tax (at each harvest):** the crown takes `10% x harvest x (taxRate / 0.15) x compliance` from every
   owned settlement left with >= 90 reserve days, into `FactionState.foodReserve` (the royal granaries).
3. **Relief (daily):** an owned, connected settlement below 30 reserve days draws up to 30 days/month from the
   royal reserve automatically, unless the player sets the policy "Hold the reserve" (economy panel toggle).
4. **Armies** draw from settlements, depots or the reserve (§7.8).
5. **Rationing** (event flag `rationing`, 120 days): consumption x0.85, unrest +0.002/day, health -0.002/day.

### 7.4 Prices

```
targetPrice = clamp(1 + 1.4 x (1 - min(1, rd / 60))          (priceElasticity 1.4)
                    - 0.25 x clamp01((rd - 180) / 180)
                    + (starving ? 1 : 0), 0.5, 4)
price      += (targetPrice - price) x 0.1 per day
```

Effects: unrest +0.001/day per 0.1 of price above 1.3; tax compliance `clamp(1.3 - 0.3 price, 0.6, 1)`; recruit
regen x1/price; loyalty -0.15 x (price - 1); the market's grain lot price x price (§7.5). Example: Rajapura at 30
reserve days -> price 1.7 -> unrest +0.004/day (protest in ~2.5 months if nothing changes).

### 7.5 Taxes, trade, market, materials, ledger

```
tax_s   (monthly) = pop x 0.02 x 10 x taxRate x policy.income x compliance x (0.4 + 0.6 loyalty)
                    x faction taxEfficiency x (1 + Σ taxEfficiency effects + (governor stewardship - 10) x 0.01)
                    x stage.tax x (1 - 0.5 x province autonomy) x difficulty.playerIncome|aiIncome
trade_s (monthly) = (pop x 0.002 + crafts workers x 0.004 + 160 x Σ tradeIncome effects)
                    x faction tradeIncome x infrastructure x (0.5 + 0.5 x connected road share)
                    x (1 + 0.15 x trade treaties) x (1 + 0.1 x luxury resources) x stage.trade x (besieged ? 0 : 1)
tribute           = per treaty: 10% of the payer's last monthly income unless terms.tributePerMonth set
army upkeep       = Σ soldiers x upkeepWealth (variants applied)
building upkeep   = Σ upkeepWealth x level
administration    = owned settlements x 4 x governanceCost + 6 per settlement beyond 2 x governorSlots(age)
net               = tax + trade + tribute in - army - buildings - administration - tribute out
```

| Tax policy | Income | Unrest/month | Loyalty | Legitimacy/month |
|---|---|---|---|---|
| lenient | x0.7 | -0.02 | +0.05 | 0 |
| standard | x1 | 0 | 0 | 0 |
| heavy | x1.35 | +0.0135 | -0.05 | -0.005 |
| emergency | x1.7 | +0.017 | -0.12 | -0.015 |

*Worked example (Suvarna, month 1):* 38,600 people at 15% tax, loyalty 0.65 -> **≈1,050 wealth/month** tax +
≈250 trade; armies (1,650 soldiers) cost **≈670/month**, buildings ≈70, administration ≈26 -> net ≈ +530/month.
A new spear formation (360) or a granary (200 + materials) per month is the intended starting cadence.

**Debt** (treasury < 0): unpaid armies lose 2 morale/day and 0.5% of soldiers/day; construction pauses; stability
-0.01/month per 1,000 of debt; legitimacy -0.01/month.

**Market exchange** (needs a Market in any owned settlement; AoE-style, `RULES.market`): lots of 100; base buy
prices grain 14, timber 60, stone 90 wealth; each lot bought raises that price 3%, each lot sold lowers it 3%;
selling returns 70% of the current buy price; prices recover 1%/day toward base; clamp 0.5x-3x. Grain bought goes
to the royal reserve. Trade treaties with a faction owning the resource lower its buy price 10%.

**Materials** (faction stockpiles `FactionState.materials.timber/stone` [REQ]): Workshops produce 8 timber/day per
level (x0.5 without a `timber` resource) and 2 wealth; Quarry & Mine produces 6 stone/day per level and 3 wealth,
only on a stone/iron/copper deposit; production requires >= 50 crafts workers per level. Starting stockpiles per
scenario (`ScenarioDef.materials`): Suvarna 600/300, Giridurga 300/900, Nilavana 1,200/100, Marudesha 150/250.

The **ledger** (`FactionLedger`) is shown on the treasury tooltip with last month's figures and a projection.

### 7.6 Labor, construction and recruitment

**Construction** (`RULES.construction`, costs in §8.2 table):

```
cost(level n)  = level-1 cost x 1.6^(n-1)        (wealth, timber, stone, labor)
days(level n)  = buildDays x 1.3^(n-1)
crew           = labor cost / days                (nominal builders)
builders       = max(20, labor x laborAllocation.construction)
progress/day   = min(1.25, buildersAssigned / crew) / days x faction constructionSpeed x (varsha ? 0.7 : 1)
```

- Wealth and materials are paid when the job is queued (refused if short: "Need 120 timber"); labor is supplied
  over time. Up to **3 jobs progress in parallel** per settlement (builders fill jobs in queue order, each capped
  at 1.25 x crew); queue max 5. Housing and workshops ignore the monsoon factor.
- Cancel refunds 90% of the unspent cost (`cost x (1 - progress) x 0.9`). Upgrades are jobs with targetLevel + 1.
- Requirements: building `age` <= faction age, `requires` present (any level), `allowedIn` settlement kind,
  level cap of the age (`AgeDef.buildingLevelCaps` / `maxBuildingLevel`), a valid placement (§8.2).
- *Example:* Granary L1 at Dhanyagram: 200 wealth + 120 timber + 40 stone, crew 100, builders 126 -> ratio 1.25
  -> **20 days (40 s at 1x)**. Palace at Rajapura: crew 167, capped -> 144 days (≈5 min).

**Recruitment:**
- Needs: a building in the settlement that unlocks the class (`unlocksUnits`), the class in the faction roster,
  the class's age reached and not retired, elephant source for elephants (§5.8), and `recruitPool >= cost.population`.
- Cost (wealth, grain from the settlement store, recruits from the pool) paid at queue; mounted classes -20%
  wealth with a `horses` resource; 1-4 formations per job; `recruitDays` x faction/variant multipliers.
- New formations: experience 0.1 + 0.1 per Barracks level above 1 + age `recruitBonus`; morale = baseMorale +
  age morale bonus; output to the garrison or a target army in the settlement.
- A Supply Train is loaded with 3,600 grain from the settlement store when raised (if the store has less, it
  carries what there is).

### 7.7 Armies on the strategic map

- **Path planning** [REQ]: A* over `world.roads`; edge cost (hours) = `length x travelScale / (marchKmPerDay[q] x
  1000 / 24) / roadCondition` where roadCondition = `0.5 + 0.5 x condition` (x0.25 below 0.3), blocked edges
  excluded; off-road legs to/from the nearest node at off-road pace with terrain factors (forest/marsh 0.6 x
  forestMovement, hills/rough 0.7 x hillMovement, shallow water 0.4; deep water impassable except at fords and
  bridges; fords closed while flood > 0.5). Fallback: straight line [BASE].
- **Speed** (km/day) = `marchKmPerDay[road|offroad]` (30/24/18/12) x pace(slowest category: infantry/ranged 1,
  mounted-only 1.5, elephants 0.95, support 0.85; chariots 0.6 off-road) x faction marchSpeed x monsoon (0.6; 0.8
  on royal roads) x `(1 - 0.3 x wetness x (road ? 0.4 : 1))` x `(1 - 0.3 x fatigue)` x forced march 1.3.
  *Examples:* Rajapura -> Setupur (≈30 km of royal road) ≈ 1 day; Rajapura -> Giridurg (≈81 km) ≈ 3.4 days by road,
  ≈ 6.8 days across country.
- **Forced march** (army panel toggle): x1.3 speed, +0.1 fatigue/day, 0.2%/day attrition.
- **Stances**: aggressive (contact radius x1.3, seeks battle), balanced (x1), cautious (x0.8; avoids contact when
  its strength ratio < 0.6 and it is at least 10% faster - "evades").
- **Visibility** [REQ]: an enemy army is visible if within `(350 + 250 if scouts) x scoutRange` map m of any own
  army or settlement, 900 m of a Watchtower, or the observer's intel on its owner >= 0.6 (§7.11). Hidden armies
  leave a ghost marker at the last known position for 5 days.
- **Contact -> engagement**: hostile armies within 140 m x stance factor create an engagement [BASE]; the
  marching army is the attacker. Player involved -> world pauses on the engagement prompt.
- **Split / merge / disband** [REQ]: split selected units into a new army (same commander slot empty); merge
  armies within 100 m; disband returns soldiers to the nearest own settlement's recruit pool (50%).

### 7.8 Supply, depots, foraging, requisition, attrition and sieges

```
consumption/day = Σ soldiers x upkeepFood x soldierFoodPerDay / faction supplyEfficiency
carried         = Σ soldiers x upkeepFood x 5 days  +  carts x 300
```

*Example:* the Royal Host (≈820 soldiers incl. 8 elephants, 12 carts) eats **195 grain/day** and carries 4,575 ->
**23 days** without resupply.

Resupply each day, first match [REQ]:
1. An own settlement within 400 m (+ its radius): draw up to 20% of its store, never leaving it below 30 days.
2. An own depot within 400 m.
3. The royal reserve through a supply line: the army stands in an owned province and a road path of owned/
   neutral territory with no enemy army within 300 m connects it to an own settlement; deliveries lose 10% per
   30 km. `ArmySupplyState.lineIntact` reflects this.

- **Depots** (`create_depot`): 150 wealth + 50 timber, 5 days to build, capacity 6,000; filled by
  `transfer_supply` or requisition; an enemy army within contact radius raids it (all food lost, grievance).
- **Foraging** (no source, or `forage` order): meets `need x 0.35 x province fertility x forageSeason` (vasanta
  1.4, grishma 0.5, varsha 0.7, sharad 1.5, hemanta 1.1, shishira 0.9) taken from the nearest settlement within
  600 m. Own settlement: unrest +0.004/day, loyalty -0.002/day. Enemy settlement: plunder x1.7 the amount,
  damage +0.01/day, grievance `raid` (-10 opinion).
- **Starvation:** morale -6/day [BASE]; after 3 days desertion 1%/day; after 10 days 3%/day.
- **Attrition** (per day, share of soldiers): monsoon off-road 0.2%, hills/forest off-road 0.1%, dry plain in
  grishma without a settlement in range 0.3%, besieging 0.4% [BASE value].
- **Requisition** (`requisition_grain`): take up to 60% of an own settlement's store to an army, depot or the
  reserve; `requisitionedFood += amount`; loyalty -0.02 per 1,000; the loyalty memory decays 25%/month. This is
  step 1 of the GDD §6 chain (§7.13).

**Sieges:**
- `besiege` an enemy settlement with fort level >= 1: it becomes besieged (trade 0, production x0.3, no
  resupply, no recruitment); its store feeds population + garrison.
- Wall damage/day = `Σ soldiers x siege x 0.5 x siegeStrength` (engineers 40 x 4 x 0.5 = 80/day); wallHp =
  fortLevel x 1,000 x fortDefense (Giridurg: 3 x 1,000 x 1.4 = **4,200** -> ~52 days with one engineer formation;
  Royal Elephant Corps adds 20/day).
- Assault options: when wallHp <= 50% (breach) or after ladders (5 days with engineers): **Assault** = siege
  battle (§6.6.5). **Starve out:** once the store is empty, daily surrender chance `0.1 x starvationDays / 10`
  (cap 0.6). Relief armies arriving fight the besiegers in a field battle.
- **Capture:** owner changes; loyalty 0.2, unrest +0.3, building condition -0.2, 30% of local wealth looted;
  occupation penalty to loyalty for 360 days (linear). On capture the player chooses **Occupy** (default),
  **Plunder** (loot x2, population -10%, unrest +0.3, legitimacy -0.03, opinion -10 with everyone) or, for a
  settlement that was independent at scenario start, **Liberate** (it becomes independent again; opinion +10 with
  all; prestige +10).

### 7.9 Politics: loyalty, unrest, rebellion, governors, stability

**Loyalty** (per settlement, daily: `loyalty += (target - loyalty) x 0.02`):

```
target = 0.5 + 0.3 x (legitimacy - 0.5) - 1.0 x max(0, taxRate - 0.15) + policy.loyalty
       - 0.15 x max(0, price - 1) - min(0.15, requisitionedFood / (pop x 0.1 x 30) x 0.1)
       + Σ loyalty effects + governorTerm - 0.3 x unrest - 0.2 x occupation(1 -> 0 over 360 days)
governorTerm = (governor ? (governor.loyalty - 0.5) x 0.2 + (interest satisfied ? 0.05 : 0) : 0)
```

**Unrest** (daily, clamp 0..1, x `sandbox.rebelliousness x 2` on the gains):

```
+ 0.02 if starving  + 0.001 per 0.1 price above 1.3  + 0.002 if loyalty < 0.35
+ 0.01 x max(0, pop/housing - 1)  + 0.001 if sanitation < 0.3  + policy unrest (monthly)
- 0.004 x publicOrder  - min(0.004, garrison soldiers / (pop x 0.02) x 0.002)
```

**Rebellion ladder** (GDD §7). Stage by unrest thresholds `BALANCE.politics.rebellionThresholds`; going down a
stage requires unrest below threshold - 0.05. Each stage multiplies the settlement (`RULES.politics.stageEffects`):

| Stage | Unrest >= | Tax | Trade | Recruits | Production | Condition/day | Dramatized by |
|---|---|---|---|---|---|---|---|
| calm | 0 | 1 | 1 | 1 | 1 | 0 | - |
| grumbling | 0.15 | 0.95 | 1 | 0.95 | 1 | 0 | notification |
| protest | 0.30 | 0.85 | 0.9 | 0.8 | 1 | 0 | `evt_protest` |
| tax_refusal | 0.45 | 0 | 0.7 | 0.5 | 0.95 | 0 | `evt_tax_refusal` |
| unrest (riots) | 0.60 | 0 | 0.5 | 0 | 0.85 | -0.005 | `evt_riots` |
| revolt | 0.75 | 0 | 0 | 0 | 0.7 | -0.01 | `evt_revolt` |
| secession | 0.90 | 0 | 0 | 0 | 0.7 | 0 | - |

- **Revolt** spawns a rebel army [REQ]: `pop x 0.03` soldiers as spearmen and archers (2:1), owned by the reserved
  faction id `rebels` (hostile to the settlement's owner and nobody else), which besieges the garrison.
- **Secession** after 30 days in revolt without the rebels being defeated or appeased: the settlement becomes
  independent (owner null); if it was a province capital, every settlement of that province gains +0.2 unrest.
- **Player responses** (`negotiate_rebels`): relief (30 days of grain + 2 wealth per 100 people: unrest -0.25,
  loyalty +0.1), tax cut (-5 points for 180 days: unrest -0.15, loyalty +0.05), autonomy (province autonomy +0.25:
  unrest -0.3, tax -25%, governor loyalty +0.2, legitimacy -0.02), coercion (needs a garrison of 2% of pop or an
  army present: unrest -0.35, loyalty -0.15; if loyalty < 0.3 a 30% chance it escalates one stage instead);
  military intervention = defeat the rebel army.

**Governors** (one per province; slots by age: 2 / 4 / 7; each above the limit costs -0.02 legitimacy/month):
tax +1% per stewardship point above 10; interest satisfied gives +0.05 loyalty in the province (wealth: province
tax rate <= 15%; power: autonomy >= 0.25 or a council seat; faith: temple level >= 2 in the province capital;
family: married or the heir is of their family; land: province has >= 2 owned settlements; learning: a Stupa or
culture >= 0.3). A governor with loyalty < 0.3 and ambition > 0.6 issues **demands** (governor events); below 0.15
attempts **secession** (all province settlements +0.3 unrest).

**Faction stability** drifts 10%/month toward
`0.5 + 0.3 x (legitimacy - 0.5) + 0.2 x avg settlement loyalty - 0.3 x share of settlements at protest or worse
- 0.05 x wars beyond 6 months + 0.05 per battle won / -0.05 per battle lost in the last 3 months`.
**Legitimacy**: +0.01/month while the succession is settled and the ruler is an adult; -0.02/month while
unresolved with a living claimant; -0.03 for declaring war without a grievance; event effects (§9).

### 7.10 Diplomacy (GDD §7)

| Treaty | Effect | Duration | Breaking it |
|---|---|---|---|
| peace | Ends the war (**`sign_treaty` with type peace must end the war** [REQ]); truce: no war for 360 days | permanent | opinion -40, trust -0.15 with everyone, grievance |
| trade | +15% trade income both; market prices for the partner's resources -10%; +1 opinion/month (max +20) | 720 days, renewable | opinion -20 |
| military_access | Armies may cross and resupply in the partner's land | 360 | opinion -15 |
| mutual_defense | Each joins the other's defensive wars (AI if opinion > 0; the player gets a prompt) | 720 | opinion -40 |
| tributary | Payer sends 10% of its monthly income to the overlord; the overlord defends it; payer province autonomy +0.25; `sign_treaty a,b,'tributary'` = **a overlord, b payer** [REQ] | permanent | opinion -30 |
| marriage_alliance | Opinion +30, trust +0.2, implies non-aggression, children carry claims | while both spouses live | opinion -60, legitimacy -0.1 |
| non_aggression | No war declarations | 360 | opinion -25 |

Age gates (`AgeDef.unlockTreaties`): Janapada - peace, trade, non-aggression; Mahajanapada adds military access,
mutual defense, tributary, marriage alliance.

**Opinion** (-100..100): drifts toward 0 by 2/month; grievances (raid -10, broken treaty -40, spy caught -20,
insult -15, marriage refused -10, war -20) decay 10%/month; shared enemy +10; trade +1/month.
**AI acceptance utility** (accept if U > 0; `RULES.diplomacy.acceptance`, all x faction diplomacyOpinion on the
opinion term):

| Proposal | U = |
|---|---|
| peace | -10 + 0.3 opinion + 0.5 x (-warScore if losing) + war weariness months + 20 if weaker |
| trade | 15 + 0.5 opinion + 25 if mercantile |
| military_access | -20 + 0.6 opinion + 20 trust + 30 if shared enemy |
| mutual_defense | -35 + 0.6 opinion + 30 trust + 40 x shared threat |
| non_aggression | 10 + 0.4 opinion + 30 x threat from proposer |
| tributary (demanded of them) | 40 x (proposer/receiver strength - 1.5) + 30 if losing the war - 20 if defensive/proud + 0.2 opinion |
| marriage_alliance | 15 + 0.5 opinion + 1 per 5 prestige difference + 20 if diplomatic |

The AI's reply shows the three largest terms as reason lines ("They fear your army (+24)", "They remember the
raid at Kandaravasa (-10)"). Proposals expire after 30 days.

**War score** (-100..100): battles (§6.12), +15 per enemy settlement held (capital +30), +2/month of occupation.
War weariness +3/month at war; an AI sues for peace below its personality's `peaceWarScore`.
**Marriage**: both characters unmarried, 16-40, at least one not a ruler; `arrange_marriage` sends a proposal.

### 7.11 Espionage (GDD §7)

Agents: max `1 + spymaster intrigue / 5`. Missions run until progress reaches 1 (`RULES.espionage.missionDays`
nominal: intel 20, counter 30, sabotage 25, incite 35, rumors 30, protect court 30).

```
success/day = 0.03 x (0.5 + skill/20) x (1 + network) x espionage modifier / (1 + target counterIntel)
risk/day    = 0.01 x (1 + 1.5 x target counterIntel) x (1.5 - skill/20)      (captured on a failed roll)
```

| Mission | On success |
|---|---|
| gather_intel | intel on target +0.4; their armies visible for 60 days |
| counter_intelligence | own counterIntel +0.3 for 90 days (doubles enemy agents' risk) |
| sabotage_supply | target army or depot loses 40% of its food, or a road edge -0.4 condition |
| incite_unrest | target settlement unrest +0.2 (+0.3 where a claimant lives) |
| spread_rumors | target legitimacy -0.05, stability -0.03; others' opinion of them -10 |
| protect_court | own legitimacy losses from plots -50% for 120 days |

Captured agent: grievance `spy_caught` (-20); a character agent is imprisoned (event). Intel decays 0.08/month.
**Intel tiers** (what you see about a rival): < 0.3 armies in scout range and owners only; 0.3-0.6 army sizes
±25%, treasury and stability brackets; >= 0.6 exact numbers, governors, loyalty and the AI's current goal.

### 7.12 Dynasty, succession and council

- **Aging:** health -0.03/year from 50, -0.06 from 60, -0.12 from 70; health 0 = death. Births: married couples
  aged 18-40 have a 10%/year chance of a child. Adult at 16.
- **Succession** on the ruler's death by `SuccessionLaw`: designated heir (Suvarna) / eldest child
  (primogeniture, Marudesha) / council election (Giridurga: the dynasty member or general with the highest
  martial + diplomacy + prestige/10) / seniority (Nilavana: eldest adult of the dynasty). Heir under 16 ->
  regency (legitimacy -0.1). No heir -> adopt any loyal general/governor (legitimacy -0.2); none -> the line ends
  (defeat in sandbox; scenario defeat if its outcomes say so).
- **Crisis:** chance `0.35 x (1 - legitimacy) x (claimant alive ? 2 : 1)` (cap 0.9): the claimant's province revolts
  and he raises an army; legitimacy -0.05 for the new ruler. The campaign continues with the heir
  (`dynasty.generation + 1`).
- **Council** (`CouncilSeat`): chief minister (order, relief), commander (military), treasurer (economy),
  spymaster (espionage), court scholar (culture, succession, omens). Each seat recommends at most one action a
  month on its topic; event choices tagged with an `advisorSeat` show "Recommended by <advisor>" - **competing
  advice** is the point. Following an advisor +5 opinion; ignoring -3; three ignored in a row -> grievance (-10)
  and the advisor may leak (rival intel on you +0.1).

### 7.13 Systemic events and the GDD §6 consequence chain

Events (`EVENTS`, 51) fire from scheduled scripts, chains (`trigger_event`) or conditions checked daily
(probability `1/meanDays` once the trigger holds) [BASE]. Ignored player events auto-resolve with their **first
choice, which is always the safe default** (tested). Narrative events are gated by scenario flags (`bc_act`,
`sh_act`); systemic ones run everywhere and use scope references so AI factions can resolve them.

**The GDD §6 chain, implemented twice** - as authored campaign events (Broken Crown) and as a systemic loop
(sandbox):

| GDD step | System | Campaign event | Systemic event |
|---|---|---|---|
| 1. Ruler requisitions grain for a siege | `requisition_grain`, `requisitionedFood` | `evt_bc_siege_grain` (day 138): requisition Dhanyagram / buy / forage | `evt_grain_requisition` (at war, a store > 8,000) |
| 2. The army wins, provincial reserves fall | battle + store x0.5 | (battles) | (battles) |
| 3. Prices rise, farmers dissatisfied | §7.4 prices, loyalty | `evt_bc_bread_price` (+25 days) | `evt_prices_rise` |
| 4. Recruitment and tax revenue decline | compliance, recruit regen, recruitPool x0.7 | effects of "ignore" | effects of "ignore" |
| 5. A governor demands relief or threatens rebellion | governor loyalty, `evt_..._ultimatum` | `evt_bc_governor_ultimatum` (+40 days, Governor Chandralekha) | `evt_governor_demands` |
| 6. Relief, negotiation, coercion or military intervention | `negotiate_rebels` + event choices | relief / negotiate / coerce -> `evt_bc_fields_refuse` / intervene (needs 1,200 soldiers) | same four |
| Escalation | rebellion ladder | `evt_bc_dhanya_secession` (Dhanyagram looks to Marudesha) | `evt_tax_refusal`, `evt_riots`, `evt_revolt` |

Other systemic events: flood (`evt_monsoon_flood`), failed monsoon (`evt_failed_monsoon`), golden harvest,
fever, bazaar fire, bandits, pilgrims, salt caravan, elephant fair, protest/tax refusal/riots/revolt. Frequencies
(per eligible faction): flood ≈ 26%/year in riverside realms; failed-monsoon fallback ≈ 21%/year (or whenever the
monsoon roll fails); golden harvest ≈ 30%/year with irrigation >= 0.3; fever ≈ 45%/year below 0.45 sanitation;
bandits ≈ every 100 days at unrest >= 0.25.

### 7.14 Campaign AI

- Plans daily [BASE hook]: scores goals `defend / conquer / develop / stabilize / ally / secure_supply` with its
  personality weights (`AI_PERSONALITY_DEFS`) x situation (threat, opportunity, hunger, unrest) and issues the
  same `StrategicCommand`s as the player. Event choices by `aiWeight`.
- **War declaration:** when `(own strength / target strength) x (1 - opinion/200) > warRatio - aiAggressionBonus`
  (difficulty + sandbox aggression) and no truce/treaty forbids it. Opportunists add +0.3 to the ratio against a
  target with a famine (any settlement starving), a revolt or a battle lost in the last 60 days.
- **Peace:** sues when war score < `peaceWarScore`; accepts per §7.10.
- **Economy:** keeps 60 reserve days in its capital; builds granaries when spoilage occurs; recruits up to
  `0.04 x population` soldiers (x1.3 expansionist, x0.7 mercantile); ages up when requirements hold, choosing the
  landmark whose effects match its top weight.
- **Difficulty** changes resources and sharpness, not rules (§10.3).

---

## 8. The Age of Empires layer

### 8.1 Resources and the HUD bar

The top bar shows six resources in AoE order (`RESOURCE_BAR_ORDER`), each with a procedural icon, the current
value and the trend:

| Resource (AoE analogue) | Icon | Value shown | Trend | Tooltip |
|---|---|---|---|---|
| **Grain** (food) | sheaf | Σ owned settlement stores + royal reserve | net/day (green/red) | Reserve days per settlement (worst 3), royal reserve, armies' daily need |
| **Timber** (wood) | logs | faction stockpile | +/day from workshops | Producing settlements; queued costs |
| **Stone** (stone) | block | faction stockpile | +/day from mines | Producing settlements |
| **Wealth** (gold) | coins | treasury | net/month | Last month's ledger and projection |
| **Labor** (villagers) | villager | total workers | idle count badge | Allocation totals; idle builders (click to cycle) |
| **Recruits** (population cap) | spear | Σ recruit pools / Σ caps | regen/month | Soldiers under arms; upkeep |

On phones the bar collapses to Grain / Wealth / Recruits + an expand chevron (§12.3).

### 8.2 Building placement and construction

**The settlement grid.** Every settlement owns a square grid of 4 m cells centered on it (`RULES.construction.gridCell`)
covering radius r + 60 m. Placement classes (`BuildingFootprint.placement`):

| Placement | Valid cells |
|---|---|
| inner | Cell centers within 0.85 r (inside the walls) |
| outer | Ring from r to r + 60 m (fields, tanks, watchtowers) |
| perimeter | The wall ring itself (Walls & Gates, Citadel landmark) - no manual placement; gates snap to road exits |
| shore | Within 20 m of water on the settlement's side (ghats, harbors, Lamp Tower) |
| road | Adjacent to a road edge within 200 m of the settlement (Road Station, Great Road) |
| resource | Within 120 m of the settlement's deposit marker (Quarry & Mine; one marker per stone/iron/copper resource) |

A cell is blocked by: existing footprints (+1 cell margin), water, slope > 0.25, roads (except `road` placement).
Footprints are multiples of 4 m (tested). Rotation in 90° steps (R key / two-finger twist / rotate button).

**Placement flow (PC):** click a building on the command card -> a ghost follows the cursor snapped to the grid,
tinted green (valid) or red (invalid, with the reason under the cursor: "Needs the river bank", "Too steep",
"Need 40 stone") -> left-click places (Shift+click to queue another) -> right-click/Esc cancels.
**(Touch):** tap the card button -> ghost appears at the best valid spot (closest to the center) -> drag to move,
two-finger twist to rotate -> tap the green tick to confirm / red cross to cancel.

Placement is stored on the instance [REQ, additive]: `BuildingInstance.cell?: [number, number]` and
`rot?: 0 | 1 | 2 | 3`; starting buildings without a cell are laid out by the procedural layout as today.

**Construction visuals** (`RULES.construction.stages`, driven by `ConstructionJob.progress`):

| Progress | Stage | Visual |
|---|---|---|
| 0 - 0.10 | Foundation | Stakes and string lines on the footprint, dug earth, a pile of materials |
| 0.10 - 0.60 | Scaffolding | Bamboo scaffold cage; walls rise with progress (height = progress / 0.6) |
| 0.60 - 1.00 | Roofing | Thatch/tiles/dome appear; scaffold removed at 95% |
| 1.00 | Complete | Dust puff, bell chime, toast "Granary complete at Dhanyagram" |

Builders (`workers x level` villagers, quality-capped) hammer, carry headloads and climb the scaffold. Upgrades show
a scaffold wrap around the existing building. Damaged buildings (condition < 0.5) smoke and look charred; repair
jobs reuse the scaffold stage. Landmarks use the same stages, 1.5x taller scaffolds and a banner on top.

### 8.3 Villagers: labor you can see

Each visible settlement spawns cosmetic villagers (soldier-buffer path, `work` animation) up to the quality cap
(low 30, medium 60, high 120, ultra 200 per settlement in view), split by `laborAllocation`:

| Allocation | Where and how they appear |
|---|---|
| farming | In field plots: sowing (months 4 and 8), weeding, harvest with sickles and sheaves (months 7 and 1), ox ploughs in vasanta |
| construction | On active construction sites (stages above); idle builders sit in the shade near the well (readable "idle" pose) |
| crafts | At workshops (potters' wheels, looms, smithies), carriers between workshop and market |
| military | Drilling at barracks; sentries on walls and gates |
| (always) | Water carriers between well/ghat and houses; carts from fields to the granary on harvest days |

Count = `min(cap, labor x 0.01)`. Starving settlements show queues at the granary; protests show crowds at the
governor's house; riots show fires (§7.9).

### 8.4 Ages: Janapada -> Mahajanapada -> Samrajya

A faction advances by **completing one of its landmarks for the next age** (AoE IV style). The landmark can be
started only when the requirements hold; completion changes the age at once (3 s fanfare: camera swoops to the
landmark, conch + drums, the new buttons light up on the command card).

| Age | Requirements to start the landmark | Unlocks buildings | Unlocks units | Treaties | Max building level | Bonuses on reaching | New recruits | Governor slots |
|---|---|---|---|---|---|---|---|---|
| **I. Janapada** - Age of Clans and Villages | (start) | Farm Fields, Granary, Village Tank, Market, Workshops, Quarry & Mine, Barracks, Stables, Housing, Temple, Ghat, Walls & Gates, Watchtower | Spearmen, Archers, Chariots, Engineers, Scouts, Supply Train | peace, trade, non-aggression | 2 (fields 3, housing 3, walls 1) | - | - | 2 |
| **II. Mahajanapada** - Age of Great Realms | in Janapada; 3 settlements, 1 province, 12,000 people, 6 building types, legitimacy >= 0.40, stability >= 0.35 | Irrigation Canal, Stepwell, River Harbor, Road Station, Elephant Stables, Drains & Wells, Stupa & Vihara, Palace | Royal Guards, Horsemen, War Elephants | + military access, mutual defense, tributary, marriage alliance | 3 (fields 4, housing 5, walls 2, palace 1, elephant stables 1) | tax x1.05, recruitment pool x1.1 | +0.05 exp, +3 morale | 4 |
| **III. Samrajya** - Age of Empire | in Mahajanapada; 8 settlements, 3 provinces, 40,000 people, 12 building types, legitimacy >= 0.55, stability >= 0.50 | - (all levels up to max) | - (chariots retired) | - | 6 (building max) | tax x1.1, governance x0.9, supply x1.1, diplomacy x1.1 | +0.1 exp, +6 morale, +0.5 armor | 7 |

Rules: one landmark per faction per age; starting one hides the other option; a landmark cannot be cancelled
after 50%; losing the landmark's settlement later does **not** revert the age (the bonus effects of that landmark
are lost while it is not owned). Suvarna and Giridurga start the campaign in Mahajanapada; Marudesha in Janapada.
Reaching Samrajya in the 540-day campaign requires expanding to 8 settlements (Suvarna starts with 5) - by the
temple town, the port charter, Shilapur or conquest - and is the "great ending" garnish of any victory
(epilogue line + statistics), not a requirement.

### 8.5 Landmarks (civ-unique)

| Faction | Age | Landmark (local name) | Cost (wealth / timber / stone / labor) | Days | Where | Effect |
|---|---|---|---|---|---|---|
| Suvarna | II | Hall of a Hundred Pillars (Shatastambha Sabha) | 1,500 / 600 / 500 / 12,000 | 75 | town, city, capital | Governing costs -15%. Host +15% tax, +0.1 order. All settlements +0.03 loyalty. +0.05 legitimacy |
| Suvarna | II | The Royal Granary (Dhanyakosha) | 1,200 / 800 / 400 / 10,000 | 70 | town, city, capital | Host +120 storage days. Realm spoilage -50%, army supply +15%, disasters -10% |
| Suvarna | III | Pillars of the Spoken Law (Shasana Stambha) | 4,000 / 1,200 / 2,000 / 30,000 | 120 | capital, city | All settlements +0.08 order, +0.05 loyalty. Governing -15%. +0.1 legitimacy and stability |
| Suvarna | III | The Great Road (Mahapatha) | 4,500 / 2,000 / 1,500 / 36,000 | 130 | capital | Owned roads within 2 links of the capital become royal roads. March +15%, trade +15%, supply +10% |
| Giridurga | II | Oath Stone of the Seven Clans (Saptakula Shila) | 1,100 / 300 / 900 / 10,000 | 70 | fort, town, city, capital | All settlements +0.08 loyalty. Diplomacy +15%, recruitment pool +15% |
| Giridurga | II | The Cliff Cistern (Giri Pushkarini) | 1,000 / 200 / 1,200 / 12,000 | 70 | fort, town, city, capital | Host +0.4 water, +1 fort level, +60 storage days; besieged settlements eat 40% less. Fort defense +10% |
| Giridurga | III | Citadel of a Thousand Steps (Sahasrapada Durga) | 3,500 / 1,000 / 3,000 / 36,000 | 120 | fort, city, capital | Host +2 fort levels. All settlements +0.05 order. Fort defense +20%, prolonged-battle penalty -15% |
| Giridurga | III | Assembly Caves of the League (Guha Sabha) | 3,800 / 600 / 2,600 / 30,000 | 120 | fort, town, city, capital | All settlements +0.2 culture, +0.05 loyalty. Diplomacy +25%, espionage +20%. +25 prestige |
| Nilavana | II | Elephant Grove of Gajavana (Gaja Kunja) | 1,000 / 900 / 150 / 9,000 | 60 | village, town, city, capital | Recruitment +10%, elephants raised 30% faster, trade +10% |
| Nilavana | III | The Canopy Watch (Vriksha Durga) | 3,000 / 2,400 / 400 / 24,000 | 100 | town, city, capital | Scout range +30%, forest movement +15% |
| Marudesha | II | Caravanserai of the Salt Road (Lavana Sattra) | 1,100 / 300 / 500 / 9,000 | 60 | village, town, city | Trade +25%; host +0.2 water |
| Marudesha | III | Beacon Line of the Western Passes (Dipa Marga) | 3,000 / 800 / 1,600 / 24,000 | 100 | town, city, fort | Scout range +30%, march +10% |
| Samudra | II | Lamp Tower of the River Mouth (Dipa Stambha) | 1,200 / 500 / 600 / 9,000 | 60 | port, town, city | Trade +20%, supply +10% |
| Samudra | III | Hall of the Guilds (Shreni Sabha) | 4,000 / 1,500 / 1,500 / 28,000 | 110 | port, city, capital | Trade +25%, tax +10% |
| Kotanagara | II | The Coin House (Lakshana Shala) | 1,400 / 300 / 700 / 9,000 | 60 | town, city, capital | Tax +15% |
| Kotanagara | III | Engineers' Arsenal (Yantra Shala) | 3,800 / 2,000 / 1,600 / 30,000 | 110 | town, city, capital, fort | Siege +25%, construction +15% |

Landmarks are 8-26 m tall (`heightMeters`) so they read on the strategic map as the tallest silhouette in their
settlement; render builds them from `architecture` pieces until bespoke models exist.

### 8.6 Walls, gates and siege presentation

Walls & Gates levels: L1 earth rampart + timber palisade, L2 mud-brick walls with bastions (Mahajanapada),
L3 dressed stone (Samrajya). Gates snap to every road exit; towers 1 per 2 segments per level. The wall ring
shows damage per segment (cracks -> breach rubble). Besieged settlements show siege camps, rams under hide roofs,
ladders when built and a gate health bar on hover. The settlement panel shows wall HP, days of food left and the
surrender chance.

### 8.7 Minimap

- **PC:** bottom-left, 220 px (UI scale), rotates with the camera (toggle to north-up). **Phone:** top-left,
  collapsible to a 56 px button; tap to expand to 40% of the short screen side.
- Layers: terrain tint (biomes), rivers, roads (by quality), province borders (faction color, contested hatched),
  settlements (squares sized by kind, owner color, star = capital), armies (dots with direction ticks; ghost
  outlines for last-known enemies), engagements (crossed swords, flashing), depots (small barrels), camera frustum
  trapezoid.
- Alerts ping as expanding rings (red: attack/siege/revolt; amber: shortage/supply low; gold: construction done,
  landmark, treaty).
- Click/tap jumps the camera; right-click on the minimap orders selected armies to move there (PC).
- Battle minimap (same widget): formations as rectangles in team color, selection highlighted, deploy zones during
  deployment, objective markers.

### 8.8 Control groups, hotkeys and the command card

**Command card:** a 5 x 3 grid (bottom-center on PC, bottom sheet on phones) with hotkeys
`Q W E R T / A S D F G / Z X C V B` in the **Grid** preset. Content depends on selection:

| Selection | Tabs (key to switch: Tab) | Card contents (`commandSlot`) |
|---|---|---|
| Settlement | Economy / Military / Civic / Defense / Recruit | Buildings by `BuildingDef.category` + slot; Recruit tab = unit classes by `UnitDef.commandSlot` (Q spear, W archers, E guards, R horse, T chariots, A elephants, S engineers, D scouts, F supply) |
| Army | Orders | Move, Attack, Besiege, Garrison, Raid, Forage, Retreat, Stance (aggressive/balanced/cautious), Forced march, Split, Merge, Disband, Visit (hero) |
| Battle formations | Orders / Shapes / Intents | Orders: Q hold, W advance, E attack, R charge, T flank, A defend, S withdraw, D regroup, F run toggle, G stance; Shapes: Z line, X column, C square, V wedge, B loose (circle on Shift+B); Intents page via Tab |

**Two key presets** (settings): **Classic** (default; WASD camera, mnemonic letters - the current
`input/bindings.ts`) and **Grid** (AoE IV-like; camera on arrows/edge/drag, rotate on `[` `]`). The table lists
both.

| Action | Classic | Grid |
|---|---|---|
| Pause / speed down / up / reset | Space / - / + / Backspace | Space / - / + / Backspace |
| Select capital (town center) | H (world) | H |
| Next idle builders (idle villager) | `.` | `.` |
| Next idle army (idle military) | `,` | `,` |
| Control groups | Ctrl+1..9 assign, 1..9 select, double-tap centers, Shift+number adds | same |
| Select all formations (battle) | Z | Ctrl+A |
| Hold / Advance / Attack / Charge / Flank | H / T / X / C / Y | Q / W / E / R / T |
| Defend / Withdraw / Regroup / Run toggle | U / B / G / N | A / S / D / F |
| Shapes line / column / square / wedge / loose | J / I / O / P / K | Z / X / C / V / B |
| Commander Rally | L | G (Shift) |
| Cinematic camera | V | Home |
| Overlays supply / terrain / borders | M / K / L (world) | F1 / F2 / F4 |
| Hero interact / run / exit | E / Shift / Esc | same |

Conflicts resolved for the UI team: speed keys move off `,` and `.` (they become idle-cycling, as in AoE); `K` is
the loose shape in battle and the terrain overlay in the world (contexts never overlap); `L` is Rally in battle and
the borders overlay in the world.

**Touch:** tap select; drag on empty ground pans; drag on a selected formation sets a move; long-press opens the
**radial wheel** (orders inner ring, shapes and intents outer ring); two-finger tap = pause; control groups are a
row of 5 slots above the card (long-press to assign, tap to select, double-tap to center).

### 8.9 End-of-game statistics

Shown after a scenario ends (victory, defeat or mixed) and on sandbox victory/defeat; accessible from the pause
menu in sandbox ("Chronicle & statistics"). Tabs (`STAT_CATEGORIES`): Summary (outcome, score, days, age reached),
Military (soldiers raised/lost, enemies killed, battles won, largest battle, settlements taken, routs), Economy
(grain harvested, wealth earned, trade, buildings, landmarks, peak treasury), Society (peak population, average
stability, famine days, revolts, decisions), Diplomacy (treaties signed/broken, wars, marriages). Each row shows all
factions side by side (player first), best value highlighted. **Timeline graphs** (`TIMELINE_SERIES`):
population, soldiers, treasury, grain, stability, settlements per month from `world.stats` [BASE samples].

```
score = 100 x settlements + 10 x population/1,000 + wealth earned/100 + 50 x battles won
      + 0.2 x enemies killed + 40 x treaties + 250 x landmarks + 300 x ages advanced + 150 x objectives completed
```

(`RULES.score`; counters marked "tracked" in `END_GAME_STATS` need `WorldState.statistics` [REQ].)

---

## 9. Campaign: The Broken Crown

GDD §8 chapters 1-2 as **one scenario in two acts** (`SCENARIOS.broken_crown`), 540 days, playable in 45-90
minutes. A second scenario, *The Seven Hills*, plays the same year from Giridurga (§9.8).

### 9.1 Premise and start state

Year 300 BCE (display `-300`), **2 Ashvina** (month 6, sharad - just after the monsoon). Maharaja Vishvavarman of
Suvarna died nine days ago in the year of a failed monsoon (`monsoonStrength 0.7` -> a thin kharif on day 45).
His widow Rani Vasumati holds the regency for their son Kumara Aditya (19); the late king's brother Prince
Devavarman governs Ratnadesha, keeps a household army and courts the nobles. The hill clans of Giridurga - at war
with Suvarna over the Setu Bridge tolls - raid the crossing.

| | Suvarna (player) | Giridurga | Nilavana | Marudesha |
|---|---|---|---|---|
| Treasury | 4,000 | 2,600 | 1,800 | 1,500 |
| Timber / stone | 600 / 300 | 300 / 900 | 1,200 / 100 | 150 / 250 |
| Age | Mahajanapada | Mahajanapada | Mahajanapada | Janapada |
| Settlements | 5 (Rajapura, Dhanyagram, Kusumpur, Ratnapura, Setupur) | 5 | 2 | 2 |
| Armies | Royal Host of Rajapura (4 spear, 2 archer, 1 guard, 1 horse, 1 elephant, 1 supply; Senapati Bhadrasena) - Watch of the Setu Bridge (2 spear, 1 archer, 1 scout) - Household of Devavarman at Ratnapura (2 spear, 1 archer, 1 guard, 1 horse) | Host of the Seven Peaks at Shilapur (3 spear, 2 archer, 2 horse, 1 engineer, 1 supply; Raja Vindhyaketu) - Wardens of the Dvara Pass (2 spear, 2 archer; Vira Durjaya) | Elephant Host (2 spear, 2 archer, 1 elephant, 1 scout) | Riders of the Salt Road (2 horse, 1 chariot, 1 scout, 1 archer; Rana Virasimha) |
| Soldiers | 1,650 | 1,172 | 478 | 266 |

Relations: Suvarna-Giridurga **at war** (opinion -35); Suvarna-Nilavana trade treaty (+10); Suvarna-Marudesha
-10; Giridurga-Marudesha non-aggression (+20); others neutral. The prologue event multiplies every Suvarna store
by 0.6 ("the granaries are half empty").

### 9.2 Cast

| Character | Faction / role | Traits | Skills (M/S/D/I/L) | Wants | Arc |
|---|---|---|---|---|---|
| **Rani Vasumati** | Suvarna - regent (ruler) | shrewd, administrator, cautious | 6/14/12/10/11 | Her son crowned, the realm intact | Holds the seal; may fall ill (Act II) |
| **Kumara Aditya** | Suvarna - heir; **the hero** | brave, reckless, charismatic | 12/5/8/4/7 | To prove himself | Walks the city, wins or loses the court, fights at the ghat, duels at Tirthaghat |
| **Prince Devavarman** | Suvarna - claimant, governor of Ratnadesha | ambitious, scheming, charismatic | 9/11/13/14/8 | The crown | Reconciled, bought, exiled, arrested, defected to Nilavana - or usurper |
| Senapati Bhadrasena | commander seat, general | strategist, loyal | 16/6/5/6/7 | A war he can win | Leads the Royal Host; teaches the prince |
| Mantri Haridatta | chief minister | scholarly, shrewd | 4/15/14/12/17 | Arithmetic over omens | Advises grain-first |
| Lakshmidhara | treasurer | greedy, administrator | 3/16/8/9/10 | Silver | Falsified tallies (hero clue) |
| Charini Nilambari | spymaster | shrewd, loyal | 5/7/9/16/9 | The truth, early | Intercepts the prince's letters; warns of the ambush |
| Acharya Vedavrata | court scholar | devout, scholarly, just | 2/8/10/5/18 | Dharma | Points the prince to his father's vow |
| Governor Chandralekha | governor of Dhanyakshetra | just, generous | 5/13/11/6/9 | Her farmers fed | The GDD §6 governor; ultimatum |
| **Raja Vindhyaketu** | Giridurga - ruler, general | brave, cautious, strategist | 15/9/11/8/8 | The bridge tolls his grandfathers built | Sends envoys; can become in-law, tributary or enemy |
| **Kumari Meghavati** | Giridurga - heir (council), envoy | diplomat, charismatic, just | 9/9/15/8/12 | An end to the hunger in the hills | The marriage path; the last envoy |
| **Vira Durjaya** | Giridurga - champion, general | brave, reckless, robust | 17/3/4/4/5 | A worthy opponent | The duel at the ghats |
| Rajuka Ketaki | governor of Shilatala | greedy, shrewd | 4/14/10/11/8 | Quarry profits | Bribable (Seven Hills) |
| Elder Shilabhadra | Giridurga chief minister | just, cautious | 5/12/13/7/12 | Consensus | Seven Hills advisor |
| Rani Shyamala | Nilavana - ruler | devout, diplomat, content | 8/11/14/8/11 | Peace and elephant trade | Receives Devavarman's offer |
| Rana Virasimha | Marudesha - ruler, general | reckless, brave, greedy | 14/6/6/9/5 | Salt-road wealth | Raids, tempts Dhanyakshetra |

### 9.3 Acts and objectives

| Act | Flag | Days | Goal | Objectives (`act`) |
|---|---|---|---|---|
| **I. The Broken Crown** | `bc_act = 1` | 1-119 | Secure the capital, resolve the succession, keep the army whole | **Hold Rajapura** (to day 540; fails if lost) - **Resolve the succession** (`succession_resolved`; fails if `usurped`; +0.1 legitimacy) - *Win the Hall of Pillars* (optional; hero mission; +0.05 stability) - *Keep the army whole* (optional: succession resolved with >= 1,800 soldiers and no defection; +15 prestige) |
| **II. The Grain and the Sword** | `bc_act = 2` | 120-540 | Feed the realm through the lean year; settle with Giridurga | **Settle with Giridurga** (peace, marriage, tributary or own Giridurg; +0.05 stability) - **Feed the realm through the lean year** (day >= 420 with no settlement in revolt; +0.05 legitimacy) - *Refill the royal granaries* (optional: reserve >= 20,000; +0.05 stability) - *Hold the Setu Bridge* (optional: own Setupur on day 530+) |

Required objectives are not victory conditions by themselves; outcomes (§9.6) are.

### 9.4 Timeline

| Day | Date | Event (`scriptedEvents` unless marked) | Notes |
|---|---|---|---|
| 1 | 2 Ashvina -300 | **The Broken Crown** (`evt_bc_prologue`) | Sets `bc_act = 1`; stores x0.6. Hero mission *The Walk to the Hall* becomes available |
| 3 | 4 Ashvina | **Whispers in the Hall of Pillars** (`evt_court_succession`) | Auto-resolves on day 23 with "Proclaim Aditya" - giving the player 20 days to visit the Hall first |
| 14 | 15 Ashvina | **The Council of War** | Grain first / strike / pay the clans - competing advisors |
| 32 | 3 Kartika | **Envoys from the Seven Peaks** | Refuse (raids) / truce / propose marriage (needs succession) |
| 45 | 16 Kartika | *Kharif harvest* (system) | Weak: M = 0.7 -> kharif ≈ x0.71 |
| 46 | 17 Kartika | **A Thin Harvest** | Trust the rabi / ration / buy 8,000 grain (sets `grain_barges`) |
| 50+ | | *Hero: Blades at the Royal Ghat* available | The ambush; success gives the seal ring |
| ~20+ | | *Triggered:* **The Prince's Letters** (claimant loyalty < 0.25) | Watch / expose (needs seal) / buy / seize |
| 75+ | | *Triggered:* **The Hall Changes Hands** (legitimacy <= 0.2, claimant free) | Defeat (usurped) |
| 120 | 1 Magha | **The Grain and the Sword** (`evt_bc_act2`) | Sets `bc_act = 2` |
| 138 | 19 Magha | **Grain for the Host** (`evt_bc_siege_grain`) | GDD §6 chain step 1 |
| 163 | 14 Phalguna | *Chain:* **The Price of Bread** | if requisitioned |
| 180 | 1 Chaitra -299 | **The Temple Town Seeks a Protector** | Peaceful expansion: Tirthaghat |
| 203 | 24 Chaitra | *Chain:* **The Governor's Ultimatum** | if prices ignored |
| 200+ | | *Triggered:* **The Regent Is Unwell** (1%/day) | |
| 225 | 16 Vaishakha | *Rabi harvest* (system) | |
| 245 | 6 Jyeshtha | **The Lean Months** | Grishma price peak; reserve decisions |
| 300 | 1 Shravana | **The Monsoon Comes** | Monsoon roll on day 301 (new M) |
| 330 | 1 Bhadrapada | **The Guild Charter of Naukapattana** | Buy the port (2,000) or a rice compact |
| 405 | 16 Kartika | *Kharif harvest* (system) | The end of the lean year |
| 430 | 11 Margashirsha | **The Last Envoy** | Meghavati offers peace (or peace + trade) |
| 515 | 6 Phalguna | **The Year Turns** | 25 days left |
| 540 | 1 Chaitra -298 | Outcome evaluation | |

### 9.5 Threads and branches

**A. The succession and the claimant.**
```
evt_court_succession --name_heir----> resolved; claimant loyalty 0.10 -> (day 20+) The Prince's Letters
                     --reconcile----> resolved + reconciled (needs court_won from the Hall of Pillars)
                     --council------> +30 days: The Council Speaks -> accept / seat Devavarman (reconciled)
                     --arrest-------> resolved + arrested (stability -0.12, Ratnapura unrest +0.25)
The Prince's Letters --watch--> +40 days: The Gates of Ratnapura --let go--> Ratnapura to Nilavana, war with Nilavana
                     --expose (seal ring)--> arrested              --pay the queen (1,500)--> exiled
                     --buy (1,200)--> loyalty +0.3                 --storm (1,500 soldiers)--> arrested
                     --seize--> arrested
Never resolved + legitimacy <= 0.2 --> The Hall Changes Hands --> DEFEAT (usurped)
```
Legitimacy falls 0.02/month while the succession is unresolved and the claimant lives (§7.9), so stalling is a
real risk.

**B. The hill clans.**
```
Envoys --refuse--> raids at the Setu Bridge (every ~110 days while at war)
       --truce--> PEACE (tolls)                          --> Last Envoy can add trade
       --marriage (succession resolved)--> +15 days: The Custom of the Hills
             --duel--> hero mission "Duel at the Oath Stone" --won--> The Oath at the Ghats:
                                                                      marriage | tributary | Shilapur
                                                           --lost--> Defeat at the Ghats (prince wounded)
             --bride-price 2,500--> MARRIAGE + PEACE
             --decline-->
War path: besiege Giridurg (wall HP 4,200; ~52 days with one engineer formation) or starve it out.
```

**C. Grain** (§7.13): thin harvest -> buy / ration / wait; siege grain -> requisition chain -> ultimatum ->
negotiate / relief / coerce (-> The Fields Refuse -> revolt -> Dhanyakshetra Looks West) / intervene; the lean
months; the monsoon; golden harvest or flood.

**D. Expansion without conquest:** Tirthaghat (protect), Naukapattana (charter), Shilapur (duel boon), Ratnapura
(retake it if it defected). Needed for the Samrajya Age (8 settlements).

**E. Hero missions** (§11.6) feed A and B: the Hall of Pillars unlocks reconciliation; the ghat ambush yields the
seal ring (expose) and grain; the duel opens the marriage/tributary/Shilapur boons; the treasurer and the grain
guild yield silver and grain through dialogue.

### 9.6 Outcomes

Evaluated daily; outcomes marked **immediate** end the scenario as soon as they hold (defeats always do [BASE];
`ScenarioOutcomeDef.immediate` for victories [REQ]); the others at day 540. Highest priority wins on the same day.

| Priority | Outcome | Kind / path | Condition | Immediate |
|---|---|---|---|---|
| 10 | The Broken Crown | defeat | Rajapura not owned | yes |
| 9 | The Usurper's Crown | defeat | flag `usurped` | yes |
| 8 | A Realm Unmade | defeat | stability <= 0.1 **and** legitimacy <= 0.25 | yes |
| 7 | **The Sword of Suvarna** | victory - conquest (`unification`) | succession resolved; own Rajapura, Setupur **and Giridurg** | yes |
| 6 | **The Oath of the River** | victory - diplomatic hegemony | succession resolved; own Rajapura; peace with Giridurga **and** (marriage alliance or tributary); trade with Nilavana or Marudesha | yes |
| 5 | **The Full Granary** | victory - prosperity | succession resolved; own Rajapura and Setupur; stability >= 0.65; royal reserve >= 20,000; treasury >= 6,000; no settlement at protest or worse; at war with no one | at day 540 |
| 3 | The Crown Restored | mixed | succession resolved; own Rajapura; stability >= 0.45 | at day 540 |
| 1 | A Crown of Iron | mixed | own Rajapura | at day 540 |

Epilogues (`epilogue`) are written for each. Statistics screen follows (§8.9). The diplomatic path starts at
peace with Nilavana via trade; it needs the marriage or tribute from thread B. The prosperity path needs peace
(truce, Last Envoy or marriage) and grain management. Conquest needs Giridurg - fort level 3 x1.4 - a real siege.

### 9.7 Pacing

| Segment | World days | Real time at 1x | Typical with battles, missions, pauses |
|---|---|---|---|
| Act I | 1-119 | 4 min | 15-30 min (court event, Hall + Walk missions 8-12 min, 1-2 battles) |
| Act II | 120-540 | 14 min | 30-60 min (2-4 battles, ambush + duel 8-12 min, siege or treaties) |
| **Total** | 540 | **18 min** | **45-90 min** |

Intended sketches: **Conquest** - name the heir, refuse the envoys, buy grain, march the Royal Host + engineers to
Shilapur by day 150, siege Giridurg through the cool season, hold the bridge through the monsoon. **Hegemony** -
win the Hall, reconcile Devavarman, propose marriage, win the duel, keep the Nilavana trade, by day 250-350.
**Prosperity** - truce on day 32, buy grain, build granaries and canals, requisition nothing, take the temple town
and the port, survive the lean months without protests.

### 9.8 The Seven Hills (alternate start, Giridurga)

Same world and date; player = Giridurga (`seven_hills`), hero = Kumari Meghavati (exploration only; no combat
missions in the MVP). Flags `sh_act`.

| Day | Event |
|---|---|
| 1 | **The Seven Hills** (prologue; stores x0.6) |
| 8 | **The Hungry Plateau** - ration / raid the plains (+2,000 grain, opinion -10) / buy forest rice |
| 28 | **A Letter from Ratnapura** - burn it / take Devavarman's gold (+1,500) / send it to the regent (opinion +25) |
| 70 | **The Assembly of the Seven Clans** - consensus / war vote / peace vote |
| 140 | **The River Oath** (Act II) |
| 170 | **Riders of the Salt Road** - mutual defense / trade / decline with Marudesha |
| 300 | **The Monsoon Comes** (shared) |
| 430 | **The Lowland Offer** - peace + trade (+3,000 grain) / peace / refuse |
| any | **Lowland Patrols** (triggered while at war) |

Objectives: hold Giridurg; secure grain (own Setupur, or trade with Suvarna or Nilavana); keep the oath (stability
>= 0.5 at the end); optional reserve >= 12,000. Outcomes: **The Bridge Is Ours** (conquest: Giridurg + Setupur +
Shilapur + one of Tirthaghat/Rajapura/Dhanyagram), **The River Oath** (peace + trade with Suvarna + mutual defense
with a minor or marriage), **The Full Cisterns** (prosperity: reserve 12,000, stability 0.65, treasury 4,500, no
protest), mixed **The Hills Endure**; defeats **The Citadel Falls**, **The Broken Oath**.

---

## 10. Skirmish, sandbox, difficulty and AI personalities

### 10.1 Skirmish setup (GDD §11)

| Option | Values (data) | Default |
|---|---|---|
| Your faction / enemy faction | any of the 6 | Suvarna vs Giridurga |
| Battlefield | `SKIRMISH_MAPS`: The Open Plain, The Ford, Hill Country, The Forest Edge, The Plateau Edge | The Open Plain |
| Army size | `SKIRMISH_SIZES`: Clash 600, Battle 1,000, Great Battle 2,000 (medium+), Field of Kings 5,000 (high+) | Battle (or the largest allowed by the quality tier) |
| Composition (each side) | `SKIRMISH_COMPOSITIONS`: Balanced Host, Elephant Shock, Riders of the Frontier, Hill Fort Garrison, Old Chariot Host; "Faction default" uses `FACTION_DEFAULT_COMPOSITION` | Faction default [REQ: `SkirmishSetup.compositions`] |
| Side | attacker / defender | attacker |
| Time of day | `SKIRMISH_TIMES`: dawn mist, morning, noon, golden hour, dusk, night | morning |
| Season / weather | season + `SKIRMISH_WEATHER[season]` | sharad / clear |
| Difficulty | §10.3 | Minister |
| Spectate AI vs AI | toggle | off |

Classes outside a faction's roster are skipped and the composition renormalized [BASE]; formations below half
strength are not created except spearmen/archers [BASE].

### 10.2 Sandbox setup

`defaultSandbox(seed)` plus the sliders in `SANDBOX_RANGES` (treasury 500-12,000; fertility 0.5-1.5; monsoon
strength 0.5-1.5; drought risk 0-1; rebelliousness 0-1; AI aggression 0-1), start month (`SANDBOX_START_MONTHS`),
player faction (any of 6) and rivals (2-5 others), difficulty and enabled victory types. Presets
(`SANDBOX_PRESETS`): **The River of Kings** (default), **A Golden Age**, **The Year of Drought**, **The Warring
River**, **Restless Provinces**. Sandbox starts at war with the first rival [BASE].

Sandbox victory conditions (`RULES.victory`; progress shown as four bars in the victory panel = `victoryProgress`):

| Victory | Condition |
|---|---|
| Unification | Own 75% of all settlements and every rival capital |
| Prosperity | 90,000 people, treasury 15,000, stability 0.75 and 120 reserve days everywhere, sustained 180 days |
| Diplomatic hegemony | Peace + trade with every surviving rival and >= 2 tributaries or marriage alliances, all opinions >= 40 |
| Cultural legacy | 1,500 culture points, 2 landmarks and the Samrajya Age |

Defeat: lose every settlement, or the dynasty ends with no adoptable heir.

### 10.3 Difficulty (`DIFFICULTY_DEFS`)

| Level | Name | Player income | AI income | AI recruit cost | AI aggression | Battle AI re-plan (s) | AI commander skill | Player morale | Event severity | Hero parry window (s) | Hero enemy dmg | Hero HP | Hints |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| easy | Chronicler | x1.15 | x0.85 | x1.2 | -0.2 | 3 | -3 | +5 | x0.75 | 0.28 | x0.7 | x1.3 | on |
| normal | Minister | x1 | x1 | x1 | 0 | 2 | 0 | 0 | x1 | 0.18 | x1 | x1 | on |
| hard | Monarch | x1 | x1.2 | x0.9 | +0.1 | 1.5 | +2 | 0 | x1.15 | 0.14 | x1.2 | x1 | off |
| very_hard | Samrat | x0.9 | x1.4 | x0.8 | +0.2 | 1 | +4 | -3 | x1.3 | 0.11 | x1.4 | x0.9 | off |

Difficulty never changes combat or economic **rules** for the player; it changes AI resources and sharpness,
misfortune severity (negative event effects x`eventSeverity`) and hero-mode timing.

### 10.4 AI personalities (`AI_PERSONALITY_DEFS`)

| Personality | Used by | Weights (expand / defend / develop / diplomacy / raid / trade) | War ratio | Sues for peace below | Accepts tributary below strength ratio | Battle (aggression / flanking / reserve / withdraw at) |
|---|---|---|---|---|---|---|
| Expansionist | Suvarna | 1.6 / 0.8 / 0.8 / 0.5 / 0.4 / 0.5 | 1.3 | -40 | 0.35 | 0.75 / 0.5 / 0.1 / 0.3 |
| Defensive | Giridurga | 0.4 / 1.8 / 1.1 / 1.0 / 0.6 / 0.8 | 2.0 | -20 | 0.3 | 0.3 / 0.4 / 0.25 / 0.4 |
| Mercantile | Samudra | 0.5 / 1.0 / 1.2 / 1.3 / 0.2 / 1.8 | 2.2 | -10 | 0.5 | 0.4 / 0.3 / 0.2 / 0.5 |
| Opportunist | Nilavana | 1.1 / 1.0 / 0.9 / 1.0 / 0.9 / 1.0 | 1.6 | -25 | 0.45 | 0.55 / 0.6 / 0.15 / 0.4 |
| Diplomatic | Kotanagara | 0.6 / 1.1 / 1.0 / 1.8 / 0.2 / 1.2 | 1.9 | -15 | 0.4 | 0.45 / 0.45 / 0.2 / 0.45 |
| Raider | Marudesha | 0.6 / 0.7 / 0.6 / 0.6 / 1.9 / 0.9 | 1.2 | -30 | 0.4 | 0.7 / 0.85 / 0.05 / 0.5 |

Battle AI uses the battle profile: `aggression` = chance a formation attacks rather than holds; `flanking` =
share of mounted sent around a flank; `reserve` = share of formations held back 150 m until committed;
`withdrawAt` = side strength fraction at which it orders `withdraw_all`.

---

## 11. Hero exploration

### 11.1 Scope and guardrails (GDD §3)

Hero mode puts the player on foot as **Kumara Aditya** (Suvarna) or **Kumari Meghavati** (Giridurga, exploration
only) in one settlement at a time (768 m hero map). It exists for **inspection, negotiation and a few missions**
and is the cinematic showcase of the game. It is not an action RPG: no inventory, no levels, no loot, no
traversal between settlements, no more than three combat encounters in the campaign (training, ambush, duel).
Everything the hero does flows back into the strategy game as event effects (§11.9).

Entry points: settlement panel **Visit** button (any owned or allied settlement, or neutral Tirthaghat), a mission
card (world HUD, "Hero" badge pulses when a mission is available), or the main menu ("Walk Rajapura", free
exploration with no missions). The world clock is frozen while in hero mode.

### 11.2 The capital: Rajapura (districts)

Rajapura (radius 200 m) sits on the east bank of the Kanakavati; the Rajavahini is 500 m south. Districts
(`HERO_DISTRICTS`) are anchors for the procedural layout [REQ: the layout concentrates each district's
`architecture` pieces around its anchor], for crowd density, ambient sound and lighting mood.

```
                     N (palace on the high ground)
                 [Rajaprasada - Palace Citadel]
     [Shastrashala - Arms Yard & Elephant Lines]       [Shilpivithi - Artisans' Lane]
 W  ~Kanakavati~                                                                   E
     [Rajaghat - Royal Ghats]   [Vipani - Great Bazaar]   [Devalaya - Temple Precinct]
        [Dhanyakoshtha - Granary Quarter]
                     S (toward the Rajavahini)
```

| District | Anchor (angle rad / radius) | Pieces | Crowd | Mood | Ambience | Inspectables (clue) |
|---|---|---|---|---|---|---|
| **Rajaghat** - The Royal Ghats | 4.95 (W) / 0.95 | ghat, chhatri, shrine, pavilion | 0.7 | dawn_mist | river, far bells, boatmen, crows | The pyre steps; the royal barge |
| **Dhanyakoshtha** - The Granary Quarter | 5.55 (WSW) / 0.72 | granary, workshop, market stall | 0.5 | noon_haze | threshing, scribes, ox-carts | **Granary bins** (`empty_granary`); weighing yard |
| **Vipani** - The Great Bazaar | 0.25 (S) / 0.45 | market stalls, brick houses, well, mansion | 1.0 | golden_dust | crowds, hawkers, copper, cart bells | **Merchants' ledger** (`hoarded_grain`); city well gossip |
| **Devalaya** - The Temple Precinct | 0.95 (SE) / 0.65 | shikhara temple, shrine, stepwell, pillar | 0.6 | incense_dim | bells, low chanting, dripping water | **Vow inscription** (`temple_vow`); stepwell |
| **Rajaprasada** - The Palace Citadel | 3.14 (N) / 0.55 | palace, pavilion, chhatri, pillar, fort wall | 0.3 | golden_dust | court murmur, fountain, far conch | **Edict pillar** (`old_treaty`); the Hall of Pillars |
| **Shastrashala** - Arms Yard & Elephant Lines | 3.95 (NW) / 0.75 | barracks, stable, tower | 0.4 | noon_haze | drill drums, elephant rumble, blades | Elephant lines; armoury |
| **Shilpivithi** - The Artisans' Lane | 1.75 (E) / 0.70 | workshop, mud/brick houses, huts | 0.6 | golden_dust | potters' wheels, looms, children | Dye vats |

Tirthaghat (duel set piece): **The Pilgrim Ghats** (0.2 / 1.0 - the river crescent and the oath stone half in the
water, dawn mist waist-deep) and **The River Temple** (3.3 / 0.35 - a temple of bells whose stair overlooks the
shallows).

Mood presets (Art Director owns the look; gameplay sets them): `dawn_mist` (hour 5.8-7, low sun, volumetric
fog in shafts, wet stone), `golden_dust` (hour 16.5-18.5, warm haze, dust motes), `noon_haze` (hard light, heat
shimmer), `monsoon_wet` (overcast, puddle reflections, dripping eaves), `lamp_night` (oil lamps, torches),
`incense_dim` (interior smoke shafts). Districts blend by distance.

### 11.3 Opening cinematic walk ("The Walk to the Hall")

Shot list (`HERO_MISSIONS[hm_homecoming].cinematic`), skippable after first viewing (hold Esc / long-press):

| # | Camera | Subject | Duration | Hour | Line (subtitle) |
|---|---|---|---|---|---|
| c1 | aerial | Sangam of the Two Rivers | 6 s | 6.0 | "Rajapura. Nine days since the king's pyre burned on these steps." |
| c2 | crane down | Rajaghat | 5 s | 6.05 | "The river does not mourn. It carries grain, and pilgrims, and kings." |
| c3 | tracking behind | Aditya stepping off the royal barge | 5 s | 6.1 | - |
| c4 | **player control** (steadicam framing) | the walk: ghats -> granary quarter -> bazaar -> temple -> palace | up to 90 s | 6.2 | (barks, optional talks) |
| c5 | low angle | the temple tower against the sunrise | 4 s | 6.8 | - |
| c6 | over shoulder | the palace gate | 4 s | 7.0 | "The Hall of Pillars. Whoever holds it holds the crown." |
| c7 | close up | Rani Vasumati | 4 s | 7.1 | "You are late, my son. The court is not." |

During c4 the time of day advances from 6.2 to 7.0 with the player's progress along the route (not real time);
the crowd parts and bows as the prince passes; three soft "points of interest" glow faintly (granary bins,
Gomati the petitioner, the vow inscription) - optional, but each gives a clue for the Hall. Objective "Walk to the
palace gate" completes at the Rajaprasada anchor; "Speak with the regent" ends the mission.

### 11.4 Characters (`HERO_CHARACTERS`)

23 characters. Each has an appearance (silhouette, garment/accent colors, headgear, prop, scale), traits,
interest, an optional dialogue tree, optional negotiation profile and ambient barks.

| Group | Characters (district) |
|---|---|
| Avatars | Kumara Aditya (saffron/gold, turban, sword); Kumari Meghavati (indigo/gold, veil, staff) |
| Court | Rani Vasumati, Mantri Haridatta, Prince Devavarman (palace); Lakshmidhara (granary); Senapati Bhadrasena, captain Ugrasena (arms yard); Charini Nilambari (bazaar); Acharya Vedavrata (temple) |
| The four great houses | Lord Kirtisena (swords), Lady Utpala (silver), Lord Somapala (temple), Lord Bhavadeva (fields) - all in the palace during the Hall mission |
| City | Pushkala the granary-keeper, Kevala the boatman (ghat), Sreshthi Ratnakara of the grain guild and Gomati of Dhanyagram (bazaar), Kumbha the potter (artisans), Gajaratha the mahout (elephant lines) |
| Tirthaghat | Vira Durjaya, Kumari Meghavati (ghats), Acharya Tirthapala (temple) |

Rules: characters stand at their district anchor +-30 m on idle loops (and at mission positions during missions);
speaking range 3 m (prompt "Talk" / "Inspect"); barks trigger within 6 m, max one per 8 s.

### 11.5 Dialogue and negotiation

**Dialogue trees** (`DIALOGUES`): nodes with a speaker, a line and choices; choices may require a clue
(`requiresClue` -> flag `clue_<id>`), carry event effects (applied once per campaign; the scene records
`dlg_<tree>_<choice>`) or start a mission (`startsMission`). The UI is a cinematic letterbox: over-the-shoulder
two-shot, subtitles bottom, choices as up to 5 cards (keys 1-5 / tap).

Effects reachable through dialogue: treasurer confronted with the empty bins -> +600 wealth (and either quiet or a
public confession: +0.02 legitimacy); the grain guild confronted with the ledger -> +2,000 grain, Rajapura price
x0.9; Gomati's petition -> clue `farmers_petition`; Devavarman confronted with the seal -> he knows you know.

**Negotiation** (`NegotiationProfile` + `NEGOTIATION_RULES`), used by the four great houses:

```
stance starts at startStance (35-50); win at >= winAt (70); lose at <= loseAt (15) or when patience (5) runs out
each argument (a tactic card) costs 1 patience and changes stance by:
  neutral tactic        +12
  in strongVs           +24
  in weakVs             +6
  in backfires          -15
  reveal (needs a clue) +30 if the clue is in revealClues, else -10
  positive deltas       x0.5 if the same tactic as the previous argument; + hero diplomacy x 0.5 (Aditya: +4)
```

| Noble | Interest | Start | Strong | Weak | Backfires | Reveal clue (where found) | Extra on success |
|---|---|---|---|---|---|---|---|
| Lord Kirtisena (swords) | power | 40 | strength, duty | gain | kinship | `old_treaty` (palace edict pillar) | - |
| Lady Utpala (silver) | wealth | 35 | gain | duty, kinship | strength | `hoarded_grain` (bazaar ledger) | +1,500 grain |
| Lord Somapala (temple) | faith | 50 | duty | gain | strength | `temple_vow` (temple inscription) | - |
| Lord Bhavadeva (fields) | land | 45 | kinship, gain | strength | duty | `farmers_petition` (Gomati) | - |

UI: a stance bar with the win and lose marks, patience pips, the noble's portrait reacting (lean in / cross arms),
tactic cards with icons (`TACTIC_INFO`: wheel, coins, sword, lotus, eye) - the Reveal card glows when you hold a
relevant clue. Interests are visible in the noble's tooltip, so reading people is the skill, not guessing.
Two well-chosen arguments (or one reveal + one strong) always win; spending patience on the wrong tactics loses.

### 11.6 Missions (`HERO_MISSIONS`)

| Mission | Kind | Where / when | Available when | Objectives | Success | Failure |
|---|---|---|---|---|---|---|
| **The Walk to the Hall** | cinematic | Rajapura, dawn 6.2 | `bc_act` set, not done | Walk to the palace gate; speak with the regent; optional: granary, Gomati | `homecoming_done`, legitimacy +0.02, chronicle | - (retryable) |
| **The Hall of Pillars** | negotiation | Rajapura palace, 10:00 | walk done, succession unresolved, Hall not yet won/lost | Win 3 of 4 great houses; optional: face Devavarman | `court_won` (unlocks "reconcile" in the succession event), legitimacy +0.05 | `court_lost`, stability -0.03; not retryable |
| **The Arms Yard** | training | Rajapura arms yard, 16:30 | walk done | Best Ugrasena (sparring) | `training_done`, heir prestige +5 | retry |
| **Blades at the Royal Ghat** | combat | Rajapura ghat, dusk 18.6 | `bc_act`, walk done, day >= 50 | Keep 2 of 3 grain carts; defeat the raider captain; optional: search him | `seal_ring` + `clue_seal_ring`, grain +1,500, heir prestige +10 | grain -1,000, Rajapura unrest +0.05 |
| **Duel at the Oath Stone** | duel | Tirthaghat ghats, dawn 5.9 | `duel_accepted` (marriage terms) | Defeat Vira Durjaya | `duel_won` -> event *The Oath at the Ghats* (marriage / tributary / Shilapur) | `duel_lost` -> event *Defeat at the Ghats* (prince wounded) |

**Retry rule:** in retryable combat missions, failure shows "Try again" (restart from the last wave) or "Accept the
outcome" (applies `onFailure`). Leaving a mission mid-way applies nothing and keeps it available.

**Ambush flow:** cinematic (barges at dusk, rice sacks fall away to reveal blades) -> wave 1 at the ghat steps (4
hired blades + 2 spearmen) -> wave 2 from the granary lanes 4 s after wave 1 is cleared (3 spearmen + 3 archers
on the granary roofs) -> wave 3 (raider captain + 2 blades) -> search the captain (seal ring). Grain carts
(3, 300 HP each) are what the enemies target when not engaged; palace guards (2 AI allies, 150 HP) help on easy
and normal.

**Duel flow:** dawn mist; Meghavati on the temple stair, priests ringing bells at each phase change; Durjaya has 3
phases (HP thresholds 66% / 33%): phase 1 measured (light combos, shield bash), phase 2 adds a leaping
unblockable overhead (red flash, roll through it), phase 3 throws away his shield (faster, +20% damage, longer
combos, a sweeping unblockable). No allies, no salve refills; the arena is the shallows (+0 hero speed penalty,
spray VFX), the oath stone is an obstacle.

### 11.7 The melee set (`HERO_COMBAT`, Wukong feel, small scope)

| Move | Input (PC / pad / touch) | Damage | Poise dmg | Stamina | Startup | Active | Recovery | Cancel after | Hit-stop | Shake | Lunge | VFX |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Light 1 | LMB / X / ATTACK | 18 | 10 | 12 | 0.12 s | 0.08 | 0.30 | 0.22 | 45 ms | 0.03 | 0.6 m | slash spark |
| Light 2 | LMB again | 20 | 12 | 12 | 0.10 | 0.08 | 0.32 | 0.22 | 50 | 0.035 | 0.5 | slash spark |
| Light 3 (finisher) | LMB again | 34 | 25 | 18 | 0.18 | 0.12 | 0.55 | 0.40 | 90 | 0.08 | 1.2 | finisher burst |
| Heavy (tap) | RMB / Y / HEAVY tap | 30 | 30 | 20 | 0.35 | 0.10 | 0.60 | 0.50 | 80 | 0.07 | 0.8 | heavy dust |
| Heavy (full charge 0.9 s) | hold RMB | 70 | 70 | 30 | 0.25 after charge | 0.12 | 0.70 | 0.60 | 140 | 0.14 | 1.6 | heavy dust |

| Defense | Rule |
|---|---|
| **Dodge roll** (Space / B / swipe or ROLL) | 0.55 s, 4.5 m, 20 stamina; **i-frames 0.05-0.35 s**; rolling within 0.12 s before a hit lands = **perfect dodge**: 0.6 s slow motion at 0.35x and the next light attack counts as a finisher |
| **Guard** (hold Q / LB / GUARD) | -75% damage; stamina -0.6 per damage point blocked; stamina regen x0.3 while guarding; stamina at 0 = guard break (stagger 1.2 s); unblockable attacks (red flash) ignore guard |
| **Parry** (press guard within the window before impact) | window **0.18 s** (difficulty 0.28-0.11); attacker staggered 1.4 s; riposte x2.5 damage; 120 ms hit-stop, gold flash |
| **Salve** (R / RB / flask) | 3 charges, +160 HP over 1.2 s (interruptible by hits); refilled between missions |
| **Lock-on** (Tab / R3 / tap enemy) | range 14 m, cone 1.2 rad; camera frames hero and target; flick to switch |

Stamina 100, regen 30/s after 0.6 s without spending. Hero HP 400 (x difficulty). Hit reaction 0.35 s
stun. **Poise:** every enemy has poise; poise damage at or above it staggers (1 s) and opens a finisher prompt;
poise regenerates fully after 3 s without being hit.

**Enemies** (`HERO_ENEMIES`): Hired Blade (90 HP, light 14 / heavy 26), Raider Spearman (100, reach), Raider Archer
(60, shoots every 3 s from roofs), Raider Captain (260 HP, poise 80, unblockable 45, enrages at 50%), Vira Durjaya
(520 HP, poise 140, unblockable 60, phases at 66% / 33%), Ugrasena sparring (200, gentle). Every heavy or
unblockable attack is **telegraphed** (0.5-0.8 s wind-up; unblockables flash red). **Attack tokens:** at most two
enemies attack at once; the rest circle at 4-6 m and shout - fights stay readable.

**Feel rules:** hit-stop freezes both attacker and target animation for the listed ms (global time unaffected
except perfect dodge); camera shake is a damped noise of the listed amplitude (m) over 0.2 s; impact VFX at the
contact point (sparks on metal, dust on cloth, water spray in the shallows); weapon trails on lights, a brighter
trail on finishers; enemies' death = slump + dropped weapon (no gore). Reduced-motion setting disables shake and
slow motion, halves hit-stop.

### 11.8 Controls and camera

| Action | PC (mouse + keyboard) | Gamepad | Touch |
|---|---|---|---|
| Move / run | WASD / hold Shift | left stick / L3 | left-half virtual stick (push past 80% = run) |
| Look | mouse | right stick | drag on right half |
| Interact / talk / inspect | E | A | tap the prompt bubble |
| Light / heavy attack | LMB / RMB (hold to charge) | X / Y (hold) | ATTACK / HEAVY buttons (hold) |
| Roll | Space | B | ROLL button or swipe on right half |
| Guard / parry | hold Q / tap Q | LB | GUARD button (hold / tap) |
| Salve | R | RB | flask button |
| Lock-on | Tab or middle mouse | R3 | tap an enemy |
| Pause / exit | Esc | Start | pause button |
| Skip cinematic | hold Esc | hold Start | long-press |

Combat buttons appear on touch only during combat missions (exploration shows only the stick, look and interact).
Camera: explore distance 4.2 m, combat 5.5 m, height 1.65 m, right-shoulder offset 0.55 m, FOV 50° (explore) /
58° (combat); collision pull-in; auto-recenters behind the hero after 2 s without look input; in dialogues it cuts
to an over-the-shoulder two-shot at 1.4 m with shallow depth of field.

### 11.9 Ties to the strategic simulation

- Mission and dialogue effects use the event DSL with the player scope; they are applied **when the mission ends
  successfully or the player accepts failure** and are saved in the world (flags, treasury, food, legitimacy,
  stability, character variables, triggered events).
- Hero availability is pure world state (`availability` conditions), so saving/loading, autoresolving battles or
  skipping hero mode never breaks the campaign: every branch also has a strategic route (the succession event
  auto-resolves; marriage can be bought; the seal is optional).
- The world clock is frozen in hero mode, so a mission never costs the player strategic time.
- Visiting a settlement shows its **current state**: owner banners, granary queues if the store < 30 days,
  crowds/protests by rebellion stage, construction scaffolds in progress, damage from sieges, season and weather.

---

## 12. UX flows, tutorial and accessibility

### 12.1 Screen flow

```
Boot -> Main menu -+-> Campaign setup (scenario, difficulty) ----------------> World HUD
                   +-> Sandbox setup (preset, sliders, factions, victory) ----> World HUD
                   +-> Skirmish setup (§10.1) --------------------------------> Battle (deploy) -> Results -> Main menu
                   +-> Walk Rajapura (free hero) -----------------------------> Hero HUD -> Main menu
                   +-> Continue / Load -> Save/Load -> (scene of the save)
                   +-> Settings
World HUD -+-> Settlement panel -> [Build placement] [Recruit] [Market] [Visit -> Hero]
           +-> Army panel        -> orders, split/merge, supply
           +-> Province panel    -> governor, autonomy, borders
           +-> Realm panels: Diplomacy | Council | Ages & landmarks | Economy (ledger, policies) | Chronicle
           +-> Event modal (pauses for narrative/dynastic/political events)
           +-> Engagement prompt -> Battle (deploy) -> Results -> World HUD
           +-> Mission card -> Hero (cinematic, dialogue, negotiation, combat) -> Mission result -> World HUD
           +-> Pause menu -> Save/Load, Settings, Chronicle & statistics, Quit
Scenario end -> Scenario results (epilogue) -> Statistics (§8.9) -> Main menu
```

New screens/props requested from the CTO for `ScreenPropsMap` (§14.3): `build_placement`, `market`, `age_panel`,
`economy_panel`, `mission_card`, `hero_dialogue`, `hero_negotiation`, `mission_result`, `game_stats`.

### 12.2 Screens (PC and phone)

| Screen | PC layout and interactions | Phone (390 x 844, portrait and landscape) |
|---|---|---|
| **Main menu** | Animated region backdrop (menu scene); buttons Continue, Campaign, Sandbox, Skirmish, Walk Rajapura, Load, Settings; version bottom-right | Full-width stacked buttons >= 48 px; backdrop at low quality |
| **Campaign setup** | Scenario cards (title, chapter, subtitle, description, faction heraldry, estimated length "45-90 min"), difficulty segmented control with descriptions | One card per page (swipe); difficulty as a bottom sheet |
| **Sandbox setup** | Preset chips; sliders with `SANDBOX_RANGES` labels/help; faction picker with heraldry + playstyle bullets; rivals multi-select; victory toggles | Accordion sections; sliders with +/- steppers |
| **Skirmish setup** | Two faction columns (composition preview as unit icons with counts), map thumbnails, size, time, season/weather, difficulty, AI vs AI | Vertical wizard: factions -> map -> size -> conditions |
| **World HUD** | Top: resource bar (§8.1), date + season icon + weather, speed controls; top-right: realm buttons (Diplomacy, Council, Ages, Economy, Chronicle) with alert badges; bottom-left: minimap; bottom-center: command card; bottom-right: notification feed (max 5, click to focus); left edge: objectives tracker (act title, objectives with status icons) | Top: compact resource bar + date + pause/speed; bottom: command card as a sheet; minimap button top-left; feed as toasts; objectives behind a "scroll" button |
| **Settlement panel** | Right drawer: header (name, epithet, owner, kind, province), vitals row (population/housing, grain stored + reserve days + price, water, loyalty, unrest stage chip, order, health), labor allocation sliders (4, summing to <= 100%), tax-rate slider, buildings grid (icons with level pips and condition), construction queue (progress bars, cancel), recruitment queue, garrison; tabs on the command card | Bottom sheet 60% height, swipe up for full; vitals as a 2 x 4 grid; sliders become steppers |
| **Build placement** | §8.2: ghost, reason text, cost tooltip, Shift to repeat | Ghost + tick/cross buttons |
| **Army panel** | Name, commander portrait + skills, units list (class icon, strength/morale bars), supply bar (days of food, line intact icon), stance, forced march toggle, order buttons | Bottom sheet; units as a horizontal scroller |
| **Province panel** | Governor (portrait, loyalty, interest + whether satisfied), autonomy slider, settlements list, fertility and resources | Bottom sheet |
| **Market** | Three rows (grain, timber, stone): current price, buy/sell 100 buttons (Shift = x5), price sparkline | Same, larger buttons |
| **Ages & landmarks** | Current age banner; next age requirements checklist (green/red); two landmark cards (art, cost, effects, "Choose site"); unlock preview (buildings/units/treaties) | Full screen; cards stacked |
| **Economy panel** | Ledger (last month + projection), tax policy, royal reserve and "Hold the reserve" toggle, rationing status | Full screen |
| **Diplomacy** | Faction list (heraldry, opinion bar, trust, treaties icons, war score); proposal composer (type, terms, tribute amount, marriage candidates); AI reply with reason lines | Faction list -> detail page |
| **Council** | Five seats with portraits; each shows its current recommendation with "Do it"; advisor opinion | Vertical list |
| **Event modal** | Illustration (`illustration` key), title, body with placeholders, choices as cards: label, description, advisor portrait "Recommended by", disabled choices show the unmet requirement; auto-resolve countdown ("decides itself in 12 days") | Full-screen card; choices stacked |
| **Engagement prompt** | Two sides (armies, soldiers, commanders), terrain/kind, prediction bar + factor lines, Fight / Autoresolve / Retreat | Same, stacked |
| **Battle HUD** | Top: side strength bars + morale averages, battle time, speed; bottom: formation cards (icon, strength, morale, fatigue, ammo), command card (orders/shapes/intents), commander Rally button with cooldown ring; minimap bottom-left; event feed (routs, commander fallen) | Formation cards as a scrollable strip; radial wheel on long-press; Rally as a floating button |
| **Battle results** | Victory/defeat banner, reason, per-side table (start, survivors, killed, captured, pursuit), formations list, prisoners choice (Ransom/Release), commander fate, chronicle line, Continue | Stacked |
| **Mission card** | Title, art, description, objectives, time of day, "Begin" / "Later" | Full-screen card |
| **Hero HUD** | Minimal: objective line top-left, prompt bubble at the target, compass strip; combat: HP (red), stamina (gold), salve charges, lock-on reticle, enemy health over heads; captions bottom | Virtual stick, look area, combat buttons only in combat |
| **Hero dialogue / negotiation** | Letterbox, two-shot camera, subtitles, choice cards (keys 1-5); negotiation adds stance bar, patience pips, tactic cards | Choice cards full width |
| **Pause menu** | Resume, Save, Load, Settings, Chronicle & statistics, Quit to menu | Same |
| **Settings** | Graphics (tier + overrides), audio buses, controls (preset Classic/Grid, rebinding), UI scale, accessibility (§12.5), hints, auto-pause options | Same, grouped |
| **Scenario results** | Outcome title + epilogue text over the faction's capital at golden hour, objectives summary, button to statistics | Same |
| **Statistics** | §8.9 tabs and graphs | Tabs as a segmented control; graphs scroll horizontally |
| **Chronicle** | Scrollable timeline of `world.chronicle` grouped by month, importance-2 entries emphasized | Same |

### 12.3 Phone specifics

- Every touch target >= 44 px (48 px for primary actions); safe-area insets respected; no hover-only information
  (tooltips open on tap-and-hold, close on tap elsewhere).
- Command presets: **simple mode** (default on phones) hides intents, stances and shapes behind "More"; one-tap
  formation presets ("Line up", "Archers behind", "Horse to the wings").
- Automatic pauses on engagement prompts and narrative events also on phones; speed buttons are 1x/2x/4x only.
- Quality scales soldier counts and villagers (§8.3) - the sim never changes with quality.

### 12.4 Tutorial hints (`TUTORIAL_HINTS`)

Shown once per profile when `showHints` is on (default on for Chronicler and Minister), as a dismissible card near
the relevant UI with an arrow; lower `priority` shows first; at most one hint per 20 s. Scenes emit the trigger
key on the bus (`ui:hint`, request §14.3).

| Trigger key | Hint | Trigger key | Hint |
|---|---|---|---|
| `menu.first_launch` | Welcome | `battle.start` | Field command basics |
| `world.start` | Camera and speed | `battle.deployment` | Deployment |
| `world.start_minimap` | Minimap | `battle.first_selection` | Formations/shapes |
| `world.first_settlement_selected` | Settlements | `battle.archers_selected` | Archers |
| `world.build_mode` | Placing a building | `battle.cavalry_selected` | Horsemen |
| `world.construction_started` | Builders | `battle.elephants_selected` | Elephants |
| `world.idle_builders` | Idle builders | `battle.formation_wavering` | Wavering (morale < 40) |
| `world.first_army_selected` | Armies | `battle.formation_routed` | Rout and rally |
| `world.control_groups` | Control groups | `battle.intent_available` | Intent orders |
| `world.army_supply_low` | Armies eat | `battle.pause` | Pause and speed |
| `world.engagement_prompt` | Contact | `hero.start` | On foot |
| `world.event_received` | The council advises | `hero.inspect_clue` | A clue |
| `world.grain_price_high` | Price of bread (price > 1.5) | `hero.negotiation_start` | Negotiation |
| `world.rebellion_stage` | Unrest ladder | `hero.combat_start` | Steel (melee) |
| `world.harvest` | Harvest | `hero.low_stamina` | Breath (stamina < 25) |
| `world.monsoon` | The monsoon | `hero.unblockable_seen` | Red flash |
| `world.market_opened` | The market | `world.age_available` | A new age |
| `world.diplomacy_opened` | Diplomacy | `world.hero_available` | Walk the city |

The first campaign also uses the objectives tracker as a soft tutorial: Act I's optional objectives point at the
hero missions, the army, and recruitment.

### 12.5 Accessibility

| Need | Feature |
|---|---|
| Color vision | `colorblind` modes (protan/deutan/tritan) remap team colors to a safe set and add banner-pattern emblems and ring styles (§4.6); morale/strength bars use shape + color; event choice states use icons |
| Motion sensitivity | `reducedMotion`: no camera shake, no slow motion, halved hit-stop, no auto camera swoops (age-up fanfare becomes a card), reduced weather particles |
| Reading | UI scale 80-150%; subtitles always on in hero mode with speaker names; dyslexia-friendly font option [STRETCH]; all event text >= 16 px at 100% |
| Motor | Full rebinding; Classic/Grid presets; hold-to-toggle options for guard and run; every order reachable by click/tap without keys; pause any time in single-player; hero combat assists on Chronicler (wider parry window, more HP) |
| Cognitive load | Auto-pause on engagements and narrative events; event auto-resolve countdown with the safe default; tooltips explain every number ("why is this red?") |
| Hearing | Every audio cue has a visual counterpart (alerts ping the minimap; conch = banner flash; elephant panic = icon) |
| Screen readers | DOM UI with semantic buttons and labels for menus, events and panels (the 3D view is not narrated) |

### 12.6 Notifications and auto-pause

| Event | World behavior | Default |
|---|---|---|
| Engagement involving the player | pause + prompt | always |
| Narrative, dynastic or political event for the player | pause + modal | on |
| Economic/disaster/cultural event | feed + badge (modal on click) | feed |
| Settlement reaches protest or worse | feed (red) + minimap ping | on |
| Army supply < 5 days | feed (amber) | on |
| Construction / recruitment complete | feed (gold) | on |
| Hero mission available | Hero badge pulse + feed | on |

---

## 13. Balance targets and QA checks

### 13.1 Pacing

| Metric | Target |
|---|---|
| Campaign length | 45-90 min (18 min of 1x world time) |
| First meaningful decision | within 30 s of the first world frame (the prologue event) |
| First construction affordable | yes, on day 1 (granary/fields; treasury 4,000) |
| Starting cadence | about one building **or** 1-2 formations per month |
| Battle length (1,000-soldier balanced skirmish, Minister) | median 5 min, 90% between 3 and 8 min |
| Approach phase | lines meet 60-120 s after deployment ends |
| Hero missions | walk 6-10 min (with optional talks), Hall 5-8 min, training 3-5 min, ambush 5-8 min, duel 3-6 min |

### 13.2 Economy

| Metric | Target | Guard |
|---|---|---|
| Annual civilian grain balance, normal monsoon | Suvarna +15% (≈ +6% after its armies); Giridurga -9%; Nilavana +3%; Marudesha -8%; free towns -4% | `tests/data.test.ts` "economy design targets" (bands) |
| Same at M = 0.7 | every realm < +2%; Suvarna > -12% | same test |
| Suvarna monthly net at start | +400 to +700 wealth | sim QA (month 1 ledger) |
| Treasury never negative | in >= 90% of normal-play runs without heavy recruitment | autoplay QA |
| Calm settlements | with standard tax and price < 1.4, unrest stays below 0.15 (calm) for 12 months | sim QA |
| Price response | 30 reserve days -> price ≈ 1.7; empty store -> 3.4 | unit test on the price formula |

### 13.3 Battle (autoresolve QA, 200 runs each, plains, equal wealth unless noted)

| Matchup | Expected |
|---|---|
| 3 spearmen vs 1.5 horsemen (equal cost), horse attacks frontally | spearmen win >= 75% |
| Same, horse attacks archers guarded by 1 spear | horse loses >= 60% |
| 4 spear + 2 archers vs 6 spearmen | mixed side wins >= 60% |
| 1 elephant formation vs 2 horsemen | elephants win >= 80% |
| 1 elephant formation vs 4 archers in loose | archers win >= 60% |
| Royal guards vs 2.5 spearmen (equal cost) | guards win 45-60% |
| Balanced Host vs Balanced Host, same faction | 45-55% |
| Giridurga on a hill (+15 m) vs Suvarna on the plain, equal cost | Giridurga wins >= 60% |
| Commander killed at minute 2 (scripted) | that side's rout probability +30 points |

### 13.4 Campaign

| Metric | Target |
|---|---|
| Each victory reachable | a scripted autoplay per path reaches it before day 540 on Minister (QA scripts using the sketches in §9.7) |
| Defeat by usurpation | only if the succession is ignored and legitimacy is mismanaged (never in the default auto-resolve run) |
| Default run (all events auto-resolved, no player actions) | ends **mixed** ("A Crown of Iron" or "The Crown Restored"), not defeat - the safe defaults keep the realm alive |
| Unrest | at most 2 settlements reach protest in a careful run; the GDD §6 chain must be playable to revolt in a careless one |

### 13.5 Telemetry for tuning (debug API / QA logs)

Per run: day of each objective, outcome, battles (kind, sizes, duration, winner, losses), monthly ledger, grain
reserve days per settlement, unrest per settlement, events fired and choices, hero mission results and retries.
