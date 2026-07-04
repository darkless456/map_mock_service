import fs from 'node:fs';
import path from 'node:path';

interface CacheEntry<T> {
  readonly mtimeMs: number;
  readonly data: T;
}

export class FixtureLoader {
  private readonly cache = new Map<string, CacheEntry<unknown>>();
  private readonly overrideStack: ReadonlyMap<string, unknown>[] = [];

  constructor(private readonly rootDir: string) {}

  read<T>(relativePath: string, validate?: (raw: unknown) => T): T {
    const override = this.findOverride(relativePath);
    if (override.found) return validate ? validate(override.value) : (override.value as T);

    const abs = path.join(this.rootDir, relativePath);
    const mtimeMs = fs.statSync(abs).mtimeMs;
    const cached = this.cache.get(abs);
    if (cached && cached.mtimeMs === mtimeMs) return cached.data as T;

    const text = fs.readFileSync(abs, 'utf8');
    const raw = JSON.parse(relativePath.endsWith('.jsonc') ? stripJsonComments(text) : text) as unknown;
    const data = validate ? validate(raw) : (raw as T);
    this.cache.set(abs, { mtimeMs, data });
    return data;
  }

  async withOverrides<T>(
    overrides: Readonly<Record<string, unknown>> | undefined,
    run: () => Promise<T>,
  ): Promise<T> {
    if (!overrides || Object.keys(overrides).length === 0) return run();
    this.overrideStack.push(new Map(
      Object.entries(overrides).map(([key, value]) => [normalizeRelativePath(key), value]),
    ));
    try {
      return await run();
    } finally {
      this.overrideStack.pop();
    }
  }

  private findOverride(relativePath: string): { readonly found: true; readonly value: unknown } | { readonly found: false } {
    const key = normalizeRelativePath(relativePath);
    for (let index = this.overrideStack.length - 1; index >= 0; index -= 1) {
      const overrides = this.overrideStack[index];
      if (overrides.has(key)) return { found: true, value: overrides.get(key) };
    }
    return { found: false };
  }
}

function normalizeRelativePath(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\/+/, '');
}

function stripJsonComments(input: string): string {
  let output = '';
  let inString = false;
  let quote = '';
  let escaped = false;

  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];
    const next = input[i + 1];

    if (inString) {
      output += char;
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === quote) {
        inString = false;
        quote = '';
      }
      continue;
    }

    if (char === '"' || char === "'") {
      inString = true;
      quote = char;
      output += char;
      continue;
    }

    if (char === '/' && next === '/') {
      while (i < input.length && input[i] !== '\n') i += 1;
      output += '\n';
      continue;
    }

    if (char === '/' && next === '*') {
      i += 2;
      while (i < input.length && !(input[i] === '*' && input[i + 1] === '/')) i += 1;
      i += 1;
      continue;
    }

    output += char;
  }

  return output;
}
