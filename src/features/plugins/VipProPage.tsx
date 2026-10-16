import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { Button } from '@/components/ui/Button';
import { IconSettings } from '@/components/ui/icons';
import dash from '@/features/dashboard/dashboard.module.scss';
import { PluginConfigSheet, type PluginConfigActivity } from '@/features/plugins/PluginConfigSheet';
import { pluginsApi } from '@/services/api';
import { useAuthStore, useNotificationStore } from '@/stores';
import { normalizeApiBase } from '@/utils/connection';
import { getErrorMessage } from '@/utils/helpers';
import type { PluginListEntry } from '@/types';
import { VipProUsageChart } from './VipProUsageChart';
import {
  VIPPRO_PLUGIN_ID,
  VIPPRO_RANGES,
  buildVipProChart,
  fetchVipProStats,
  formatVipProCheckedAt,
  maskVipProEmail,
  startVipProAccountCheck,
  type VipProRange,
  type VipProStats,
} from './vipProStats';
import styles from './VipProPage.module.scss';

const RANGES: Record<VipProRange, { label: string; hint: string }> = {
  hour: { label: 'Hour', hint: 'Each bar is one hour over the last 24 hours.' },
  day: { label: 'Day', hint: 'Sum of the last 24 hours.' },
  week: { label: 'Week', hint: 'One bar per day for the last 7 days.' },
  month: { label: 'Month', hint: 'One bar per day for the last 30 days.' },
};

const count = (value: number | undefined) => (value ?? 0).toLocaleString();

async function copyFullEmail(email: string) {
  if (navigator.clipboard && window.isSecureContext) {
    await navigator.clipboard.writeText(email);
    return true;
  }
  const area = document.createElement('textarea');
  area.value = email;
  area.setAttribute('readonly', '');
  area.style.position = 'fixed';
  area.style.left = '-9999px';
  document.body.appendChild(area);
  area.select();
  const copied = document.execCommand('copy');
  area.remove();
  return copied;
}

function EmailCell({ email }: { email: string }) {
  const [copied, setCopied] = useState(false);
  if (!email) return <>—</>;
  return (
    <span className={styles.emailCell}>
      <span>{maskVipProEmail(email)}</span>
      <button
        type="button"
        className={styles.copyButton}
        onClick={() => {
          void copyFullEmail(email).then((ok) => {
            if (!ok) return;
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1200);
          });
        }}
      >
        {copied ? 'Copied' : 'Copy'}
      </button>
    </span>
  );
}

