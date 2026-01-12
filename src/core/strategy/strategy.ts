import type { DebtorSnapshot, TenantPolicy, TenantStage } from '../types';

export type StrategyObjective = 'COLLECT_NOW' | 'NEGOTIATE' | 'PROMISE' | 'NUDGE' | 'VERIFY';

export type ConversationStrategy = {
  objective: StrategyObjective;
  tone: string;
  matchedRuleIndex?: number;
  playbook?: {
    goal: string;
    primaryAction?: string;
    secondaryAction?: string;
  };
};

function pickToneByKey(policy: TenantPolicy, key: 'T1' | 'T2' | 'T3'): string {
  return policy.tonePolicy?.[key] ?? policy.tonePolicy.T1;
}

function defaultTone(policy: TenantPolicy, debtor: DebtorSnapshot): string {
  if (debtor.daysPastDue <= 15) return policy.tonePolicy.T1;
  if (debtor.daysPastDue <= 60) return policy.tonePolicy.T2;
  return policy.tonePolicy.T3;
}

function matchesRule(params: {
  debtor: DebtorSnapshot;
  when: {
    minDaysPastDue?: number;
    maxDaysPastDue?: number;
    minTotalDueCop?: number;
    maxTotalDueCop?: number;
    stages?: TenantStage[];
  };
}): boolean {
  const { debtor, when } = params;
  if (typeof when.minDaysPastDue === 'number' && debtor.daysPastDue < when.minDaysPastDue)
    return false;
  if (typeof when.maxDaysPastDue === 'number' && debtor.daysPastDue > when.maxDaysPastDue)
    return false;

  if (typeof when.minTotalDueCop === 'number' && debtor.totalDueCop < when.minTotalDueCop)
    return false;
  if (typeof when.maxTotalDueCop === 'number' && debtor.totalDueCop > when.maxTotalDueCop)
    return false;

  if (Array.isArray(when.stages) && when.stages.length > 0 && !when.stages.includes(debtor.stage))
    return false;

  return true;
}

export function computeConversationStrategy(input: {
  tenantPolicy: TenantPolicy;
  debtor: DebtorSnapshot;
}): ConversationStrategy {
  const { tenantPolicy, debtor } = input;

  const sp = tenantPolicy.strategyPolicy;

  // Safe defaults: push to resolution while allowing softer nudges for early/low cases.
  const defaultObjective: StrategyObjective =
    sp?.defaultObjective ?? (debtor.daysPastDue <= 7 ? 'NUDGE' : 'NEGOTIATE');

  const baseTone = defaultTone(tenantPolicy, debtor);

  const playbookFor = (objective: StrategyObjective) =>
    tenantPolicy.strategyPolicy?.objectivePlaybook?.[objective];

  const rules = sp?.rules ?? [];
  for (let i = 0; i < rules.length; i += 1) {
    const r = rules[i];
    if (!r || typeof r !== 'object') continue;
    if (!matchesRule({ debtor, when: r.when ?? {} })) continue;

    const objective = r.objective ?? defaultObjective;
    const tone = r.tone ?? (r.toneKey ? pickToneByKey(tenantPolicy, r.toneKey) : baseTone);

    return {
      objective,
      tone,
      matchedRuleIndex: i,
      playbook: playbookFor(objective),
    };
  }

  return {
    objective: defaultObjective,
    tone: baseTone,
    playbook: playbookFor(defaultObjective),
  };
}
