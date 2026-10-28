**SAMRAJYA**

**ECHOES OF BHARAT**

**AAA-STYLE GAME DESIGN & DEVELOPMENT DOCUMENT**

Ancient India • Open-world strategy • Massive battles • PC + Mobile

*Build a kingdom. Unite a civilization. Rewrite history.*

# Document Overview

This document defines the creative direction, gameplay systems, world
simulation, technical approach, production phases, and initial
acceptance criteria for SAMRAJYA: Echoes of Bharat. The title is a
working name and should undergo trademark and store-name checks before
commercial use.

| **Genre**                  | Open-world strategy, action, empire simulation                                       |
|----------------------------|--------------------------------------------------------------------------------------|
| **Setting**                | Ancient India-inspired subcontinent; proposed campaign circa 300 BCE                 |
| **Platforms**              | PC, Android and iOS                                                                  |
| **Core scale**             | Thousands of strategic soldiers; formation-based real-time battles                   |
| **Player fantasy**         | Build, govern, defend and expand a kingdom across generations                        |
| **Primary differentiator** | A persistent world where war, logistics, politics and the economy affect one another |
| **Initial release focus**  | Single-player campaign, sandbox and skirmish; online multiplayer deferred            |

# 1. High Concept

SAMRAJYA is a historical strategy-action game in which the player leads
a fictional kingdom in a research-led reconstruction inspired by the
political diversity of the ancient Indian subcontinent. Players develop
settlements, manage food and trade, command large armies, negotiate with
rival powers and shape a dynasty. Every major action can create
consequences that persist beyond a single battle.

## Design pillars

- Living civilization: settlements evolve through population,
  agriculture, trade, infrastructure and public trust.

- Large-scale warfare: command formations rather than micromanaging
  every soldier.

- Power beyond combat: diplomacy, succession, espionage, taxation and
  alliances are meaningful paths to victory.

- Persistent consequences: damaged roads, depleted harvests, political
  instability and defeated commanders can affect future decisions.

- Historical care: differentiate documented history, reasonable
  reconstruction and fictional game systems.

# 2. Setting and World

Proposed campaign frame: a fictionalized alternate-history sandbox
inspired by the early historic Indian subcontinent, circa 300 BCE. This
is a design anchor, not a claim that all factions, borders or
technologies coexisted exactly as shown. Historical scenarios should be
validated by specialist research before release.

## Regional gameplay zones

- **Northern plains:** Fertile farmland, rivers, large settlements,
  taxation and recruitment.

- **Western frontier:** Arid terrain, caravan routes, water management
  and contested passes.

- **Deccan plateau:** Hill forts, mineral resources, upland farming and
  defensible corridors.

- **Southern peninsula:** Distinct regional cultures, ports, maritime
  trade and mountain routes.

- **Eastern forests and mountain corridors:** Difficult terrain, forest
  resources, smaller polities and exploration.

The world should be handcrafted at the regional level and supported by
procedural tools for terrain variation, vegetation, roads and settlement
layouts. Major cities, forts and narrative locations receive dedicated
art direction.

# 3. Core Gameplay Loop

1.  Explore: discover settlements, resources, roads, rivals and
    opportunities.

2.  Develop: grow food production, build infrastructure, trade and
    recruit.

3.  Govern: manage loyalty, taxes, justice, diplomacy and succession.

4.  Campaign: plan routes, move armies, negotiate and fight battles.

5.  Adapt: respond to rebellions, shortages, damaged infrastructure and
    political changes.

Player perspectives: (1) world command for the strategic map and
administration; (2) field command for real-time battles; (3) limited
hero exploration for selected missions, negotiations and local
inspection. Hero exploration is intentionally scoped to avoid building a
full separate action game in the first release.

# 4. Factions and Military Identity

| **Faction archetype**       | **Gameplay identity**                                                                 |
|-----------------------------|---------------------------------------------------------------------------------------|
| **Imperial Heartland**      | Administration and mass mobilization; large recruitment pool, but costly to govern.   |
| **Highland Confederacy**    | Defensive terrain, forts and local alliances; smaller recruitment base.               |
| **Maritime League**         | Ports, merchants and coastal supply; depends on trade and secure sea access.          |
| **Forest Kingdoms**         | Scouting, mobility and difficult-terrain operations; less suited to prolonged sieges. |
| **Frontier Principalities** | Reconnaissance and rapid campaigning; vulnerable in prolonged engagements.            |
| **Fortified City-States**   | Engineering, concentrated wealth and strong defenses; limited hinterland.             |

