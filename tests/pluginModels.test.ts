import { describe, expect, test } from 'bun:test';
import {
  applyPluginModelsValue,
  initialPluginModelsSync,
  parsePluginModels,
  serializePluginModels,
} from '../src/features/plugins/pluginModels';

describe('plugin models', () => {
  test('reads OpenAI-compatible model objects and keeps alias optional', () => {
    const models = parsePluginModels([
      { name: 'gpt-5.4', alias: 'gpt-5.4', 'display-name': 'GPT-5.4', image: true },
      { name: 'gpt-5.6' },
    ]);

    expect(models[0]).toMatchObject({ name: 'gpt-5.4', alias: 'gpt-5.4', displayName: 'GPT-5.4', image: true });
    expect(models[1]).toMatchObject({ name: 'gpt-5.6', alias: '' });
  });

  test('writes named rows with kebab-case options and drops blank rows', () => {
    expect(
      serializePluginModels([
        { name: ' gpt-5.4 ', alias: ' fast ', displayName: 'GPT', image: true, forceMapping: true },
        { name: '   ', alias: '' },
      ])
    ).toEqual([
      {
        name: 'gpt-5.4',
        alias: 'fast',
        image: true,
        'display-name': 'GPT',
        'force-mapping': true,
      },
    ]);
  });

  test('reads and writes an optional fallback list', () => {
    const models = parsePluginModels([
      { name: 'primary-model', alias: 'primary-model', fallback: [' other-model ', ''] },
      { name: 'plain-model', fallback: [] },
    ]);

    expect(models[0]?.fallbackText).toBe('other-model');
    expect(models[1]?.fallbackText).toBe('');
    expect(
      serializePluginModels([
        { name: 'primary-model', alias: '', fallbackText: ' other-model, backup-model ' },
        { name: 'plain-model', alias: '', fallbackText: '  , ' },
      ])
    ).toEqual([
      { name: 'primary-model', fallback: ['other-model', 'backup-model'] },
      { name: 'plain-model' },
    ]);
  });

  test('replaces rows when the server value changes and the field is not dirty', () => {
    const mounted = initialPluginModelsSync('[]');
    const loaded = applyPluginModelsValue(
      mounted,
      '[\n  {\n    "name": "gpt-5.4"\n  }\n]'
    );

    expect(loaded.models[0]?.name).toBe('gpt-5.4');
    expect(loaded.dirty).toBe(false);

    const edited = {
      ...loaded,
      dirty: true,
      models: [{ name: 'draft', alias: '' }],
    };
    const kept = applyPluginModelsValue(edited, '[{"name":"gpt-5.6"}]');
    expect(kept.models[0]?.name).toBe('draft');
    expect(kept.seenValue).toBe('[{"name":"gpt-5.6"}]');

    const reset = applyPluginModelsValue(
      { ...edited, dirty: false, seenValue: loaded.seenValue },
      '[{"name":"gpt-5.6"}]'
    );
    expect(reset.models[0]?.name).toBe('gpt-5.6');
  });
});
