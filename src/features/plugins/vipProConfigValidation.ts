import type { PluginDraftValue } from './pluginConfigDraft';

type Translate = (key: string, options?: Record<string, unknown>) => string;

const ROTATION_MODES = ['round-robin', 'fill-first', 'least-recent', 'sticky'];
const PLUS_PREFERENCES = ['off', 'prefer', 'only', 'ignore'];
const FIELD_NAMES = [
  'base-url',
  'prefix',
  'headers',
  'request-retry',
  'fallback-retry',
  'sticky-seconds',
  'rotation-mode',
  'plus-preference',
  'models',
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
  return false;
};

const baseURLError = (value: string) => {
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

export function validateChRelayVipPro(
  values: Record<string, PluginDraftValue>,
  t: Translate
): Record<string, string> {
  const errors: Record<string, string> = {};
  const set = (field: string, key: string) => {
    if (key) errors[field] = t(`plugin_management.ch_relay_vippro.errors.${key}`);
  };

  set('base-url', baseURLError(textOf(values, 'base-url')));
  const prefix = textOf(values, 'prefix').replace(/^\/+|\/+$/g, '');
  if (prefix.includes('/')) set('prefix', 'prefix');
  set('headers', headersError(textOf(values, 'headers')));
  set('request-retry', integerError(textOf(values, 'request-retry'), 0, 32, 'request_retry'));
  set('fallback-retry', integerError(textOf(values, 'fallback-retry'), 0, 3, 'fallback_retry'));
  set('sticky-seconds', integerError(textOf(values, 'sticky-seconds'), 0, 86400, 'sticky_seconds'));

  const rotation = textOf(values, 'rotation-mode');
  if (rotation && !ROTATION_MODES.includes(rotation)) set('rotation-mode', 'rotation');
  const plus = textOf(values, 'plus-preference').toLowerCase();
  if (plus && !PLUS_PREFERENCES.includes(plus)) set('plus-preference', 'plus');
  set('models', modelsError(textOf(values, 'models')));
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