## Military unit classes

| **Class**                 | **Role**                                        | **Key constraint**                                 |
|---------------------------|-------------------------------------------------|----------------------------------------------------|
| **Infantry and spearmen** | Hold ground                                     | morale and formation discipline matter.            |
| **Archers**               | Ranged support                                  | require protection, visibility and ammunition.     |
| **Elite guards**          | Protect commanders and reinforce key formations | expensive.                                         |
| **Cavalry**               | Reconnaissance, maneuver and pursuit            | terrain-dependent.                                 |
| **Chariots**              | Specialized, period-dependent units             | restricted by terrain and historical availability. |
| **War elephants**         | Shock and disruption                            | expensive to maintain and difficult to control.    |
| **Engineers**             | Siege works and construction                    | require time and protection.                       |
| **Scouts**                | Reveal threats and routes                       | vulnerable in direct combat.                       |
| **Supply train**          | Sustains campaigns                              | roads and escorts are strategic assets.            |

# 5. Battlefield Design

- Formation-based orders: advance, hold, flank, withdraw, regroup and
  defend.

- Morale, fatigue, cohesion, leadership and supply affect formation
  performance.

- Terrain and weather affect visibility, movement, fatigue and tactical
  opportunities.

- Retreat, pursuit, capture, surrender and siege pressure are supported.

- Strategic terrain connects to battle terrain wherever feasible; battle
  outcomes must persist when the camera leaves.

- Single-player supports pause and adjustable simulation speed.

- Intent-based orders let players express objectives such as holding a
  crossing or protecting archers; AI translates intent into formation
  actions.

## Morale model

Morale = f(leadership, cohesion, fatigue, supply, tactical position,
recent events and perceived risk).

This is a tunable gameplay model, not a historically validated
predictive equation. Example: a formation may retreat after its
commander falls, its flank collapses and its supply route is threatened,
even if most soldiers remain alive.

# 6. Living World Simulation

## Settlement variables

- Population and available labor

- Food production, stored reserves and seasonal harvests

- Water availability, irrigation and infrastructure

- Housing, sanitation and public order

- Local wealth, taxation and trade

- Recruitment potential and loyalty to the government

- Infrastructure condition and disaster exposure

## Seasonal and economic systems

The calendar influences agriculture, monsoons, flooding, drought, travel
and campaign timing. Armies consume supplies; long campaigns require
depots, local purchases, safe roads or alternate supply arrangements.
Shortages can raise prices, reduce recruitment, weaken tax revenue and
trigger unrest. Recovery requires time and investment.

## Example consequence chain

6.  The ruler requisitions grain to supply a siege.

7.  The army wins, but provincial reserves fall.

8.  Prices rise and farmers become dissatisfied.

9.  Recruitment and tax revenue decline.

10. A governor demands relief or threatens rebellion.

11. The player chooses relief, negotiation, coercion or military
    intervention.

# 7. Diplomacy, Politics and Dynasty

- Treaties: peace, trade, access and mutual defense.

- Tributary relationships: tribute in exchange for protection or
  autonomy.

- Marriage alliances and succession claims.

- Governors with personal interests and loyalty levels.

- Espionage and intelligence networks that limit what rivals know.

- Council advisors who provide competing recommendations.

- Rebellion escalation from protest and tax refusal to secession or
  armed revolt.

- Dynastic succession that allows the campaign to continue across
  generations.

Victory can be achieved through imperial unification, prosperity,
diplomatic hegemony or cultural legacy. No single moral path should be
mandatory, and historical cultures should not be reduced to simplistic
good-versus-evil factions.

# 8. Narrative Campaign

12. **The Broken Crown:** Secure the capital, resolve succession and
    prevent the army from fragmenting.

13. **The Grain and the Sword:** Stabilize food supplies and negotiate
    with or defeat a rival power.

14. **The River of Kings:** Contest a strategic river corridor central
    to trade, agriculture and military access.

15. **The Price of Victory:** Choose between expansion, reform and
    alliances as the costs of empire rise.

16. **The Heir's Burden:** Face succession, internal rivalries and the
    consequences of the ruler's reign.

