import { apiClient } from './client';
import type { ModelMappingMode, ModelMappingRule } from '@/types/modelMapping';

type StatusError = { status?: number };

// Relative to apiClient base `/v8/management`. Do not prefix that path again.
const MODEL_MAPPING_ENDPOINT = '/routing/model-mapping';

const getStatusCode = (err: unknown): number | undefined => {
  if (!err || typeof err !== 'object') return undefined;
  if ('status' in err) return (err as StatusError).status;
  return undefined;
};

const inferMode = (match: string, mode?: string): ModelMappingMode => {
  const normalized = String(mode ?? '')
    .trim()
    .toLowerCase();
  if (normalized === 'exact' || normalized === 'wildcard' || normalized === 'regex') {
    return normalized;
  }
  return match.includes('*') ? 'wildcard' : 'exact';
};

const parseOptionalBoolean = (value: unknown, fallback: boolean): boolean => {
  if (typeof value === 'boolean') return value;
  return fallback;
};

export const normalizeModelMappingRules = (payload: unknown): ModelMappingRule[] => {
  if (!payload) return [];

  let source: unknown = payload;
  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    const record = payload as Record<string, unknown>;
    source = record['model-mapping'] ?? record.items ?? record.rules ?? [];
  }
  if (!Array.isArray(source)) return [];

  return source.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const entry = item as Record<string, unknown>;
    const match = String(entry.match ?? '').trim();
    const target = String(entry.target ?? '').trim();
    if (!match || !target) return [];
    return [
      {
        match,
        target,
        mode: inferMode(match, typeof entry.mode === 'string' ? entry.mode : ''),
        enabled: parseOptionalBoolean(entry.enabled, true),
        forceMapping: parseOptionalBoolean(entry['force-mapping'] ?? entry.forceMapping, true),
      },
    ];
  });
};

export const serializeModelMappingRules = (
  rules: ModelMappingRule[]
): Array<Record<string, unknown>> =>
  rules.map((rule) => ({
    match: rule.match,
    target: rule.target,
    mode: rule.mode,
    enabled: rule.enabled,
    'force-mapping': rule.forceMapping,
  }));

export const modelMappingApi = {
  list: async (): Promise<ModelMappingRule[]> => {
    const payload = await apiClient.get<unknown>(MODEL_MAPPING_ENDPOINT);
    return normalizeModelMappingRules(payload);
  },

  replace: async (rules: ModelMappingRule[]): Promise<void> => {
    await apiClient.put(MODEL_MAPPING_ENDPOINT, serializeModelMappingRules(rules));
  },
};

export const isModelMappingUnsupported = (err: unknown): boolean => getStatusCode(err) === 404;
