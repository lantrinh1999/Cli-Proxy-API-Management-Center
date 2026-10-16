import { buildModelOptions, readModelOptions } from '@/features/providers/modelOptions';
import type { ModelEntryInput } from '@/features/providers/types';
import type { ModelAlias } from '@/types';
import { isRecord } from '@/utils/helpers';

const text = (value: unknown) => (typeof value === 'string' ? value : '');

const numberValue = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

const stringList = (value: unknown) =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : undefined;

const fallbackText = (value: unknown) =>
  (stringList(value) ?? [])
    .map((item) => item.trim())
    .filter(Boolean)
    .join(', ');

const fallbackNames = (value: string | undefined) => {
  const names = (value ?? '')
    .split(/[,\n]+/)
    .map((item) => item.trim())
    .filter(Boolean);
  return names.length ? names : undefined;
};

const readAlias = (raw: Record<string, unknown>): ModelAlias => {
  const thinking = isRecord(raw.thinking) ? raw.thinking : undefined;
  return {
    name: text(raw.name),
    alias: text(raw.alias),
    displayName: text(raw['display-name'] || raw.displayName),
    maxContextLength: numberValue(raw['max-context-length'] ?? raw.maxContextLength),
    forceMapping: raw['force-mapping'] === true || raw.forceMapping === true,
    image: raw.image === true,
    isCompat: raw['is-compat'] === true || raw.isCompat === true,
    useMaxCompletionTokens:
      raw['use-max-completion-tokens'] === true || raw.useMaxCompletionTokens === true,
    inputModalities: stringList(raw['input-modalities'] ?? raw.inputModalities),
    outputModalities: stringList(raw['output-modalities'] ?? raw.outputModalities),
    thinking,
  };
};

export function parsePluginModels(value: unknown): ModelEntryInput[] {
  const raw = typeof value === 'string' ? value.trim() : value;
  let parsed: unknown = raw;
  if (typeof raw === 'string') {
    if (!raw) return [];
    parsed = JSON.parse(raw);
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.filter(isRecord).map((item) => {
    const alias = readAlias(item);
    return {
      ...readModelOptions(alias),
      name: alias.name,
      alias: alias.alias ?? '',
      image: alias.image === true,
      fallbackText: fallbackText(item.fallback),
      thinkingJson: alias.thinking ? JSON.stringify(alias.thinking) : undefined,
    };
  });
}

const emptyModel = (): ModelEntryInput => ({ name: '', alias: '' });

export function modelsForEditorValue(value: string): ModelEntryInput[] {
  try {
    const parsed = parsePluginModels(value);
    return parsed.length ? parsed : [emptyModel()];
  } catch {
    return [emptyModel()];
  }
}

export interface PluginModelsSyncState {
  models: ModelEntryInput[];
  dirty: boolean;
  seenValue: string;
}

export function initialPluginModelsSync(value: string): PluginModelsSyncState {
  return { models: modelsForEditorValue(value), dirty: false, seenValue: value };
}

// Server refreshes replace the rows only while the user has not edited them.
export function applyPluginModelsValue(
  state: PluginModelsSyncState,
  value: string
): PluginModelsSyncState {
  if (value === state.seenValue) return state;
  if (state.dirty) return { ...state, seenValue: value };
  return { ...state, seenValue: value, models: modelsForEditorValue(value) };
}

export function serializePluginModels(entries: ModelEntryInput[]): Array<Record<string, unknown>> {
  return entries
    .filter((entry) => entry.name.trim())
    .map((entry) => {
      const options = buildModelOptions(entry);
      const model: Record<string, unknown> = { name: entry.name.trim() };
      const alias = entry.alias?.trim();
      if (alias) model.alias = alias;
      if (entry.image === true) model.image = true;
      if (options.displayName) model['display-name'] = options.displayName;
      if (options.maxContextLength !== undefined) model['max-context-length'] = options.maxContextLength;
      if (options.forceMapping) model['force-mapping'] = true;
      if (options.isCompat) model['is-compat'] = true;
      if (options.useMaxCompletionTokens) model['use-max-completion-tokens'] = true;
      if (options.inputModalities?.length) model['input-modalities'] = options.inputModalities;
      if (options.outputModalities?.length) model['output-modalities'] = options.outputModalities;
      if (options.thinking && Object.keys(options.thinking).length > 0) model.thinking = options.thinking;
      const fallback = fallbackNames(entry.fallbackText);
      if (fallback) model.fallback = fallback;
      return model;
    });
}
