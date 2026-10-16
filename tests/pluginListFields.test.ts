import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { apiClient } from '@/services/api/client';
import { pluginsApi } from '@/services/api/plugins';

const spies: Array<{ mockRestore(): void }> = [];
afterEach(() => spies.splice(0).forEach((spy) => spy.mockRestore()));

const goFields = [
  { Name: 'enabled', Type: 'boolean', Description: 'Toggle' },
  { Name: 'base-url', Type: 'string', Description: 'HTTPS base' },
  { Name: 'prefix', Type: 'string' },
  { Name: 'headers', Type: 'object' },
  { Name: 'request-retry', Type: 'integer' },
  {
    Name: 'rotation-mode',
    Type: 'enum',
    EnumValues: ['round-robin', 'fill-first', 'least-recent', 'sticky'],
  },
  { Name: 'plus-preference', Type: 'enum', EnumValues: ['off', 'prefer', 'only'] },
  { Name: 'sticky-seconds', Type: 'integer' },
  { Name: 'stats-file', Type: 'string' },
  { Name: 'models', Type: 'array', Description: 'Custom models' },
];

describe('plugin list config fields', () => {
  test('keeps Go Metadata field names when the list omits snake_case config_fields', async () => {
    spies.push(
      spyOn(apiClient, 'get').mockResolvedValue({
        plugins_enabled: true,
        plugins: [
          {
            id: 'ch-relay-vippro',
            config_fields: [],
            metadata: { Name: 'ch-relay-vippro', ConfigFields: goFields },
          },
        ],
      } as never)
    );

    const listed = await pluginsApi.list();
    const plugin = listed.plugins[0];
    expect(plugin?.configFields.map((field) => field.name)).toEqual([
      'enabled',
      'base-url',
      'prefix',
      'headers',
      'request-retry',
      'rotation-mode',
      'plus-preference',
      'sticky-seconds',
      'stats-file',
      'models',
    ]);
    expect(plugin?.configFields.find((field) => field.name === 'rotation-mode')).toMatchObject({
      type: 'enum',
      enumValues: ['round-robin', 'fill-first', 'least-recent', 'sticky'],
    });
    expect(plugin?.configFields.find((field) => field.name === 'models')?.type).toBe('array');
    expect(plugin?.metadata?.name).toBe('ch-relay-vippro');
  });

  test('still reads snake_case config_fields', async () => {
    spies.push(
      spyOn(apiClient, 'get').mockResolvedValue({
        plugins: [
          {
            id: 'sample',
            config_fields: [
              { name: 'mode', type: 'enum', enum_values: ['safe'], description: 'Mode' },
            ],
          },
        ],
      } as never)
    );

    const listed = await pluginsApi.list();
    expect(listed.plugins[0]?.configFields).toEqual([
      { name: 'mode', type: 'enum', enumValues: ['safe'], description: 'Mode' },
    ]);
  });

  test('models stay on the shared custom-model editor', () => {
    const sheet = readFileSync(
      new URL('../src/features/plugins/PluginConfigSheet.tsx', import.meta.url),
      'utf8'
    );
    const modelsAt = sheet.indexOf("field.name === 'models'");
    const rawArrayAt = sheet.indexOf("fieldType === 'array' || fieldType === 'object'");
    expect(modelsAt).toBeGreaterThan(0);
    expect(rawArrayAt).toBeGreaterThan(modelsAt);
    expect(sheet).toContain('<PluginModelsEditor');
    expect(sheet).toContain('plugin.configFields.map');
  });
});
