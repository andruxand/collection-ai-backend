import fs from 'node:fs';
import path from 'node:path';

import {
  type CuratedPolicyDefinition,
  type SourceRegistryItem,
  CuratedPolicyDefinitionSchema,
  SourceRegistryItemSchema,
} from './schemas';

const cache = {
  sources: null as null | Record<string, SourceRegistryItem>,
  policyByKey: new Map<string, CuratedPolicyDefinition>(),
  policyVersionsByCountry: new Map<string, string[]>(),
};

function baseDir(): string {
  // Packaged Lambda artifacts typically run with cwd=/var/task
  return path.join(process.cwd(), 'src', 'core', 'policy', 'curated', 'data');
}

function normalizeCountryCode(countryCode: string): string {
  return String(countryCode || '').toUpperCase();
}

function readJsonFile(abs: string): unknown {
  const raw = fs.readFileSync(abs, 'utf8');
  return JSON.parse(raw);
}

export function loadSourceRegistry(): Record<string, SourceRegistryItem> {
  if (cache.sources) return cache.sources;

  const abs = path.join(baseDir(), 'sources.json');
  const raw = readJsonFile(abs);
  const items = Array.isArray(raw) ? raw : [];

  const out: Record<string, SourceRegistryItem> = {};
  for (const it of items) {
    const parsed = SourceRegistryItemSchema.parse(it);
    out[parsed.sourceId] = parsed;
  }

  cache.sources = out;
  return out;
}

export function listPolicyVersions(countryCode: string): string[] {
  const cc = normalizeCountryCode(countryCode);
  const cached = cache.policyVersionsByCountry.get(cc);
  if (cached) return cached;

  const countryDir = path.join(baseDir(), cc);
  let files: string[] = [];
  try {
    files = fs.readdirSync(countryDir);
  } catch {
    files = [];
  }

  const versions = files
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.replace(/\.json$/i, ''))
    .filter((v) => v.length > 0)
    // Lexicographic sort works for YYYY-MM-DD.vN
    .sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));

  cache.policyVersionsByCountry.set(cc, versions);
  return versions;
}

export function loadCuratedPolicyDefinition(params: {
  countryCode: string;
  policyVersion: string;
}): CuratedPolicyDefinition {
  const cc = normalizeCountryCode(params.countryCode);
  const key = `${cc}::${params.policyVersion}`;
  const cached = cache.policyByKey.get(key);
  if (cached) return cached;

  const abs = path.join(baseDir(), cc, `${params.policyVersion}.json`);
  const raw = readJsonFile(abs);
  const parsed = CuratedPolicyDefinitionSchema.parse(raw);
  cache.policyByKey.set(key, parsed);
  return parsed;
}

export function clearCuratedPolicyCache() {
  cache.sources = null;
  cache.policyByKey.clear();
  cache.policyVersionsByCountry.clear();
}
