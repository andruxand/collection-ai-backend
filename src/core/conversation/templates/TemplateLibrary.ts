import type { TenantPolicy } from '../../types';

export type TemplateMode =
  | 'NEGOTIATION'
  | 'DISPUTE'
  | 'WRONG_PERSON'
  | 'ABUSE_DEESCALATION'
  | 'HUMAN_HANDOFF';

export type TemplateVariableKey =
  | 'amount'
  | 'date'
  | 'method'
  | 'link'
  | 'hours'
  | 'supportContact';

export type TemplateVariables = Partial<Record<TemplateVariableKey, string | number | undefined>>;

export type TemplateTenantConfig = {
  tonePolicy: Record<string, string>;
  pronoun?: 'TU' | 'USTED';
  emojiPolicy?: 'NONE' | 'MINIMAL';
};

export type RenderTemplateInput = {
  templateId: string;
  mode: TemplateMode;
  vars?: TemplateVariables;
  tenantConfig: TemplateTenantConfig;
};

export type RenderTemplateResult = {
  messageText: string;
  askUser: boolean;
  metadata: {
    tone: string;
    languageVariant: 'es-CO';
    includedSummary: false;
  };
  templateId: string;
  varsUsed: Record<string, string>;
};

type TemplateDefinition = {
  templateId: string;
  modes: TemplateMode[];
  askUser: boolean;
  toneKey: 'T1' | 'T2' | 'T3';
  requiredVars: TemplateVariableKey[];
  /** Must only use allowed variables. */
  body: string;
};

function formatMoneyCop(amount: number): string {
  const rounded = Math.round(amount);
  return `$${rounded.toLocaleString('es-CO')}`;
}

function formatHoursFromPolicy(policy: TenantPolicy): string {
  const monFri = policy.contactPolicy.hours.monFri;
  const sat = policy.contactPolicy.hours.sat;
  const sun = policy.contactPolicy.hours.sunBlocked
    ? 'No atendemos domingos.'
    : 'Domingos: disponible.';
  const hol = policy.contactPolicy.hours.holidaysBlocked
    ? 'Festivos: no atendemos.'
    : 'Festivos: disponible.';

  return `Lun–Vie ${monFri.from}-${monFri.to}. Sáb ${sat.from}-${sat.to}. ${sun} ${hol}`;
}

function applyPronoun(text: string, pronoun: 'TU' | 'USTED'): string {
  if (pronoun === 'TU') return text;
  // Minimal, safe replacement: "tu" -> "su" and "tú" -> "usted" where it’s obvious.
  // Keep this conservative to avoid grammatical corruption.
  return text
    .replace(/\btu\b/gi, (m) => (m[0] === 'T' ? 'Su' : 'su'))
    .replace(/\btú\b/gi, (m) => (m[0] === 'T' ? 'Usted' : 'usted'));
}

function applyEmojiPolicy(text: string, emojiPolicy: 'NONE' | 'MINIMAL'): string {
  if (emojiPolicy === 'NONE') return text;
  // Keep minimal and only add when it helps scannability.
  if (text.includes('Opciones:') && !text.includes('•')) {
    return text.replace('Opciones:', 'Opciones:\n•');
  }
  return text;
}

function safeToString(v: string | number | undefined): string | undefined {
  if (v === undefined) return undefined;
  if (typeof v === 'number') return String(v);
  const s = String(v).trim();
  return s.length > 0 ? s : undefined;
}

function normalizeVars(params: {
  vars: TemplateVariables | undefined;
  policy: TenantPolicy;
}): Record<TemplateVariableKey, string | undefined> {
  const raw = params.vars ?? {};

  const amount =
    typeof raw.amount === 'number'
      ? formatMoneyCop(raw.amount)
      : typeof raw.amount === 'string'
      ? raw.amount
      : undefined;

  const date = safeToString(raw.date);
  const method = safeToString(raw.method);
  const link = safeToString(raw.link);
  const supportContact = safeToString(raw.supportContact);

  const hours =
    safeToString(raw.hours) ??
    // default derived from policy (deterministic)
    formatHoursFromPolicy(params.policy);

  return { amount, date, method, link, hours, supportContact };
}

function extractPlaceholders(body: string): TemplateVariableKey[] {
  const keys = new Set<TemplateVariableKey>();
  const re = /\{\{(amount|date|method|link|hours|supportContact)\}\}/g;
  for (const m of body.matchAll(re)) {
    keys.add(m[1] as TemplateVariableKey);
  }
  return Array.from(keys);
}

