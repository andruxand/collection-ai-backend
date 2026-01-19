import fs from 'node:fs';
import path from 'node:path';

const cache = new Map<string, string>();

function promptBaseDir(): string {
  // Packaged Lambda artifacts typically run with cwd=/var/task
  // We ship prompts under src/conversation/prompts/**
  return path.join(process.cwd(), 'src', 'conversation', 'prompts');
}

export function loadPrompt(promptFileName: string): string {
  const key = promptFileName;
  const cached = cache.get(key);
  if (cached) return cached;

  const abs = path.join(promptBaseDir(), promptFileName);
  const txt = fs.readFileSync(abs, 'utf8');
  cache.set(key, txt);
  return txt;
}

export function loadPromptComposed(
  basePromptFileName: string,
  addendumFileNames: string[]
): string {
  const key = `COMPOSED::${[basePromptFileName, ...addendumFileNames].join('::')}`;
  const cached = cache.get(key);
  if (cached) return cached;

  const parts = [loadPrompt(basePromptFileName), ...addendumFileNames.map((f) => loadPrompt(f))];
  const txt = parts.join('\n\n---\n\n');
  cache.set(key, txt);
  return txt;
}

export function fillPrompt(template: string, vars: Record<string, string>): string {
  let out = template;
  for (const [k, v] of Object.entries(vars)) {
    out = out.split(`{{${k}}}`).join(v);
  }
  return out;
}
export function clearPromptCache() {
  cache.clear();
}