export function VipProPage() {
  const apiBase = useAuthStore((state) => state.apiBase);
  const managementKey = useAuthStore((state) => state.managementKey);
  const showNotification = useNotificationStore((state) => state.showNotification);
  const [stats, setStats] = useState<VipProStats | null>(null);
  const [statsError, setStatsError] = useState('');
  const [range, setRange] = useState<VipProRange>('hour');
  const [checking, setChecking] = useState(false);
  const [openingSettings, setOpeningSettings] = useState(false);
  const [sheetPlugin, setSheetPlugin] = useState<PluginListEntry | null>(null);
  const [configActivity, setConfigActivity] = useState<PluginConfigActivity | null>(null);

  const origin = normalizeApiBase(apiBase);

  useEffect(() => {
    if (!origin || !managementKey) return;
    let cancelled = false;
    const load = async () => {
      try {
        const next = await fetchVipProStats(origin, managementKey);
        if (!cancelled) {
          setStats(next);
          setStatsError('');
        }
      } catch (err: unknown) {
        if (!cancelled) setStatsError(getErrorMessage(err, 'Failed to load stats'));
      }
    };
    void load();
    const timer = window.setInterval(() => void load(), 5000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [origin, managementKey]);

  const [chartNow, setChartNow] = useState(0);
  useEffect(() => {
    setChartNow(Date.now());
  }, [stats, range]);
  const points = useMemo(
    () => buildVipProChart(stats?.buckets ?? [], range, chartNow),
    [stats, range, chartNow]
  );

  const checkAccounts = async () => {
    if (!origin || !managementKey) {
      setStatsError('Connect to CPA before checking accounts');
      return;
    }
    setChecking(true);
    try {
      await startVipProAccountCheck(origin, managementKey);
      const next = await fetchVipProStats(origin, managementKey);
      setStats(next);
      setStatsError('');
    } catch (err: unknown) {
      setStatsError(getErrorMessage(err, 'Failed to start account check'));
    } finally {
      setChecking(false);
    }
  };

  const openSettings = async () => {
    if (sheetPlugin || openingSettings) return;
    setOpeningSettings(true);
    try {
      const listed = await pluginsApi.list();
      const found = listed.plugins.find((item) => item.id === VIPPRO_PLUGIN_ID);
      if (!found) {
        showNotification('ch-relay-vippro is not installed', 'error');
        return;
      }
      setSheetPlugin(found);
    } catch (err: unknown) {
      showNotification(getErrorMessage(err, 'Failed to open settings'), 'error');
    } finally {
      setOpeningSettings(false);
    }
  };

  const accounts = stats?.accounts ?? null;
  const accountCount = (value: number) => (accounts ? value.toLocaleString() : '—');
  const totals = [
    { key: 'requests', label: 'Requests', value: count(stats?.requests), accent: 'var(--text-quaternary)' },
    { key: 'success', label: 'Success', value: count(stats?.success), accent: 'var(--viz-success)' },
    { key: 'failed', label: 'Failed', value: count(stats?.failed), accent: 'var(--viz-failure)' },
    { key: 'input', label: 'Input tokens', value: count(stats?.input_tokens), accent: 'var(--primary-color)' },
    { key: 'output', label: 'Output tokens', value: count(stats?.output_tokens), accent: 'var(--primary-color)' },
    { key: 'total', label: 'Total tokens', value: count(stats?.total_tokens), accent: 'var(--primary-color)' },
  ];
  const accountTiles = [
    { key: 'eligible', label: 'Eligible', value: accountCount(accounts?.eligible ?? 0) },
    { key: 'plus', label: 'Plus', value: accountCount(accounts?.plus ?? 0) },
    { key: 'cooling', label: 'Cooling', value: accountCount(accounts?.cooling ?? 0) },
    { key: 'unavailable', label: 'Unavailable', value: accountCount(accounts?.unavailable ?? 0) },
    { key: 'skipped', label: 'Disabled skipped', value: accountCount(accounts?.disabled_skipped ?? 0) },
    {
      key: 'checked',
      label: 'Checked at',
      value: accounts ? formatVipProCheckedAt(accounts.checked_at) : '—',
      time: true,
    },
  ];

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <span className={dash.eyebrow}>{VIPPRO_PLUGIN_ID}</span>
          <h1 className={dash.sectionTitle}>Dashboard</h1>
          <p className={dash.sectionDescription}>
            Requests and tokens stay on this page. Account checks run in the background.
            {stats?.since ? ` Counting since ${formatVipProCheckedAt(stats.since)}.` : ''}
          </p>
        </div>
        <div className={styles.actions}>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void openSettings()}
            loading={openingSettings || configActivity === 'loading'}
          >
            <IconSettings size={14} />
            Settings
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void checkAccounts()}
            loading={checking}
            disabled={!origin || !managementKey}
          >
            Check accounts
          </Button>
        </div>
      </header>

      {statsError ? <div className={styles.error}>{statsError}</div> : null}
      {!origin || !managementKey ? (
        <p className={styles.hint}>Connect to CPA to load stats.</p>
      ) : null}

      <section className={styles.stats} aria-label="Request totals">
        {totals.map((tile) => (
          <article
            key={tile.key}
            className={dash.statTile}
            style={{ '--tile-accent': tile.accent } as CSSProperties}
          >
            <span className={dash.statLabel}>{tile.label}</span>
            <strong className={dash.statValue}>{tile.value}</strong>
          </article>
        ))}
      </section>

      <section className={dash.section}>
        <header>
          <span className={dash.eyebrow}>Accounts</span>
          <h2 className={dash.sectionTitle}>Email usage</h2>
          <p className={dash.sectionDescription}>
            Success is green. Errors are red. The busiest email is first.
          </p>
        </header>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Email</th>
                <th>Request</th>
                <th>Token</th>
              </tr>
            </thead>
            <tbody>
              {(stats?.usage_by_email ?? []).length === 0 ? (
                <tr>
                  <td colSpan={3} className={styles.empty}>
                    No requests yet.
                  </td>
                </tr>
              ) : (
                stats?.usage_by_email.map((row) => (
                  <tr key={row.email || 'unknown'}>
                    <td>
                      <EmailCell email={row.email} />
                    </td>
                    <td>
                      <span className={styles.successCount}>{count(row.success)}</span>
                      <span className={styles.requestSplit}>/</span>
                      <span className={styles.failedCount}>{count(row.failed)}</span>
                    </td>
                    <td>{count(row.total_tokens)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className={dash.section}>
        <header className={styles.chartHead}>
          <div>
            <span className={dash.eyebrow}>Traffic</span>
            <h2 className={dash.sectionTitle}>Requests and tokens</h2>
            <p className={dash.sectionDescription}>{RANGES[range].hint}</p>
          </div>
          <div className={styles.range} role="group" aria-label="Chart range">
            {VIPPRO_RANGES.map((item) => (
              <button
                key={item}
                type="button"
                className={`${styles.rangeButton} ${range === item ? styles.rangeButtonActive : ''}`}
                aria-pressed={range === item}
                onClick={() => setRange(item)}
              >
                {RANGES[item].label}
              </button>
            ))}
          </div>
        </header>
        <div className={dash.panel}>
          <VipProUsageChart range={range} points={points} />
        </div>
      </section>

      <section className={dash.section}>
        <header>
          <span className={dash.eyebrow}>Accounts</span>
          <h2 className={dash.sectionTitle}>Last check</h2>
          {accounts?.running ? (
            <p className={styles.progress}>
              Checking {accounts.checked.toLocaleString()} / {accounts.total.toLocaleString()}
            </p>
          ) : (
            <p className={dash.sectionDescription}>
              The latest snapshot. A new check does not block this page.
            </p>
          )}
        </header>
        <section className={styles.stats} aria-label="Account snapshot">
          {accountTiles.map((tile) => (
            <article key={tile.key} className={dash.statTile}>
              <span className={dash.statLabel}>{tile.label}</span>
              <strong className={tile.time ? styles.timeValue : dash.statValue}>{tile.value}</strong>
            </article>
          ))}
        </section>
      </section>

      <PluginConfigSheet
        plugin={sheetPlugin}
        onClose={() => setSheetPlugin(null)}
        onActivityChange={setConfigActivity}
      />
    </div>
  );
}
