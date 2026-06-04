/**
 * 场景说明 — 从 YAML `guide` 块解析，供 /sim/panel 与 API 展示。
 */
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';

const SERVICE_ROOT = path.resolve(__dirname, '..', '..');
export const DEFAULT_SCENARIO_ROOT = path.join(SERVICE_ROOT, 'scenarios');

export interface ScenarioGuideDoc {
  readonly name: string;
  readonly title: string;
  readonly domain: string;
  readonly domainLabel: string;
  readonly summary: string;
  readonly whenToUse: string;
  readonly simulates: readonly string[];
  readonly prerequisites: readonly string[];
  readonly userSteps: readonly string[];
  readonly autoBehavior: readonly string[];
  readonly duration: string;
  readonly pushes: readonly string[];
}

export interface ScenarioGuideSummary {
  readonly name: string;
  readonly title: string;
  readonly domainLabel: string;
  readonly summary: string;
  readonly duration: string;
}

function scenarioRootDir(root?: string): string {
  return root ?? DEFAULT_SCENARIO_ROOT;
}

function resolveScenarioFile(name: string, root?: string): string | null {
  const safeName = name.replace(/\.ya?ml$/i, '');
  const dir = scenarioRootDir(root);
  const candidates = [
    path.join(dir, `${safeName}.yaml`),
    path.join(dir, `${safeName}.yml`),
  ];
  return candidates.find(candidate => fs.existsSync(candidate)) ?? null;
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function readStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map(item => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean);
}

function domainLabel(domain: string): string {
  if (domain === 'mowing') return '割草';
  if (domain === 'mapping') return '建图';
  if (domain === 'mapEdit') return '地图编辑';
  return domain || '通用';
}

function parseGuideBlock(
  name: string,
  raw: Record<string, unknown>,
): ScenarioGuideDoc | null {
  const guide = raw.guide;
  if (typeof guide !== 'object' || guide === null || Array.isArray(guide)) {
    return null;
  }
  const block = guide as Record<string, unknown>;
  const domain = readString(raw.domain) || 'mapping';
  const title = readString(block.title) || name;
  const summary =
    readString(block.summary) || readString(raw.description) || title;
  return {
    name,
    title,
    domain,
    domainLabel: readString(block.domain_label) || domainLabel(domain),
    summary,
    whenToUse: readString(block.when_to_use),
    simulates: readStringList(block.simulates),
    prerequisites: readStringList(block.prerequisites),
    userSteps: readStringList(block.user_steps),
    autoBehavior: readStringList(block.auto_behavior),
    duration: readString(block.duration),
    pushes: readStringList(block.pushes),
  };
}

/** 加载单个场景的完整说明（无 `guide` 块时返回 null）。 */
export function loadScenarioGuide(
  name: string,
  root?: string,
): ScenarioGuideDoc | null {
  const file = resolveScenarioFile(name, root);
  if (!file) return null;
  const parsed = yaml.load(fs.readFileSync(file, 'utf8'));
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return null;
  }
  const safeName = path.basename(file, path.extname(file));
  return parseGuideBlock(safeName, parsed as Record<string, unknown>);
}

/** 列出所有已注册场景及摘要（供下拉框与目录）。 */
export function listScenarioGuideSummaries(
  root?: string,
): ScenarioGuideSummary[] {
  const dir = scenarioRootDir(root);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter(file => file.endsWith('.yaml') || file.endsWith('.yml'))
    .sort()
    .map(file => path.basename(file, path.extname(file)))
    .map(name => {
      const doc = loadScenarioGuide(name, dir);
      if (doc) {
        return {
          name: doc.name,
          title: doc.title,
          domainLabel: doc.domainLabel,
          summary: doc.summary,
          duration: doc.duration,
        };
      }
      return {
        name,
        title: name,
        domainLabel: '—',
        summary: '',
        duration: '',
      };
    });
}
