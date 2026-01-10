# LLM Usage (Cost/Benefit and Safety)

## MVP choice: OpenAI `gpt-4o-mini`
We use an LLM for:
1) **NLU**: intent + entities via **Structured Outputs (JSON Schema)**  
2) Optional **copy polishing**: turning deterministic decisions into natural language

This keeps the system deterministic and auditable while still conversational.

## Important design principles
- The LLM **does not** decide:
  - whether to contact (policy does)
  - the discount/offer (offer engine does)
  - the compliance decisions (policy does)
- The LLM is used for classification and wording only.

## Files
- `src/core/llm/llmClient.ts` — OpenAI Responses API client
- `src/core/nlu/parseIntent.ts` — NLU uses JSON schema, fallback regex
- `src/core/llm/prompts.ts` — prompt templates
- `src/core/llm/safetyFilter.ts` — final guardrails

## Prompting guidance
- Use **strict JSON schema** for NLU
- Use low temperature (0–0.2)
- Include minimal sensitive info; prefer IDs + summarized balances
