import { useMemo, useState } from 'react';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Cell,
} from 'recharts';
import { useI18n } from '../../i18n';
import { useTheme } from '../../context/ThemeContext';
import { useAppData } from '../../context/AppDataContext';
import { colorForValue } from '../../data/metrics';
import { fieldLabel } from '../../lib/fields';
import { dailyMeanSeries, histogram, meanByGroup } from '../../lib/stats';
import { formatDate } from '../../lib/format';
import { EmptyState, SectionHeading } from '../primitives';

function ChartCard({ title, subtitle, children }) {
  return (
    <div className="surface p-4">
      <SectionHeading as="h3" title={title} subtitle={subtitle} />
      <div className="h-64 w-full">{children}</div>
    </div>
  );
}

export default function ObservationCharts({ observation, measurements }) {
  const { t, locale } = useI18n();
  const { isDark } = useTheme();
  const { currentUser, getAuthor } = useAppData();
  // Charts use the primary field (the page shows an empty state when there is none).
  const scale = observation.scale;
  const m = scale;
  const [scopeChoice, setScope] = useState('all');
  // "My school" needs a school; real accounts have none (we do not collect it), so only 'all'.
  const mySchool = currentUser?.school ?? null;
  const scope = mySchool ? scopeChoice : 'all';

  const axis = isDark ? '#8a8f86' : '#5C6B60';
  const grid = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(31,58,46,0.10)';
  const lineColor = '#8B6F47';

  const scoped = useMemo(() => {
    if (scope === 'all') return measurements;
    return measurements.filter((x) => getAuthor(x.userId)?.school === mySchool);
  }, [measurements, scope, mySchool, getAuthor]);

  const series = useMemo(() => dailyMeanSeries(scoped), [scoped]);
  const bins = useMemo(() => histogram(scoped, m.histogramStep), [scoped, m.histogramStep]);
  const bySchool = useMemo(
    () => meanByGroup(measurements, (x) => getAuthor(x.userId)?.school ?? '—'),
    [measurements, getAuthor],
  );

  const tooltipStyle = {
    background: isDark ? '#232622' : '#FFFDF8',
    border: `1px solid ${isDark ? 'rgba(255,255,255,0.12)' : '#D7D0BF'}`,
    borderRadius: 8,
    fontSize: 12,
    color: isDark ? '#F7F4ED' : '#1F3A2E',
  };

  const noScopedData = scoped.length === 0;

  return (
    <div className="space-y-4">
      {mySchool && (
        <div className="flex items-center gap-1 self-start rounded-lg border border-edge p-1 text-sm dark:border-white/10">
          {[
            { id: 'mine', label: t('charts.scopeMine') },
            { id: 'all', label: t('charts.scopeAll') },
          ].map((opt) => (
            <button
              key={opt.id}
              type="button"
              onClick={() => setScope(opt.id)}
              aria-pressed={scope === opt.id}
              className={`rounded-md px-3 py-1.5 font-semibold transition ${
                scope === opt.id
                  ? 'bg-paper-sunk text-ink dark:bg-white/10 dark:text-paper'
                  : 'text-ink-faint'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}

      {noScopedData && scope === 'mine' && (
        <EmptyState title={t('charts.mySchoolNoData')} />
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title={t('charts.overTime.title')} subtitle={t('charts.overTime.subtitle')}>
          {series.length < 2 ? (
            <EmptyState title={t('charts.noData')} />
          ) : (
            <ResponsiveContainer>
              <LineChart data={series} margin={{ top: 8, right: 12, bottom: 4, left: 0 }}>
                <CartesianGrid stroke={grid} vertical={false} />
                <XAxis
                  dataKey="day"
                  tick={{ fill: axis, fontSize: 11 }}
                  tickFormatter={(d) => formatDate(d, locale)}
                  minTickGap={24}
                  stroke={axis}
                />
                <YAxis
                  tick={{ fill: axis, fontSize: 11 }}
                  width={44}
                  stroke={axis}
                  domain={['auto', 'auto']}
                  unit={` ${m.unit}`}
                />
                <Tooltip
                  contentStyle={tooltipStyle}
                  labelFormatter={(d) => formatDate(d, locale)}
                  formatter={(v) => [`${v} ${m.unit}`, fieldLabel(scale.field, locale)]}
                />
                <Line
                  type="monotone"
                  dataKey="value"
                  stroke={lineColor}
                  strokeWidth={2}
                  dot={{ r: 2.5, fill: lineColor }}
                  activeDot={{ r: 4 }}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        <ChartCard title={t('charts.distribution.title')} subtitle={t('charts.distribution.subtitle')}>
          {bins.length === 0 ? (
            <EmptyState title={t('charts.noData')} />
          ) : (
            <ResponsiveContainer>
              <BarChart data={bins} margin={{ top: 8, right: 12, bottom: 4, left: 0 }}>
                <CartesianGrid stroke={grid} vertical={false} />
                <XAxis dataKey="label" tick={{ fill: axis, fontSize: 11 }} stroke={axis} />
                <YAxis allowDecimals={false} tick={{ fill: axis, fontSize: 11 }} width={32} stroke={axis} />
                <Tooltip
                  contentStyle={tooltipStyle}
                  formatter={(v) => [v, t('charts.distribution.y')]}
                />
                <Bar dataKey="count" radius={[3, 3, 0, 0]}>
                  {bins.map((b, i) => (
                    <Cell key={i} fill={colorForValue(scale, (b.start + b.end) / 2)} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        <div className="lg:col-span-2">
          <ChartCard title={t('charts.bySchool.title')} subtitle={t('charts.bySchool.subtitle')}>
            {bySchool.length === 0 ? (
              <EmptyState title={t('charts.noData')} />
            ) : (
              <ResponsiveContainer>
                <BarChart
                  data={bySchool}
                  layout="vertical"
                  margin={{ top: 4, right: 16, bottom: 4, left: 8 }}
                >
                  <CartesianGrid stroke={grid} horizontal={false} />
                  <XAxis type="number" tick={{ fill: axis, fontSize: 11 }} stroke={axis} unit={` ${m.unit}`} />
                  <YAxis
                    type="category"
                    dataKey="key"
                    tick={{ fill: axis, fontSize: 11 }}
                    width={140}
                    stroke={axis}
                  />
                  <Tooltip
                    contentStyle={tooltipStyle}
                    formatter={(v) => [`${v} ${m.unit}`, t('charts.bySchool.y')]}
                  />
                  <Bar dataKey="value" radius={[0, 3, 3, 0]}>
                    {bySchool.map((row, i) => (
                      <Cell
                        key={i}
                        fill={
                          row.key === mySchool ? '#8B6F47' : isDark ? '#5A7A5F' : '#7C9880'
                        }
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </ChartCard>
        </div>
      </div>
    </div>
  );
}