The main narrative is authored, but events should branch based on the
simulation. Rival characters can become allies, wars can be avoided, and
heirs may emerge from different political factions.

# 9. Technical Architecture

## Three-level simulation

- **Strategic:** Provinces, populations, trade, diplomacy, logistics and
  armies; low-cost updates.

- **Tactical:** Formations, morale, movement, target selection and
  combat outcomes.

- **Local combat:** Individual movement, animation, collision avoidance
  and close-range interactions near the camera.

Distant battles may use formation-level resolution; active battles
instantiate detailed entities from the same authoritative state.
Transitions must preserve outcomes rather than silently replacing the
battle.

## Initial performance targets (to validate)

| **Metric**                 | **Initial target / note**                                                  |
|----------------------------|----------------------------------------------------------------------------|
| **Active battlefield**     | 1,000–2,000 visible or nearby combatants on a capable PC                   |
| **Stress test**            | 5,000 active combatants with simplified distant simulation                 |
| **Campaign scale**         | Hundreds of settlements and thousands of strategic entities, map-dependent |
| **PC performance**         | Target 60 FPS at agreed quality settings                                   |
| **Mobile performance**     | Target 30 FPS on supported mid-range devices                               |
| **Simulation consistency** | Deterministic or reproducible results where practical                      |

These are engineering goals, not measured results. Rendering 5,000
characters, simulating 5,000 independent AI agents and
network-synchronizing 5,000 characters are separate problems. Avoid a
full AI decision tree for every soldier every frame.

## Recommended technology candidates

- Unreal Engine 5: primary candidate for rendering, world building,
  animation and PC development; benchmark before commitment.

- C++: performance-critical simulation, combat and engine integration;
  visual scripting for selected gameplay logic.

- Blender and content tools: modular buildings, props, terrain,
  characters and animation prototypes.

- Local save system first; add server-authoritative backend and
  PostgreSQL persistence if persistent multiplayer is approved.

- Specialized AI: utility AI for immediate actions, hierarchical
  planning for campaigns, pathfinding for movement, economic simulation
  for resources and optional language-model support for
  non-authoritative dialogue.

# 10. PC and Mobile UX

## PC

- Mouse-driven map and formation selection; keyboard shortcuts for
  command groups.

- Detailed panels for diplomacy, provinces, supplies and armies.

- Pause, speed controls, tactical overlays and battle replay in
  single-player.

## Mobile

- Touch selection, formation grouping, context menus and radial command
  wheels.

- Scalable UI, simplified command presets and advanced options on
  demand.

- Reduced character detail, scalable effects and simulation density by
  device capability.

- Design mobile support into the architecture from the beginning rather
  than treating it as a late port.

# 11. Game Modes and Monetization

| **Mode**                 | **Description**                                   | **Priority** |
|--------------------------|---------------------------------------------------|--------------|
| Campaign                 | Story-led empire building with branching outcomes | MVP          |
| Sandbox                  | Custom start, factions and world conditions       | MVP          |
| Skirmish                 | Short battles with selectable armies and terrain  | MVP          |
| Historical scenarios     | Research-led battles and challenges               | Post-MVP     |
| Asynchronous multiplayer | Strategic challenges or saved-turn competition    | Later        |
| Persistent online world  | Shared political map and large-scale online wars  | Long-term    |

Recommended monetization: paid PC base game with regional pricing; a
free mobile introduction or trial if viable; cosmetic customization;
paid campaign expansions; optional soundtrack and art book. Avoid
pay-to-win combat power.

# 12. Production Roadmap

17. **Months 0–3: Technical proof of concept:** Small terrain; 100–300
    test combatants; formations, pathfinding, morale, camera and one
    battle. Gate: acceptable frame rate and responsive control.

18. **Months 4–8: Vertical slice:** One polished settlement, one region,
    two factions, economy and battle targeting 1,000 active combatants.
    Gate: enjoyable, viable prototype.

19. **Months 9–18: Core production:** Expand factions, strategic
    systems, campaign AI, settlement construction, save/load and mobile
    performance tests. Gate: end-to-end campaign.

20. **Months 19–30: Content and optimization:** Regional content,
    narrative events, art, animation, audio, accessibility and
    device-specific quality settings. Gate: content-complete build.

21. **Months 31–36+: QA and launch:** Closed testing, balance, bug
    fixing, save compatibility, certification and launch preparation.
    Gate: stable release candidate.

