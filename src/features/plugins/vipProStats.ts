export const VIPPRO_PLUGIN_ID = 'ch-relay-vippro';

export type VipProRange = 'hour' | 'day' | 'week' | 'month';

export const VIPPRO_RANGES: VipProRange[] = ['hour', 'day', 'week', 'month'];

export interface VipProAccountSnapshot {
  running: boolean;
  checked: number;
  total: number;
  eligible: number;
  plus: number;
  cooling: number;
  unavailable: number;
  disabled_skipped: number;
  checked_at: string;
  duration_ms: number;
}

export interface VipProUsageBucket {
  start: unknown;
  requests?: unknown;
  total_tokens?: unknown;
}

export interface VipProEmailUsage {
  email: string;
  success: number;
  failed: number;
  total_tokens: number;
}

export interface VipProStats {
  requests: number;
  success: number;
  failed: number;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  since: string;
  buckets: VipProUsageBucket[];
  usage_by_email: VipProEmailUsage[];
  accounts: VipProAccountSnapshot | null;
}

export interface VipProChartPoint {
  start: number;
  requests: number;
  tokens: number;
}

const num = (value: unknown) => {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

export function vipProStatsUrl(origin: string) {
  return `${origin.replace(/\/+$/, '')}/v0/management/${VIPPRO_PLUGIN_ID}/stats`;
}

export function vipProAccountCheckUrl(origin: string) {
  return `${origin.replace(/\/+$/, '')}/v0/management/${VIPPRO_PLUGIN_ID}/accounts/check`;
}

function parseAccounts(value: unknown): VipProAccountSnapshot | null {
  if (!isRecord(value)) return null;
  return {
    running: value.running === true,
    checked: num(value.checked),
    total: num(value.total),
    eligible: num(value.eligible),
    plus: num(value.plus),
    cooling: num(value.cooling),
    unavailable: num(value.unavailable),
    disabled_skipped: num(value.disabled_skipped),
    checked_at: typeof value.checked_at === 'string' ? value.checked_at : '',
    duration_ms: num(value.duration_ms),
  };
}

export function parseVipProStats(value: unknown): VipProStats {
  const raw = isRecord(value) ? value : {};
  const usageByEmail: VipProEmailUsage[] = Array.isArray(raw.usage_by_email)
    ? raw.usage_by_email.filter(isRecord).map((row) => ({
        email: typeof row.email === 'string' ? row.email.trim() : '',
        success: num(row.success),
        failed: num(row.failed),
        total_tokens: num(row.total_tokens),
      }))
    : [];
  usageByEmail.sort((left, right) => {
    const requests = right.success + right.failed - (left.success + left.failed);
    if (requests !== 0) return requests;
    return right.total_tokens - left.total_tokens;
  });
  const buckets: VipProUsageBucket[] = Array.isArray(raw.buckets)
    ? raw.buckets.filter(isRecord).map((bucket) => ({
        start: bucket.start,
        requests: bucket.requests,
        total_tokens: bucket.total_tokens,
      }))
    : [];
  return {
    requests: num(raw.requests),
    success: num(raw.success),
    failed: num(raw.failed),
    input_tokens: num(raw.input_tokens),
    output_tokens: num(raw.output_tokens),
    total_tokens: num(raw.total_tokens),
    since: typeof raw.since === 'string' ? raw.since : '',
    buckets,
    usage_by_email: usageByEmail,
    accounts: parseAccounts(raw.accounts),
  };
}

export async function fetchVipProStats(origin: string, managementKey: string): Promise<VipProStats> {
  const response = await fetch(vipProStatsUrl(origin), {
    headers: { Authorization: `Bearer ${managementKey}` },
  });
  if (!response.ok) {
    throw new Error(`Stats request failed (${response.status})`);
  }
  return parseVipProStats(await response.json());
}

export async function startVipProAccountCheck(origin: string, managementKey: string): Promise<void> {
  const response = await fetch(vipProAccountCheckUrl(origin), {
    method: 'POST',
    headers: { Authorization: `Bearer ${managementKey}` },
  });
  if (!response.ok) {
    throw new Error(`Account check failed (${response.status})`);
  }
}

export function parseBucketStart(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value < 1e12 ? value * 1000 : value;
  }
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (!text) return null;
  if (/^-?\d+(\.\d+)?$/.test(text)) {
    const numeric = Number(text);
    return numeric < 1e12 ? numeric * 1000 : numeric;
  }
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? parsed : null;
}

