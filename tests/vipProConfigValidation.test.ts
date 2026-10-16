import { describe, expect, test } from 'bun:test';
import { validateChRelayVipPro } from '../src/features/plugins/vipProConfigValidation';

const t = (key: string) => key;

describe('ch-relay-vippro config validation', () => {
  test('accepts the live private http settings', () => {
    expect(
      validateChRelayVipPro(
        {
          'base-url': 'http://192.168.8.1:11500/v1',
          prefix: 'vippro',
          'request-retry': '10',
          'fallback-retry': '3',
          'sticky-seconds': '600',
          'rotation-mode': 'sticky',
          'plus-preference': 'only',
          headers: '{}',
          models: '[{"name":"gpt-6-luna","fallback":["gpt-6-luna"]}]',
        },
        t
      )
    ).toEqual({});
  });

  test('reports every invalid field immediately', () => {
    const errors = validateChRelayVipPro(
      {
        'base-url': 'http://example.com/v1',
        prefix: 'a/b',
        headers: '{"Authorization":"secret"}',
        'request-retry': '33',
        'fallback-retry': '-1',
        'sticky-seconds': '90000',
        'rotation-mode': 'spin',
        'plus-preference': 'maybe',
        models: '[{"alias":"gpt"}]',
      },
      t
    );
    expect(errors['base-url']).toContain('base_url');
    expect(errors.prefix).toContain('prefix');
    expect(errors.headers).toContain('headers');
    expect(errors['request-retry']).toContain('request_retry');
    expect(errors['fallback-retry']).toContain('fallback_retry');
    expect(errors['sticky-seconds']).toContain('sticky_seconds');
    expect(errors['rotation-mode']).toContain('rotation');
    expect(errors['plus-preference']).toContain('plus');
    expect(errors.models).toContain('model_name');
  });
});
