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
import { colorForValue } from '../../data/metrics';
import { fieldLabel } from '../../lib/fields';
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

/**
 * Charts of the primary field over ALL measurements of the lab: `stats` comes from the server
 * aggregate measurement_lab_stats (019), so nothing is cut by the API's row limit.
 */
export default function ObservationCharts({ observation, stats }) {
  const { t, locale } = useI18n();
  const { isDark } = useTheme();
  // Charts use the primary field (the page shows an empty state when there is none).
  const scale = observation.scale;
  const m = scale;

  const axis = isDark ? '#8a8f86' : '#5C6B60';
  const grid = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(31,58,46,0.10)';
  const lineColor = '#8B6F47';

  const series = stats.daily;
  const bins = stats.histogram;

  const tooltipStyle = {
    background: isDark ? '#232622' : '#FFFDF8',
    border: `1px solid ${isDark ? 'rgba(255,255,255,0.12)' : '#D7D0BF'}`,
    borderRadius: 8,
    fontSize: 12,
    color: isDark ? '#F7F4ED' : '#1F3A2E',
  };

  return (
    <div className="space-y-4">
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
      </div>
    </div>
  );
}
