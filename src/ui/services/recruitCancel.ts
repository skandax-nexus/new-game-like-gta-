/**
 * Cancelling a recruitment job from the settlement panel (ticket UI-02 item 2: "construction and recruitment queues
 * with progress / cancel"). The strategic command does not exist yet: it is requested from the CTO (core/types
 * StrategicCommand) and SIM-01 (validate / apply + refund in src/sim/strategic). Until it lands, the panel shows the
 * cancel button disabled with its reason; it lights up by itself once the simulation knows the command.
 *
 * Feature detection uses only the existing validation contract: `validateCommand` answers every known command kind
 * with a reason for a settlement that does not exist ("No such settlement"), and returns null for kinds it does not
 * know (commands.ts `default: return null`); a control probe with a made-up kind guards against faction-level refusals.
 * The probe is memoized once conclusive.
 *
 * Requested command (exact): `{ kind: 'cancel_recruitment'; settlementId: SettlementId; index: number }` -
 * `index` into SettlementState.recruitment. Refund rule requested (mirrors cancel_construction, RULES.construction
 * .cancelRefund = 0.9): the recruits return to the settlement's recruitPool in full; wealth and grain refunded at
 * (1 - progress) x 0.9 of what was paid (a queued job that has not started refunds 0.9 of everything).
 * OWNER: UI Engineer - In-game HUD, Command Card, Minimap & Input (UI-02). Pure (no DOM).
 */
import type { SettlementId, StrategicCommand } from '../../core/types';

export const CANCEL_RECRUITMENT_KIND = 'cancel_recruitment';

/** The requested StrategicCommand member (until core/types has it). */
export interface CancelRecruitmentCommand {
  kind: typeof CANCEL_RECRUITMENT_KIND;
  settlementId: SettlementId;
  index: number;
}

/** Validation function shape of sim/strategic/selectors.commandReason, bound to a world and faction. */
export type CommandValidator = (cmd: StrategicCommand) => string | null;

/** Reason shown on the disabled cancel button while the simulation has no cancel_recruitment command. */
export const RECRUIT_CANCEL_UNAVAILABLE = 'Recruits already called up cannot be sent home yet';

/** Tooltip of an enabled cancel button. */
export const RECRUIT_CANCEL_HINT = 'Cancel: the recruits go home; 90% of the unspent wealth and grain is refunded';

const PROBE_SETTLEMENT = '\u0000ui-probe';

/** The command object the panel issues (typed as a StrategicCommand once core/types has the member). */
export function cancelRecruitmentCommand(settlementId: SettlementId, index: number): StrategicCommand {
  const cmd: CancelRecruitmentCommand = { kind: CANCEL_RECRUITMENT_KIND, settlementId, index };
  // Cast until the CTO adds the member to StrategicCommand; then this is a plain widening and can be removed.
  return cmd as unknown as StrategicCommand;
}

let probed: boolean | null = null;

/** Does the simulation know cancel_recruitment? (memoized; `reset` for tests). */
export function recruitCancelSupported(validate: CommandValidator, reset = false): boolean {
  if (reset) probed = null;
  if (probed !== null) return probed;
  try {
    // A command kind nobody knows: must come back null, else the answer is about the faction (defeated...) and the
    // probe is inconclusive this time (not memoized).
    const control = validate({ kind: '\u0000ui-probe-unknown' } as unknown as StrategicCommand);
    if (control !== null) return false;
    probed = validate(cancelRecruitmentCommand(PROBE_SETTLEMENT, 0)) !== null;
  } catch {
    probed = false;
  }
  return probed;
}

export interface RecruitCancelState {
  /** Show the button (own settlement). */
  visible: boolean;
  enabled: boolean;
  /** Tooltip / aria text: the refund hint, or why it is disabled. */
  reason: string;
}

/** Cancel button state of recruitment row `index` of an own / foreign settlement. */
export function recruitCancelState(validate: CommandValidator, settlementId: SettlementId, index: number, mine: boolean): RecruitCancelState {
  if (!mine) return { visible: false, enabled: false, reason: '' };
  if (!recruitCancelSupported(validate)) return { visible: true, enabled: false, reason: RECRUIT_CANCEL_UNAVAILABLE };
  const why = validate(cancelRecruitmentCommand(settlementId, index));
  return why ? { visible: true, enabled: false, reason: why } : { visible: true, enabled: true, reason: RECRUIT_CANCEL_HINT };
}
