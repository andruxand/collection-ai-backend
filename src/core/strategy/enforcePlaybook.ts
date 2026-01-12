import type { NbaDecision, NluResult } from '../types';
import type { ConversationStrategy } from './strategy';

type Enforcement = {
  originalAction: NbaDecision['action'];
  enforcedAction: NbaDecision['action'];
  reason: 'playbook_primary' | 'playbook_secondary';
};

function nextStateForAction(action: NbaDecision['action']): string | undefined {
  if (action === 'SHOW_DETAIL') return 'DETAIL';
  if (action === 'SHOW_OFFERS') return 'OFFER_MENU';
  if (action === 'SEND_PAYMENT_LINK') return 'PAYMENT';
  if (action === 'CREATE_PROMISE') return 'REMINDERS';
  if (action === 'OPT_OUT' || action === 'END_REFUSAL') return 'DONE';
  return undefined;
}

function isNbaAction(value: unknown): value is NbaDecision['action'] {
  return (
    typeof value === 'string' &&
    [
      'OPT_OUT',
      'ACK_ALREADY_PAID',
      'ACK_DISPUTE',
      'DEESCALATE',
      'PERSUADE',
      'END_REFUSAL',
      'GREET',
      'CLARIFY',
      'REDIRECT_MENU',
      'ASK_SLOT',
      'SHOW_DETAIL',
      'SHOW_OFFERS',
      'SEND_PAYMENT_LINK',
      'PROACTIVE_OUTREACH',
      'CREATE_PROMISE',
      'FALLBACK_MENU',
      'COOLDOWN',
    ].includes(value)
  );
}

function allowEnforcementForIntent(intent: NluResult['intent']): boolean {
  // Never override in sensitive situations.
  return (
    intent !== 'ANGRY' && intent !== 'DISPUTE' && intent !== 'OPT_OUT' && intent !== 'ALREADY_PAID'
  );
}

export function enforcePlaybookOnNba(input: {
  nba: NbaDecision;
  nlu: NluResult;
  strategy: ConversationStrategy;
  offersCount: number;
}): { nba: NbaDecision; enforcement?: Enforcement } {
  const { nba, nlu, strategy, offersCount } = input;

  if (!allowEnforcementForIntent(nlu.intent)) return { nba };

  const primaryRaw = strategy.playbook?.primaryAction;
  const secondaryRaw = strategy.playbook?.secondaryAction;

  const primary = isNbaAction(primaryRaw) ? primaryRaw : undefined;
  const secondary = isNbaAction(secondaryRaw) ? secondaryRaw : undefined;

  if (!primary && !secondary) return { nba };

  // Conservative: only override when DM tries to send the user back to menus/loops,
  // and we have a clear playbook primary action that can move the conversation forward.
  const overridable = new Set<NbaDecision['action']>(['FALLBACK_MENU', 'REDIRECT_MENU']);
  if (!overridable.has(nba.action)) return { nba };

  const isViable = (action: NbaDecision['action']): boolean => {
    // Minimal viability checks: we only enforce actions that are safe and don't require
    // additional structured fields (e.g., ASK_SLOT.slot).
    if (action === 'SHOW_OFFERS') return offersCount > 0;
    if (action === 'SEND_PAYMENT_LINK') return true;
    if (action === 'SHOW_DETAIL') return true;
    if (action === 'CLARIFY') return true;
    return false;
  };

  const desired =
    (primary && isViable(primary)
      ? ({ action: primary, reason: 'playbook_primary' } as const)
      : undefined) ??
    (secondary && isViable(secondary)
      ? ({ action: secondary, reason: 'playbook_secondary' } as const)
      : undefined);

  if (!desired) return { nba };
  if (nba.action === desired.action) return { nba };

  const nextState = nextStateForAction(desired.action) ?? nba.nextState;
  const enforced: NbaDecision = {
    ...(nba as any),
    action: desired.action,
    nextState,
  };

  return {
    nba: enforced,
    enforcement: {
      originalAction: nba.action,
      enforcedAction: desired.action,
      reason: desired.reason,
    },
  };
}