The timeline is an estimate for a tightly scoped release with an
experienced team and controlled scope, not a guarantee. Seamless open
world, deep action combat and persistent cross-platform multiplayer may
extend production.

# 13. Team and Indicative Budget

| **Function**                             | **Suggested staffing** |
|------------------------------------------|------------------------|
| Game direction and production            | 2–3                    |
| Gameplay and engine programming          | 5–8                    |
| AI, simulation and networking            | 3–5                    |
| Environment, character and technical art | 6–10                   |
| Animation and cinematics                 | 3–5                    |
| Game design and narrative                | 2–4                    |
| QA and performance                       | 3–5                    |
| Audio, UI/UX and platform support        | 2–4                    |
| **Indicative total**                     | **26–44**              |

Broad planning scenarios in INR; these are not supplier quotes or
verified market averages.

| **Tier**                | **Indicative budget** | **Scope**                                          |
|-------------------------|-----------------------|----------------------------------------------------|
| Technical prototype     | ₹10–25 lakh           | Small test battlefield and basic simulation        |
| Funded vertical slice   | ₹50 lakh–₹1.5 crore   | Polished demonstration of core gameplay            |
| Lean commercial release | ₹3–8 crore            | Reduced world, limited factions and scoped content |
| Ambitious AA production | ₹10–30 crore          | Larger team and broader campaign                   |
| Full AAA ambition       | ₹50 crore+            | Extensive content, premium production and launch   |

Actual cost depends on salaries, outsourcing, production duration,
hardware, engine/middleware terms, marketing, platform fees and
post-launch support. Fund the prototype first; approve the vertical
slice only after large-scale combat works on PC and a representative
mobile device.

# 14. Risks and Mitigation

| **Risk**                    | **Mitigation**                                                                                  |
|-----------------------------|-------------------------------------------------------------------------------------------------|
| **Battlefield slowdown**    | Use instanced rendering, level of detail, formation simulation and profiling-driven AI updates. |
| **Scope creep**             | Limit initial map, factions, period and hero exploration.                                       |
| **Mobile limitations**      | Set minimum device requirements and scalable graphics/simulation settings.                      |
| **Weak strategic AI**       | Use measurable objectives and automated simulation tests.                                       |
| **Historical inaccuracies** | Use historians, archaeologists, inscriptions and source review.                                 |
| **Cultural homogenization** | Represent regional diversity and avoid unsupported uniform traditions.                          |
| **Multiplayer complexity**  | Launch single-player first; add online modes only after core stability.                         |
| **Repetition**              | Combine authored narrative with systemic events and faction-specific goals.                     |

# 15. MVP Acceptance Checklist

- [ ] One functioning strategic region with settlements and resource
  production.

- [ ] Two playable factions with distinct strategic strengths.

- [ ] At least six functional combat classes.

- [ ] Formation movement, attack, retreat and morale.

- [ ] Working economy and army supply model.

- [ ] Battle prototype targeting 1,000 active combatants on the
  reference PC.

- [ ] Simplified simulation for distant armies and battles.

- [ ] Save/load and reproducible simulation tests.

- [ ] Keyboard/mouse and touch-interface prototypes.

- [ ] Performance profiling and crash reporting.

- [ ] Short campaign scenario with multiple viable outcomes.

# 16. Immediate Next Steps

22. Confirm the working title and complete trademark/store-name checks.

23. Select the reference PC and minimum mobile device for performance
    testing.

24. Prototype 100–300 combatants and benchmark rendering, pathfinding
    and morale.

25. Compare Unreal Engine 5 with one alternative using the same test
    scenario.

26. Create a one-region vertical slice before expanding the world.

27. Commission historical research for the chosen campaign period and
    faction designs.

28. Re-estimate scope, staffing and budget after prototype results.

# Closing Vision

**The world you conquer is the world you must learn to govern.**

SAMRAJYA's core advantage is the connection between warfare, logistics,
political power, economic survival and a world that remembers the
player's decisions. Prove large-scale battles first, build a meaningful
strategic simulation, and expand only after the foundations are stable.

# Notes on assumptions

This is a concept and planning document. The title, historical
framework, performance targets, schedule, staffing and budgets are
provisional. They require validation through research, technical
prototypes, playtesting and commercial planning before production.