function hourStart(ms: number) {
  const date = new Date(ms);
  date.setMinutes(0, 0, 0);
  return date.getTime();
}

function dayStart(ms: number) {
  const date = new Date(ms);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function addHours(ms: number, hours: number) {
  const date = new Date(ms);
  date.setHours(date.getHours() + hours);
  return date.getTime();
}

function addDays(ms: number, days: number) {
  const date = new Date(ms);
  date.setDate(date.getDate() + days);
  return date.getTime();
}

interface HourTotals {
  requests: number;
  tokens: number;
}

function indexHours(buckets: VipProUsageBucket[]) {
  const hours = new Map<number, HourTotals>();
  buckets.forEach((bucket) => {
    const start = parseBucketStart(bucket.start);
    if (start === null) return;
    const hour = hourStart(start);
    const current = hours.get(hour) ?? { requests: 0, tokens: 0 };
    current.requests += num(bucket.requests);
    current.tokens += num(bucket.total_tokens);
    hours.set(hour, current);
  });
  return hours;
}

function sumBetween(hours: Map<number, HourTotals>, from: number, until: number): HourTotals {
  let requests = 0;
  let tokens = 0;
  hours.forEach((totals, hour) => {
    if (hour >= from && hour < until) {
      requests += totals.requests;
      tokens += totals.tokens;
    }
  });
  return { requests, tokens };
}

/**
 * Hour: one bar per hour for the last 24 hours.
 * Day: one bar, the sum of those 24 hours.
 * Week / month: one bar per local day, 7 or 30 days ending today.
 */
export function buildVipProChart(
  buckets: VipProUsageBucket[],
  range: VipProRange,
  now: number
): VipProChartPoint[] {
  const hours = indexHours(buckets);
  const endHour = hourStart(now);
  const windowStart = addHours(endHour, -23);

  if (range === 'hour') {
    return Array.from({ length: 24 }, (_, index) => {
      const start = addHours(windowStart, index);
      const totals = hours.get(start) ?? { requests: 0, tokens: 0 };
      return { start, requests: totals.requests, tokens: totals.tokens };
    });
  }

  if (range === 'day') {
    const totals = sumBetween(hours, windowStart, addHours(endHour, 1));
    return [{ start: windowStart, requests: totals.requests, tokens: totals.tokens }];
  }

  const days = range === 'week' ? 7 : 30;
  const endDay = dayStart(now);
  const firstDay = addDays(endDay, -(days - 1));
  return Array.from({ length: days }, (_, index) => {
    const start = addDays(firstDay, index);
    const totals = sumBetween(hours, start, addDays(start, 1));
    return { start, requests: totals.requests, tokens: totals.tokens };
  });
}

export function summarizeVipProChart(points: VipProChartPoint[]) {
  return points.reduce(
    (sum, point) => ({
      requests: sum.requests + point.requests,
      tokens: sum.tokens + point.tokens,
    }),
    { requests: 0, tokens: 0 }
  );
}

export function maskVipProEmail(email: string) {
  const trimmed = email.trim();
  const at = trimmed.lastIndexOf('@');
  if (at <= 0 || at === trimmed.length - 1) return trimmed;
  const local = trimmed.slice(0, at).slice(0, 3);
  const domain = trimmed.slice(at + 1);
  const dot = domain.lastIndexOf('.');
  const suffix = dot >= 0 ? domain.slice(dot) : '';
  return `${local}***@****${suffix}`;
}

export function formatVipProCheckedAt(value: string) {
  const text = value.trim();
  if (!text) return '—';
  const parsed = Date.parse(text);
  if (!Number.isFinite(parsed)) return text;
  return new Date(parsed).toLocaleString();
}
