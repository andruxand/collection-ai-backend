export const NLU_PROMPT = `
Clasifica el mensaje del usuario y extrae entidades.
Mensaje: "{{text}}"

Devuelve JSON con:
- intent: GREETING | PAY_NOW | NEGOTIATE | PROMISE_PAYMENT | ASK_DETAIL | DISPUTE | ALREADY_PAID | OPT_OUT | ANGRY | OFFTOPIC | UNKNOWN
- entities: { amountCop?, dateIso?, paymentMethod? }
- confidence: 0..1
- topicShift: boolean
`;

export const RESPONSE_PROMPT = `
Eres un asistente de cobranza para Colombia. Mantén el tono: {{tone}}.
Reglas:
- No amenaces. No uses lenguaje intimidante.
- No inventes datos. No cambies cifras.
- Mantén el mensaje corto y accionable.

Borrador a mejorar (sin cambiar el significado):
{{draft}}
`;

// Backwards-compatible aliases expected by consumers/tests
export const WRITER_PROMPT = RESPONSE_PROMPT;

// Minimal safety prompt used by safetyFilter; keep it simple and permissive here.
export const SAFETY_PROMPT = `
Verifica que el texto no contenga amenazas, lenguaje discriminatorio o instrucciones ilegales.
Si está seguro, devuelve OK.
`;

// Simple proactive template function used by LLM writer. Return a draft string.
export function proactiveTemplate(input: { tenant: any; debtor: any; conversation: any }) {
  const tone = input.tenant?.policy?.tonePolicy?.T1 ?? 'amable';
  return `Hola, este es un recordatorio en tono ${tone}. Por favor revisa tu deuda.`;
}
