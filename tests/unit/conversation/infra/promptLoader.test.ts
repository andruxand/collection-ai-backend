import { describe, expect, test } from 'vitest';

import {
  clearPromptCache,
  loadPrompt,
  loadPromptComposed,
} from '@/core/conversation/infra/promptLoader';

describe('promptLoader', () => {
  test('loads prompt from file', () => {
    clearPromptCache();
    const txt = loadPrompt('classifier.prompt.md');
    expect(txt).toContain('ClassifierAgent');
  });

  test('composes prompts with addendums', () => {
    clearPromptCache();
    const txt = loadPromptComposed('planner.prompt.md', ['planner.mode.negotiation.md']);
    expect(txt).toContain('PlannerAgent');
    expect(txt).toContain('---');
  });
});