function renderBody(
  body: string,
  vars: Record<TemplateVariableKey, string | undefined>
): {
  text: string;
  used: Record<string, string>;
} {
  const used: Record<string, string> = {};

  const text = body.replace(
    /\{\{(amount|date|method|link|hours|supportContact)\}\}/g,
    (_all, keyRaw: string) => {
      const key = keyRaw as TemplateVariableKey;
      const v = vars[key];
      if (v === undefined) return '';
      const safe = v.slice(0, 240);
      used[key] = safe;
      return safe;
    }
  );

  return {
    text: text
      .replace(/\s+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim(),
    used,
  };
}

const TEMPLATES: TemplateDefinition[] = [
  {
    templateId: 'negotiation.reengage',
    modes: ['NEGOTIATION', 'DISPUTE', 'HUMAN_HANDOFF'],
    askUser: true,
    toneKey: 'T2',
    requiredVars: [],
    body: 'Entiendo. volvamos al tema para poder ayudarte: es sobre un saldo pendiente. ¿Prefieres pagar hoy o acordar una fecha? Si este número no corresponde a la persona indicada, dímelo y lo actualizo.',
  },
  {
    templateId: 'negotiation.pay_now',
    modes: ['NEGOTIATION'],
    askUser: true,
    toneKey: 'T2',
    requiredVars: [],
    body: 'Perfecto, podemos proceder con el pago hoy. Opciones: PSE, transferencia o tarjeta. Si prefieres, te envío un enlace de pago. ¿Qué método deseas usar?',
  },
  {
    templateId: 'negotiation.final_warning',
    modes: ['NEGOTIATION'],
    askUser: true,
    toneKey: 'T2',
    requiredVars: [],
    body: 'Para poder ayudarte, necesito que confirmemos un pago o una fecha. ¿Deseas acordar pago hoy o prefieres fecha? Si no deseas acordar pago, puedo cerrar la conversación por ahora.',
  },
  {
    templateId: 'negotiation.polite_close',
    modes: ['NEGOTIATION'],
    askUser: true,
    toneKey: 'T2',
    requiredVars: [],
    body: 'Gracias por tu tiempo. Si no deseas acordar un pago, no puedo continuar la conversación en este momento. Cuando decidas, avísame y te ayudo a pagar.',
  },
  {
    templateId: 'info.how_to_pay',
    modes: ['NEGOTIATION', 'DISPUTE', 'HUMAN_HANDOFF'],
    askUser: true,
    toneKey: 'T2',
    requiredVars: ['hours'],
    body: 'Opciones para pagar: PSE, transferencia o tarjeta. Si quieres, también puedo enviarte un enlace de pago. Horarios de atención: {{hours}}. ¿Qué método prefieres?',
  },
  {
    templateId: 'info.payment_link',
    modes: ['NEGOTIATION', 'DISPUTE', 'HUMAN_HANDOFF'],
    askUser: true,
    toneKey: 'T2',
    requiredVars: ['link'],
    body: 'Aquí tienes el enlace de pago: {{link}}. Si necesitas ayuda, dime qué método prefieres (PSE, transferencia o tarjeta).',
  },
  {
    templateId: 'wrong_person.safe_exit',
    modes: ['WRONG_PERSON'],
    askUser: true,
    toneKey: 'T2',
    requiredVars: [],
    body: 'Gracias por avisar. Para dejarlo correcto: ¿este número NO pertenece a la persona que buscamos? Si es así, lo actualizo y no te volveremos a contactar por este caso.',
  },
  {
    templateId: 'abuse.boundary_warning',
    modes: ['ABUSE_DEESCALATION'],
    askUser: true,
    toneKey: 'T2',
    requiredVars: [],
    body: 'Puedo ayudarte, pero necesito que mantengamos un tono respetuoso. ¿Prefieres pagar hoy o acordar una fecha?',
  },
  {
    templateId: 'dispute.handoff_offer',
    modes: ['DISPUTE'],
    askUser: true,
    toneKey: 'T3',
    requiredVars: [],
    body: 'Entiendo. Para revisarlo con calma, puedo escalar tu caso a un asesor. ¿Confirmas si eres el titular o el autorizado?',
  },
];

function getTemplate(templateId: string): TemplateDefinition | undefined {
  return TEMPLATES.find((t) => t.templateId === templateId);
}

export class TemplateLibrary {
  static listTemplateIds(): string[] {
    return TEMPLATES.map((t) => t.templateId);
  }

  static render(
    params: RenderTemplateInput & { tenantPolicy: TenantPolicy }
  ): { ok: true; value: RenderTemplateResult } | { ok: false; error: string } {
    const def = getTemplate(params.templateId);
    if (!def) return { ok: false, error: `Unknown templateId: ${params.templateId}` };

    if (!def.modes.includes(params.mode)) {
      return {
        ok: false,
        error: `Template ${params.templateId} not allowed for mode ${params.mode}`,
      };
    }

    const tenantTone =
      params.tenantConfig.tonePolicy[def.toneKey] ??
      params.tenantConfig.tonePolicy['T2'] ??
      params.tenantConfig.tonePolicy['T1'] ??
      'directo';

    const normalized = normalizeVars({ vars: params.vars, policy: params.tenantPolicy });

    for (const key of def.requiredVars) {
      if (!normalized[key]) {
        return {
          ok: false,
          error: `Missing required variable: ${key}`,
        };
      }
    }

    const usedInBody = extractPlaceholders(def.body);
    const allowed: TemplateVariableKey[] = [
      'amount',
      'date',
      'method',
      'link',
      'hours',
      'supportContact',
    ];
    for (const k of usedInBody) {
      if (!allowed.includes(k)) {
        return { ok: false, error: `Template uses unsupported variable: ${k}` };
      }
    }

    const { text, used } = renderBody(def.body, normalized);

    const pronoun = params.tenantConfig.pronoun ?? 'TU';
    const emojiPolicy = params.tenantConfig.emojiPolicy ?? 'NONE';
    const finalText = applyEmojiPolicy(applyPronoun(text, pronoun), emojiPolicy);

    if (finalText.length < 1) {
      return { ok: false, error: 'Rendered template is empty' };
    }

    return {
      ok: true,
      value: {
        templateId: def.templateId,
        varsUsed: used,
        messageText: finalText,
        askUser: def.askUser,
        metadata: {
          tone: tenantTone,
          languageVariant: 'es-CO',
          includedSummary: false,
        },
      },
    };
  }
}
