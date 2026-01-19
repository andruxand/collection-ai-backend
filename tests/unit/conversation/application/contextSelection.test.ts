import { describe, expect, test } from 'vitest';

import { selectLastTurnsCount, shouldSummarize } from '@/conversation/application/contextSelection';
import type { ConversationState } from '@/core/types';

function baseConv(overrides?: Partial<ConversationState>): ConversationState {
  return { state: 'WELCOME', slots: {}, attemptCount: 1, ...overrides };
}

describe('contextSelection', () => {
  test('selectLastTurnsCount defaults to 8', () => {
    const n = selectLastTurnsCount({ conversation: baseConv(), defaultCount: 8 });
    expect(n).toBe(8);
  });

  test('selectLastTurnsCount bumps to 10 for dispute', () => {
    const n = selectLastTurnsCount({
      conversation: baseConv({ lastIntent: 'DISPUTE' }),
      defaultCount: 8,
    });
    expect(n).toBe(10);
  });

  test('selectLastTurnsCount hard caps at 12', () => {
    const n = selectLastTurnsCount({
      conversation: baseConv({ lastIntent: 'DISPUTE' }),
      defaultCount: 20,
    });
    expect(n).toBe(12);
  });

  test('shouldSummarize every 6 turns', () => {
    expect(
      shouldSummarize({
        nextTurnCount: 6,
        lastSummaryTurnCount: 0,
        stateChanged: false,
        triggerIntent: 'PAY_LATER',
        windowExceeded: false,
      })
    ).toBe(true);
  });

  test('shouldSummarize on dispute intent', () => {
    expect(
      shouldSummarize({
        nextTurnCount: 2,
        lastSummaryTurnCount: 1,
        stateChanged: false,
        triggerIntent: 'DISPUTE',
        windowExceeded: false,
      })
    ).toBe(true);
  });

  test('shouldSummarize on window exceeded', () => {
    expect(
      shouldSummarize({
        nextTurnCount: 2,
        lastSummaryTurnCount: 1,
        stateChanged: false,
        triggerIntent: 'PAY_LATER',
        windowExceeded: true,
      })
    ).toBe(true);
  });
});
