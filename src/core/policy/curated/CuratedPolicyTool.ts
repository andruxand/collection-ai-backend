import {
  listPolicyVersions,
  loadCuratedPolicyDefinition,
  loadSourceRegistry,
} from './CuratedPolicyStore';
import type { CuratedPolicyDefinition, CuratedPolicySnapshot, SourceRegistryItem } from './schemas';
import { CuratedPolicySnapshotSchema } from './schemas';

function capStrings(items: string[], maxItems: number): string[] {
  return items
    .filter((s) => typeof s === 'string')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .slice(0, maxItems)
    .map((s) => s.slice(0, 220));
}

function resolveSourceRefsMinimal(params: {
  sourceRefs: string[];
  registry: Record<string, SourceRegistryItem>;
}): Array<{ title: string; url: string }> {
  const out: Array<{ title: string; url: string }> = [];
  for (const sourceId of params.sourceRefs) {
    const item = params.registry[sourceId];
    if (!item) continue;
    out.push({ title: item.title, url: item.url });
    if (out.length >= 10) break;
  }
  return out;
}

function baselineSafePolicy(countryCode: string): CuratedPolicySnapshot {
  return CuratedPolicySnapshotSchema.parse({
    countryCode,
    policyVersion: 'baseline.safe.v1',
    effectiveDateIso: '2026-01-18',
    lastReviewedAtIso: '2026-01-18',
    hardRules: [
      'Nunca amenaces con acciones legales, embargo, cárcel o “cobro jurídico”.',
      'No reveles detalles de deuda a terceros; si no hay verificación de identidad, pide verificación mínima o cierra.',
      'No uses lenguaje intimidatorio, discriminatorio o humillante.',
      'En modo WRONG_PERSON: no menciones saldo, mora, deuda o montos; confirma número equivocado y ofrece detener contactos.',
    ],
    softGuidelines: [
      'Mantén el mensaje corto, respetuoso y orientado a una acción concreta.',
      'Si hay disputa, adopta tono neutral y ofrece escalar con un asesor si está habilitado.',
    ],
    disclaimers: [
      'Este sistema aplica un ruleset de compliance; no es asesoría legal.',
      'Las reglas se basan en fuentes públicas y pueden actualizarse.',
    ],
    complianceNotes: [
      'NO_LEGAL_THREATS',
      'NO_THIRD_PARTY_DISCLOSURE',
      'WRONG_PERSON_NO_DEBT_DETAILS',
      'FALLBACK_POLICY_USED',
    ],
    sourceRefsMinimal: [],
    missingFallbackUsed: true,
  });
}

function toSnapshot(params: {
  def: CuratedPolicyDefinition;
  registry: Record<string, SourceRegistryItem>;
  missingFallbackUsed?: boolean;
}): CuratedPolicySnapshot {
  const complianceNotes: string[] = [
    'NO_LEGAL_THREATS',
    'NO_THIRD_PARTY_DISCLOSURE',
    'NO_HARASSMENT',
    'WRONG_PERSON_NO_DEBT_DETAILS',
  ];

  const snap = {
    countryCode: params.def.countryCode,
    policyVersion: params.def.policyVersion,
    effectiveDateIso: params.def.effectiveDateIso,
    lastReviewedAtIso: params.def.lastReviewedAtIso,
    hardRules: capStrings(params.def.hardRules, 20),
    softGuidelines: capStrings(params.def.softGuidelines, 20),
    disclaimers: capStrings(params.def.disclaimers, 12),
    complianceNotes: complianceNotes.slice(0, 24),
    sourceRefsMinimal: resolveSourceRefsMinimal({
      sourceRefs: params.def.sourceRefs,
      registry: params.registry,
    }),
    missingFallbackUsed: params.missingFallbackUsed,
  } satisfies CuratedPolicySnapshot;

  return CuratedPolicySnapshotSchema.parse(snap);
}

export class CuratedPolicyTool {
  static resolvePolicySnapshot(params: { countryCode: string; policyVersion?: string }): {
    snapshot: CuratedPolicySnapshot;
    usedFallback: boolean;
    missingSourceIds: string[];
  } {
    const cc = String(params.countryCode || 'CO').toUpperCase();

    const registry = loadSourceRegistry();

    const version =
      params.policyVersion ??
      (() => {
        const versions = listPolicyVersions(cc);
        return versions[0];
      })();

    if (!version) {
      return {
        snapshot: baselineSafePolicy(cc),
        usedFallback: true,
        missingSourceIds: [],
      };
    }

    try {
      const def = loadCuratedPolicyDefinition({ countryCode: cc, policyVersion: version });

      const missingSourceIds = def.sourceRefs.filter((id) => !registry[id]);
      const snapshot = toSnapshot({ def, registry, missingFallbackUsed: false });

      return { snapshot, usedFallback: false, missingSourceIds };
    } catch {
      return {
        snapshot: baselineSafePolicy(cc),
        usedFallback: true,
        missingSourceIds: [],
      };
    }
  }
}
