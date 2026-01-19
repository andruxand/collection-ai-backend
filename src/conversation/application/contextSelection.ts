import type { ConversationState, MultiAgentConversationState } from '../../core/types';

export function selectLastTurnsCount(params: {
  conversation: ConversationState;
  multiAgent?: MultiAgentConversationState;
  defaultCount: number;
}): number {
  const hardCap = 12;
  const base = Math.max(1, params.defaultCount);

  const lastIntent = params.conversation.lastIntent;
  const state = params.conversation.state;
  const negotiationRounds = params.multiAgent?.budgets?.counters?.negotiationRounds ?? 0;

  const bumpTo10 =
    lastIntent === 'DISPUTE' ||
    lastIntent === 'WRONG_PERSON' ||
    lastIntent === 'ABUSIVE' ||
    state === 'NEGOTIATE' ||
    negotiationRounds > 0;

  const desired = bumpTo10 ? Math.max(base, 10) : base;
  return Math.min(desired, hardCap);
}

export function shouldSummarize(params: {
  nextTurnCount: number;
  lastSummaryTurnCount: number | undefined;
  stateChanged: boolean;
  triggerIntent?: string;
  windowExceeded: boolean;
}): boolean {
  const intent = params.triggerIntent;
  if (intent === 'DISPUTE' || intent === 'WRONG_PERSON' || intent === 'ABUSIVE') return true;
  if (params.stateChanged) return true;
  if (params.windowExceeded) return true;

  const last = params.lastSummaryTurnCount ?? 0;
  return params.nextTurnCount - last >= 6;
}
