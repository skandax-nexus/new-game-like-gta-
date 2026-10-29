/**
 * Contextual tutorial hints (GDD §10 UX; DESIGN_SPEC §12.4). OWNER: Creative Director (text); the UI
 * shows each hint once per profile when its trigger fires and GameSettings.showHints is on. Triggers are
 * dotted keys emitted by scenes/UI (`ui:hint` with the key) - the full list is in DESIGN_SPEC §12.4.
 * `touchText` replaces `text` when the primary input is touch (null = same text).
 */
import type { TutorialHintDef } from '../core/types';

const T = (id: string, scene: TutorialHintDef['scene'], trigger: string, priority: number, title: string, text: string, touchText: string | null = null): TutorialHintDef => ({ id, scene, trigger, priority, title, text, touchText });

export const TUTORIAL_HINTS: readonly TutorialHintDef[] = [
  // --- Menu ---
  T('h_menu_first', 'menu', 'menu.first_launch', 0, 'Welcome to Samrajya', 'New here? Start the campaign "The Broken Crown" on Chronicler or Minister difficulty. Graphics quality was chosen for your device - change it any time in Settings.'),
  // --- World command ---
  T('h_world_camera', 'world', 'world.start', 0, 'The River of Kings', 'Pan with W A S D or drag with the middle mouse button; zoom with the wheel; rotate with Q and E. Space pauses, + and - change speed.', 'Drag to pan, pinch to zoom, twist with two fingers to rotate. Use the pause and speed buttons at the top.'),
  T('h_world_settlement', 'world', 'world.first_settlement_selected', 1, 'Settlements', 'The settlement panel shows people, grain, water, loyalty and buildings. Build and recruit from the command card at the bottom - every settlement has its own builders.', 'The panel shows people, grain, water, loyalty and buildings. Tap a button on the command card to build or recruit.'),
  T('h_world_build', 'world', 'world.build_mode', 1, 'Placing a building', 'Move the outline onto the settlement grid: green is allowed, red is not. Fields and quarries go on the outer ring, ghats and harbors on the river bank. Right-click or Esc cancels.', 'Drag the outline onto the grid (green = allowed) and tap the tick to confirm.'),
  T('h_world_construction', 'world', 'world.construction_started', 2, 'Builders at work', 'Construction speed depends on how much of the settlement\'s labor is set to building. Three jobs can run at once; the rest wait in the queue.'),
  T('h_world_idle', 'world', 'world.idle_builders', 3, 'Idle builders', 'A settlement has builders with nothing to build. Press . to jump to it - or move its labor to the fields.', 'A settlement has idle builders. Tap the idle-builders button to jump to it.'),
  T('h_world_army', 'world', 'world.first_army_selected', 1, 'Armies', 'Right-click the map to march. Armies move fastest on royal roads and slowest through forest, hills and monsoon mud. Ctrl + a number key makes a control group.', 'Tap the map to march. Roads are faster; forests, hills and monsoon mud are slow.'),
  T('h_world_groups', 'world', 'world.control_groups', 4, 'Control groups', 'Ctrl+1..9 assigns the selected armies to a group; 1..9 selects it; pressing the number twice centres the camera. , cycles idle armies.', 'Long-press a group slot to assign the selected armies; tap it to select; double-tap to centre.'),
  T('h_world_supply', 'world', 'world.army_supply_low', 0, 'Armies eat', 'This army has only a few days of food. Bring it near a friendly settlement or depot, add a supply train, or let it forage - foraging angers the villages it strips.'),
  T('h_world_engagement', 'world', 'world.engagement_prompt', 0, 'Contact!', 'Fight the battle yourself, let your generals decide (autoresolve uses the same battle rules), or retreat and lose a rearguard.'),
  T('h_world_event', 'world', 'world.event_received', 1, 'The council advises', 'Each choice shows which advisor recommends it. Advisors whose advice you keep ignoring lose faith in you. Ignored events resolve themselves with the first choice.'),
  T('h_world_price', 'world', 'world.grain_price_high', 1, 'The price of bread', 'Grain is expensive here. High prices raise unrest, cut recruits and tax compliance. Release grain from the royal reserve, buy at the market, or wait for the harvest.'),
  T('h_world_rebellion', 'world', 'world.rebellion_stage', 0, 'Unrest', 'Unrest climbs a ladder: grumbling, protest, tax refusal, riots, revolt, secession. Each step costs you more. Relief, lower taxes, autonomy or force can step it back down.'),
  T('h_world_harvest', 'world', 'world.harvest', 3, 'Harvest', 'Two harvests a year: kharif after the monsoon (Kartika) and rabi in spring (Vaishakha). Granaries keep the surplus; without storage it spoils.'),
  T('h_world_monsoon', 'world', 'world.monsoon', 2, 'The monsoon', 'Varsha: rivers rise, fords close, roads turn to mud and armies slow. The strength of the rains decides the next harvest.'),
  T('h_world_market', 'world', 'world.market_opened', 3, 'The market', 'Buy and sell grain, timber and stone in lots of 100. Every trade moves the price; prices drift back over time.'),
  T('h_world_age', 'world', 'world.age_available', 0, 'A new age', 'Your realm can advance to the next age. Choose one of two landmarks - each grants a different lasting bonus. Completing it unlocks new buildings, units and treaties.'),
  T('h_world_diplomacy', 'world', 'world.diplomacy_opened', 3, 'Diplomacy', 'Opinion and trust decide what rivals accept. The reasons they give are real: fix them and ask again.'),
  T('h_world_hero', 'world', 'world.hero_available', 1, 'Walk the city', 'A hero mission is available. Visit the settlement as your hero to inspect, talk and act in person - what you discover can change negotiations.', 'A hero mission is available - tap the hero button to walk the city.'),
  T('h_world_minimap', 'world', 'world.start_minimap', 5, 'The minimap', 'Click the minimap to jump the camera. Flashing swords mark battles; red pings are alerts.', 'Tap the minimap to jump; flashing swords mark battles.'),
  // --- Field command ---
  T('h_battle_start', 'battle', 'battle.start', 0, 'Field command', 'Left-click or drag a box to select formations. Right-click to move; right-drag to set the facing and frontage of the line. Right-click an enemy to attack. Space pauses.', 'Tap a formation to select it, tap the ground to move, tap an enemy to attack. Long-press for the command wheel.'),
  T('h_battle_deploy', 'battle', 'battle.deployment', 0, 'Deployment', 'Arrange your army inside the shaded zone before the battle begins. Spears in front, archers behind, horse on the wings.'),
  T('h_battle_shapes', 'battle', 'battle.first_selection', 2, 'Formations', 'Line for frontage, column for marching, square or circle against horse, wedge for charges, loose against arrows.'),
  T('h_battle_archers', 'battle', 'battle.archers_selected', 1, 'Archers', 'Archers kill at range but die in melee. Keep spears between them and the enemy; watch their arrows (pips on the card).'),
  T('h_battle_cavalry', 'battle', 'battle.cavalry_selected', 1, 'Horsemen', 'Charge flanks, rear and archers. Never charge braced spears from the front - and keep horses away from elephants.'),
  T('h_battle_elephants', 'battle', 'battle.elephants_selected', 1, 'War elephants', 'Elephants break lines and horses, but arrows and javelins can panic them - and a panicking elephant tramples whoever is in the way.'),
  T('h_battle_waver', 'battle', 'battle.formation_wavering', 0, 'Wavering', 'This formation\'s morale is falling. Hover its morale bar to see why: flanks, losses, fatigue, a fallen commander. Pull it back or support it before it breaks.'),
  T('h_battle_rout', 'battle', 'battle.formation_routed', 0, 'Rout', 'A routing formation runs for its own lines. If it is not attacked for ten seconds and morale recovers, it rallies - order it to Regroup (G).', 'A routing formation may rally if left alone - tap Regroup when it does.'),
  T('h_battle_intent', 'battle', 'battle.intent_available', 3, 'Intent orders', 'Give an objective instead of a path: hold this crossing, protect the archers, screen the flank. The formation\'s officers will work out the details.'),
  T('h_battle_speed', 'battle', 'battle.pause', 4, 'Pause and speed', 'You can give orders while paused. Speed up quiet moments with + and slow down the clash with -.'),
  // --- Hero ---
  T('h_hero_start', 'hero', 'hero.start', 0, 'On foot', 'W A S D to walk, Shift to run, mouse to look. E to talk or inspect when a prompt appears.', 'Left thumb to walk, right thumb to look. Tap the prompt to talk or inspect.'),
  T('h_hero_clue', 'hero', 'hero.inspect_clue', 1, 'A clue', 'You noticed something. Clues unlock the Reveal argument in negotiations with people who would rather it stayed hidden.'),
  T('h_hero_negotiation', 'hero', 'hero.negotiation_start', 0, 'Negotiation', 'Each argument moves their stance. Duty, Gain, Strength and Kinship land differently on different people - read their interests. You have limited patience to spend.'),
  T('h_hero_combat', 'hero', 'hero.combat_start', 0, 'Steel', 'Left mouse: strike (three-hit combo). Hold right mouse: heavy blow. Space: roll (invulnerable mid-roll). Hold Q: guard; tap it as a blow lands to parry. Tab: lock on.', 'ATTACK for the combo, hold HEAVY, swipe to roll, hold GUARD (tap at the right moment to parry). Tap an enemy to lock on.'),
  T('h_hero_stamina', 'hero', 'hero.low_stamina', 1, 'Breath', 'Attacks, rolls and blocks spend stamina (the gold bar). Out of breath, you cannot roll - step back and let it refill.'),
  T('h_hero_red', 'hero', 'hero.unblockable_seen', 1, 'Red flash', 'A red flash means an unblockable blow. Do not guard - roll.'),
];
