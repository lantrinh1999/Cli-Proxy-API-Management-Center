import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { collectPluginResourceEntries } from '../src/features/plugins/pluginResources';
import {
  buildVipProChart,
  maskVipProEmail,
  parseVipProStats,
  summarizeVipProChart,
  vipProAccountCheckUrl,
  vipProStatsUrl,
} from '../src/features/plugins/vipProStats';
import type { PluginListEntry, PluginMenu } from '../src/types';

const readSource = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

const hour = (day: number, clockHour: number) => new Date(2026, 9, day, clockHour, 0, 0, 0).getTime();

const bucket = (day: number, clockHour: number, requests: number, tokens: number) => ({
  start: new Date(hour(day, clockHour)).toISOString(),
  requests,
  total_tokens: tokens,
});

describe('vippro stats windows', () => {
  const now = new Date(2026, 9, 9, 15, 40, 0, 0).getTime();
  const buckets = [
    bucket(9, 15, 2, 20),
    bucket(9, 15, 7, 7),
    bucket(9, 14, 1, 5),
    bucket(8, 15, 9, 90),
    bucket(2, 8, 4, 40),
    { start: 'not-a-time', requests: 100, total_tokens: 100 },
  ];

  test('hour shows each hourly bucket and day sums those 24 hours', () => {
    const hours = buildVipProChart(buckets, 'hour', now);
    expect(hours).toHaveLength(24);
    expect(hours.find((point) => point.start === hour(9, 15))).toMatchObject({
      requests: 9,
      tokens: 27,
    });
    expect(hours.find((point) => point.start === hour(9, 14))).toMatchObject({
      requests: 1,
      tokens: 5,
    });
    expect(hours.some((point) => point.start === hour(8, 15))).toBe(false);
    expect(hours[0]?.start).toBe(hour(8, 16));
    expect(summarizeVipProChart(hours)).toEqual({ requests: 10, tokens: 32 });

    const day = buildVipProChart(buckets, 'day', now);
    expect(day).toHaveLength(1);
    expect(summarizeVipProChart(day)).toEqual({ requests: 10, tokens: 32 });
  });

  test('week sums 7 days and month sums 30 days', () => {
    const week = buildVipProChart(buckets, 'week', now);
    const month = buildVipProChart(buckets, 'month', now);
    expect(week).toHaveLength(7);
    expect(month).toHaveLength(30);
    expect(summarizeVipProChart(week)).toEqual({ requests: 19, tokens: 122 });
    expect(summarizeVipProChart(month)).toEqual({ requests: 23, tokens: 162 });
    expect(week[0]?.start).toBe(new Date(2026, 9, 3).getTime());
    expect(month[0]?.start).toBe(new Date(2026, 8, 10).getTime());
  });

  test('stats payload keeps the account snapshot without requiring a scan', () => {
    expect(vipProStatsUrl('http://router:8317/')).toBe(
      'http://router:8317/v0/management/ch-relay-vippro/stats'
    );
    expect(vipProAccountCheckUrl('http://router:8317')).toBe(
      'http://router:8317/v0/management/ch-relay-vippro/accounts/check'
    );
    expect(vipProStatsUrl('http://router:8317')).not.toContain('/v8/management');
    expect(vipProStatsUrl('http://router:8317')).not.toContain('/v0/resource/');

    const idle = parseVipProStats({ requests: 3, buckets: [] });
    expect(idle.accounts).toBeNull();
    expect(idle.requests).toBe(3);
    expect(idle.usage_by_email).toEqual([]);

    const ranked = parseVipProStats({
      usage_by_email: [
        { email: 'small@gmail.com', success: 1, failed: 0, total_tokens: 10 },
        { email: 'busy@gmail.com', success: 1000, failed: 10, total_tokens: 50 },
      ],
    });
    expect(ranked.usage_by_email.map((row) => row.email)).toEqual([
      'busy@gmail.com',
      'small@gmail.com',
    ]);
    expect(maskVipProEmail('asd@gmail.com')).toBe('asd***@****.com');
    expect(maskVipProEmail('ab@icloud.com')).toBe('ab***@****.com');
    expect(maskVipProEmail('longer.name@mail.example.co.uk')).toBe('lon***@****.uk');

    const running = parseVipProStats({
      accounts: {
        running: true,
        checked: 2,
        total: 8,
        eligible: 6,
        plus: 1,
        cooling: 1,
        unavailable: 0,
        disabled_skipped: 3,
        checked_at: '2026-10-09T08:00:00Z',
        duration_ms: 12,
      },
    });
    expect(running.accounts).toMatchObject({
      running: true,
      checked: 2,
      total: 8,
      eligible: 6,
      disabled_skipped: 3,
    });
  });
});

describe('vippro dashboard route', () => {
  const menu = (path: string): PluginMenu => ({ path, menu: 'Status', description: '' });
  const plugin = (effectiveEnabled: boolean, menus: PluginMenu[]): PluginListEntry => ({
    id: 'ch-relay-vippro',
    path: 'plugins/ch-relay-vippro.so',
    configured: true,
    registered: true,
    enabled: effectiveEnabled,
    effectiveEnabled,
    supportsOAuth: false,
    logo: '',
    configFields: [],
    menus,
    metadata: null,
  });

  test('sidebar opens the plugin page instead of a custom route', () => {
    const entries = collectPluginResourceEntries([
      plugin(true, [menu('/v0/resource/plugins/ch-relay-vippro/dashboard')]),
    ]);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.route).toBe('/plugins/ch-relay-vippro');
    expect(entries[0]?.menu.path).toBe('/v0/resource/plugins/ch-relay-vippro/dashboard');
    expect(collectPluginResourceEntries([plugin(false, [menu('/plugins/ch-relay-vippro')])])).toEqual(
      []
    );

    const routes = readSource('../src/router/MainRoutes.tsx');
    expect(routes).not.toContain('VipProPage');
    expect(routes).toContain("path: '/plugins/:pluginId'");
    expect(routes).toContain('PluginResourcePage');
    expect(routes).not.toContain('ch-relay-vippro/status');

    const pluginsPage = readSource('../src/features/plugins/PluginsPage.tsx');
    expect(pluginsPage).toContain('PluginConfigSheet');
    expect(pluginsPage).not.toContain('buildPluginConfigPatch');
  });
});
