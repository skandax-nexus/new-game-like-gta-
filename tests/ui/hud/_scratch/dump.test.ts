import { it } from 'vitest';
import { armyCard, battleCard, settlementCard } from '../../../../src/ui/services/commandCards';
import { campaign } from '../../../sim/strategic/helpers';
import { testBattle } from '../../../sim/tactical/helpers';
it('dump', () => {
  const w = campaign(7);
  const me = w.playerFactionId;
  const cap = w.factions[me]!.capitalSettlementId!;
  const army = Object.keys(w.armies).sort().find((id) => w.armies[id]!.factionId === me)!;
  for (const preset of ['classic', 'grid'] as const) {
    const c = { preset, overrides: {} };
    for (const t of ['economy', 'recruit']) console.log(preset, t, settlementCard(w, cap, t, c).slots.map((s) => s && `${s.label}:${s.hotkey}`).join(' | '));
    console.log(preset, 'army', armyCard(w, army, c).slots.map((s) => s && `${s.label}:${s.hotkey}`).join(' | '));
    const b = testBattle({ factions: ['heartland', 'highland'], sides: [[{ cls: 'spearmen', x: -40, z: 100 }, { cls: 'archers', x: 40, z: 120 }], [{ cls: 'spearmen', x: 0, z: -100 }]] }).state;
    for (const p of ['orders', 'shapes', 'intents']) console.log(preset, p, battleCard(b, 0, [0], p, c).slots.map((s) => s && `${s.label}:${s.hotkey}`).join(' | '));
  }
});
