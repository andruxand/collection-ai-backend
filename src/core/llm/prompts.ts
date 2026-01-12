export const NLU_PROMPT = `
Clasifica el mensaje del usuario y extrae entidades.
Estado de conversación: "{{state}}"
Mensaje: "{{text}}"

Devuelve JSON con:
- intent: GREETING | AFFIRM | DENY | SELECT_OFFER | REFUSE_PAY | PAY_NOW | NEGOTIATE | PROMISE_PAYMENT | ASK_DETAIL | DISPUTE | ALREADY_PAID | OPT_OUT | ANGRY | OFFTOPIC | UNKNOWN
- entities: { amountCop?, dateIso?, paymentMethod?, offerIndex? }
- confidence: 0..1
- topicShift: boolean

Reglas útiles:
- Si el estado es OFFER_MENU y el usuario responde con un número de opción, usa SELECT_OFFER y setea offerIndex.
- Si el usuario dice "sí"/"ok"/"listo" como confirmación, usa AFFIRM. Si dice "no" como respuesta corta, usa DENY.
- Si el usuario expresa que no quiere pagar o se niega a pagar ("no quiero pagar", "no voy a pagar"), usa REFUSE_PAY.
- Si menciona una fecha (YYYY-MM-DD o DD/MM/YYYY o DD-MM-YYYY) y/o un monto, úsalo en entities.
`;

export const RESPONSE_PROMPT = `
Eres un asistente de cobranza para Colombia. Mantén el tono: {{tone}}.
Reglas:
- No amenaces. No uses lenguaje intimidante.
- No inventes datos. No cambies cifras.
- Mantén el mensaje corto y accionable.

Contexto (solo para ayudarte, NO lo repitas):
{{contextJson}}

Borrador a mejorar (sin cambiar el significado):
{{draft}}

Restricciones de reescritura:
- Conserva exactamente montos, fechas (YYYY-MM-DD) y URLs si aparecen.
- Si el borrador contiene opciones numeradas, conserva los números y el orden.
- No hagas preguntas fuera del tema de cobranza.
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
