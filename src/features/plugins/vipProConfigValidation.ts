import type { PluginDraftValue } from './pluginConfigDraft';

type Translate = (key: string, options?: Record<string, unknown>) => string;

const ROTATION_MODES = ['round-robin', 'fill-first', 'least-recent', 'sticky'];
const PLUS_PREFERENCES = ['off', 'prefer', 'only', 'ignore'];
const FIELD_NAMES = [
  'base-url',
  'fallback-base-url',
  'prefix',
  'headers',
  'request-retry',
  'fallback-retry',
  'sticky-seconds',
  'model-cooldown-minutes',
  'stats-file',
  'rotation-mode',
  'plus-preference',
  'models',
  'free-models',
] as const;

const textOf = (values: Record<string, PluginDraftValue>, name: string) =>
  typeof values[name] === 'string' ? values[name].trim() : '';

const privateHost = (host: string) => {
  const name = host.trim().toLowerCase().replace(/^\[|\]$/g, '');
  if (name === 'localhost') return true;
  const parts = name.split('.');
  if (parts.length !== 4 || parts.some((part) => !/^\d+$/.test(part))) return false;
  const [a, b] = parts.map((part) => Number(part));
  if (parts.some((part) => Number(part) > 255)) return false;
  if (a === 10 || a === 127) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  // RFC 6598 CGNAT, including Tailscale 100.64.0.0/10.
  if (a === 100 && b >= 64 && b <= 127) return true;
  return false;
};

const baseURLError = (value: string) => {
  if (!value) return '';
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return 'base_url';
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash || !parsed.hostname) {
    return 'base_url';
  }
  if (parsed.protocol === 'https:') return '';
  if (parsed.protocol === 'http:' && privateHost(parsed.hostname)) return '';
  return 'base_url';
};

const fallbackBaseURLError = (value: string) => (baseURLError(value) ? 'fallback_base_url' : '');

const integerError = (value: string, min: number, max: number, key: string) => {
  if (!value) return '';
  if (!/^\d+$/.test(value)) return key;
  const parsed = Number(value);
  if (parsed < min || parsed > max) return key;
  return '';
};

const headersError = (value: string) => {
  if (!value || value === '{}') return '';
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return 'headers';
    for (const [key, item] of Object.entries(parsed)) {
      if (typeof item !== 'string') return 'headers';
      const name = key.trim().toLowerCase();
      if (name === 'authorization' || name === 'host') return 'headers';
    }
    return '';
  } catch {
    return 'headers';
  }
};

const modelsError = (value: string) => {
  if (!value) return '';
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return 'models';
    for (const row of parsed) {
      if (!row || typeof row !== 'object' || Array.isArray(row)) return 'models';
      const record = row as Record<string, unknown>;
      const name = typeof record.name === 'string' ? record.name.trim() : '';
      const alias = typeof record.alias === 'string' ? record.alias.trim() : '';
      if (!name && alias) return 'model_name';
    }
    return '';
  } catch {
    return 'models';
  }
};

const modelNames = (value: string): Set<string> | null => {
  if (!value) return new Set();
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) return null;
  const names = new Set<string>();
  const add = (item: unknown) => {
    const name = typeof item === 'string' ? item.trim().toLowerCase() : '';
    if (name) names.add(name);
  };
  for (const row of parsed) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) continue;
    const record = row as Record<string, unknown>;
    add(record.name);
    if (Array.isArray(record.fallback)) record.fallback.forEach(add);
  }
  return names;
};

const freeModelsError = (
  value: string,
  modelsValue: string
): { key: string; names?: string } | null => {
  if (!value) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return { key: 'free_models' };
  }
  if (!Array.isArray(parsed)) return { key: 'free_models' };
  const names: string[] = [];
  for (const item of parsed) {
    const name = typeof item === 'string' ? item.trim() : '';
    if (!name) return { key: 'free_models' };
    names.push(name);
  }
  const known = modelNames(modelsValue);
  if (!known) return null;
  const unknown: string[] = [];
  const seen = new Set<string>();
  for (const name of names) {
    const key = name.toLowerCase();
    if (known.has(key) || seen.has(key)) continue;
    seen.add(key);
    unknown.push(name);
  }
  if (unknown.length > 0) return { key: 'free_models_unknown', names: unknown.join(', ') };
  return null;
};

export function validateChRelayVipPro(
  values: Record<string, PluginDraftValue>,
  t: Translate
): Record<string, string> {
  const errors: Record<string, string> = {};
  const set = (field: string, key: string) => {
    if (key) errors[field] = t(`plugin_management.ch_relay_vippro.errors.${key}`);
  };

  set('base-url', baseURLError(textOf(values, 'base-url')));
  set('fallback-base-url', fallbackBaseURLError(textOf(values, 'fallback-base-url')));
  const prefix = textOf(values, 'prefix').replace(/^\/+|\/+$/g, '');
  if (prefix.includes('/')) set('prefix', 'prefix');
  set('headers', headersError(textOf(values, 'headers')));
  set('request-retry', integerError(textOf(values, 'request-retry'), 0, 32, 'request_retry'));
  set('fallback-retry', integerError(textOf(values, 'fallback-retry'), 0, 3, 'fallback_retry'));
  set('sticky-seconds', integerError(textOf(values, 'sticky-seconds'), 0, 86400, 'sticky_seconds'));
  set(
    'model-cooldown-minutes',
    integerError(textOf(values, 'model-cooldown-minutes'), 0, 10080, 'model_cooldown')
  );
  if (textOf(values, 'stats-file').includes('\u0000')) set('stats-file', 'stats_file');

  const rotation = textOf(values, 'rotation-mode').toLowerCase();
  if (rotation && !ROTATION_MODES.includes(rotation)) set('rotation-mode', 'rotation');
  const plus = textOf(values, 'plus-preference').toLowerCase();
  if (plus && !PLUS_PREFERENCES.includes(plus)) set('plus-preference', 'plus');
  set('models', modelsError(textOf(values, 'models')));
  const freeModels = freeModelsError(textOf(values, 'free-models'), textOf(values, 'models'));
  if (freeModels) {
    errors['free-models'] = t(
      `plugin_management.ch_relay_vippro.errors.${freeModels.key}`,
      freeModels.names === undefined ? undefined : { names: freeModels.names }
    );
  }
  return errors;
}

export function applyChRelayVipProErrors<T extends { values: Record<string, PluginDraftValue>; errors: Record<string, string> }>(
  draft: T,
  t: Translate
): T {
  const fieldErrors = validateChRelayVipPro(draft.values, t);
  const errors = { ...draft.errors };
  for (const name of FIELD_NAMES) {
    errors[name] = fieldErrors[name] || '';
  }
  return { ...draft, errors };
}
