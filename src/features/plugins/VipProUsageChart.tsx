import { useMemo, useState } from 'react';
import { axisMax } from '@/features/dashboard/utils';
import chartStyles from '@/features/dashboard/components/ThroughputChart.module.scss';
import {
  summarizeVipProChart,
  type VipProChartPoint,
  type VipProRange,
} from './vipProStats';
import styles from './VipProUsageChart.module.scss';

const TICK_COUNT = 5;

interface SeriesChartProps {
  points: VipProChartPoint[];
  range: VipProRange;
  label: string;
  total: number;
  swatchClass: string;
  segmentClass: string;
  read: (point: VipProChartPoint) => number;
}

function pointLabel(start: number, range: VipProRange) {
  if (range === 'day') return '24h';
  const date = new Date(start);
  if (range === 'hour') {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function SeriesChart({
  points,
  range,
  label,
  total,
  swatchClass,
  segmentClass,
  read,
}: SeriesChartProps) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const values = useMemo(() => points.map(read), [points, read]);
  const peak = values.reduce((max, value) => Math.max(max, value), 0);
  const peakIndex = values.indexOf(peak);
  const scaleMax = useMemo(() => axisMax(peak, TICK_COUNT - 1), [peak]);
  const ticks = useMemo(
    () =>
      Array.from({ length: TICK_COUNT }, (_, index) => {
        const ratio = 1 - index / (TICK_COUNT - 1);
        return { ratio, value: Math.round(scaleMax * ratio) };
      }),
    [scaleMax]
  );
  const xAxisTicks = useMemo(() => {
    if (points.length === 0) return [];
    const positions = [0, Math.floor((points.length - 1) / 2), points.length - 1];
    return Array.from(new Set(positions)).map((index) => ({
      index,
      label: pointLabel(points[index].start, range),
    }));
  }, [points, range]);

  const activeValue = activeIndex === null ? null : values[activeIndex];

  return (
    <figure className={chartStyles.chart}>
      <figcaption className={chartStyles.legend}>
        <span className={chartStyles.legendItem}>
          <span className={`${chartStyles.legendSwatch} ${swatchClass}`} aria-hidden="true" />
          {label}
          <b className={chartStyles.legendValue}>{total.toLocaleString()}</b>
        </span>
      </figcaption>
      <div className={chartStyles.plot}>
        <div className={chartStyles.yAxis} aria-hidden="true">
          {ticks.map((tick) => (
            <span
              key={tick.ratio}
              className={chartStyles.yTick}
              style={{ top: `${(1 - tick.ratio) * 100}%` }}
            >
              {tick.value.toLocaleString()}
            </span>
          ))}
        </div>
        <div className={chartStyles.canvas}>
          <div className={chartStyles.gridlines} aria-hidden="true">
            {ticks.map((tick) => (
              <span
                key={tick.ratio}
                className={chartStyles.gridline}
                style={{ top: `${(1 - tick.ratio) * 100}%` }}
              />
            ))}
          </div>
          <div
            className={chartStyles.columns}
            role="img"
            aria-label={`${label} ${total.toLocaleString()}`}
            onMouseLeave={() => setActiveIndex(null)}
          >
            {points.map((point, index) => {
              const value = values[index];
              const height = (value / scaleMax) * 100;
              const barDelayMs =
                points.length > 1 ? Math.round((index / (points.length - 1)) * 360) : 0;
              return (
                <div
                  key={point.start}
                  className={`${chartStyles.column} ${
                    activeIndex === index ? chartStyles.columnActive : ''
                  }`}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => setActiveIndex((current) => (current === index ? null : index))}
                >
                  {index === peakIndex && peak > 0 ? (
                    <span
                      className={chartStyles.peakLabel}
                      style={{ bottom: `${Math.min(100, height)}%` }}
                    >
                      {peak.toLocaleString()}
                    </span>
                  ) : null}
                  <div
                    className={chartStyles.stack}
                    style={
                      {
                        '--bar-delay': `${barDelayMs}ms`,
                        maxWidth: points.length <= 3 ? '48px' : undefined,
                      } as React.CSSProperties
                    }
                  >
                    {value > 0 ? (
                      <span
                        className={`${chartStyles.segment} ${segmentClass}`}
                        style={{ height: `${height}%` }}
                      />
                    ) : (
                      <span className={chartStyles.idleTick} />
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          {total === 0 ? <p className={chartStyles.noRequests}>No {label.toLowerCase()}</p> : null}
          {activeValue !== null && activeIndex !== null ? (
            <div
              className={chartStyles.tooltip}
              style={{
                left: `${((activeIndex + 0.5) / points.length) * 100}%`,
                transform:
                  activeIndex < points.length * 0.15
                    ? 'translateX(-12%)'
                    : activeIndex > points.length * 0.85
                      ? 'translateX(-88%)'
                      : 'translateX(-50%)',
              }}
              role="status"
            >
              <span className={chartStyles.tooltipTime}>
                {pointLabel(points[activeIndex].start, range)}
              </span>
              <span className={chartStyles.tooltipRow}>
                <span className={`${chartStyles.legendSwatch} ${swatchClass}`} aria-hidden="true" />
                {label}
                <b>{activeValue.toLocaleString()}</b>
              </span>
            </div>
          ) : null}
        </div>
      </div>
      <div className={chartStyles.xAxis} aria-hidden="true">
        {xAxisTicks.map((tick) => (
          <span
            key={tick.index}
            className={chartStyles.xTick}
            style={{ left: `${((tick.index + 0.5) / points.length) * 100}%` }}
          >
            {tick.label}
          </span>
        ))}
      </div>
    </figure>
  );
}

interface VipProUsageChartProps {
  range: VipProRange;
  points: VipProChartPoint[];
}

export function VipProUsageChart({ range, points }: VipProUsageChartProps) {
  const summary = useMemo(() => summarizeVipProChart(points), [points]);
  return (
    <div className={styles.series}>
      <SeriesChart
        points={points}
        range={range}
        label="Requests"
        total={summary.requests}
        swatchClass={chartStyles.swatchSuccess}
        segmentClass={chartStyles.segmentSuccess}
        read={(point) => point.requests}
      />
      <SeriesChart
        points={points}
        range={range}
        label="Tokens"
        total={summary.tokens}
        swatchClass={styles.swatchTokens}
        segmentClass={styles.segmentTokens}
        read={(point) => point.tokens}
      />
    </div>
  );
}
