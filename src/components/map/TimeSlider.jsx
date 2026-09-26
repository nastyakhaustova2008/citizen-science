import { useEffect, useRef, useState } from 'react';
import { Play, Pause, RotateCcw } from 'lucide-react';
import { useI18n } from '../../i18n';
import { formatDate } from '../../lib/format';

/**
 * Bottom-of-map date scrubber. `dates` is a sorted array of ISO date
 * strings (yyyy-mm-dd). `value` is the current cutoff index; points with
 * a date <= dates[value] are shown. Playing animates the accumulation.
 */
export default function TimeSlider({ dates, value, onChange, shownCount, totalCount }) {
  const { t, locale } = useI18n();
  const [playing, setPlaying] = useState(false);
  const timerRef = useRef(null);

  useEffect(() => {
    if (!playing) return undefined;
    timerRef.current = setInterval(() => {
      onChange((prev) => {
        if (prev >= dates.length - 1) {
          setPlaying(false);
          return prev;
        }
        return prev + 1;
      });
    }, 650);
    return () => clearInterval(timerRef.current);
  }, [playing, dates.length, onChange]);

  if (dates.length < 2) return null;
  const atEnd = value >= dates.length - 1;

  return (
    <div className="surface pointer-events-auto flex items-center gap-3 p-2.5">
      <button
        type="button"
        className="btn-ghost shrink-0 px-2"
        onClick={() => {
          if (atEnd) {
            onChange(0);
            setPlaying(true);
          } else {
            setPlaying((p) => !p);
          }
        }}
        aria-label={playing ? t('map.pause') : t('map.play')}
      >
        {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
      </button>

      <div className="min-w-0 flex-1">
        <input
          type="range"
          min={0}
          max={dates.length - 1}
          value={value}
          onChange={(e) => {
            setPlaying(false);
            onChange(Number(e.target.value));
          }}
          className="h-6 w-full accent-bark"
          aria-label={t('map.timelineLabel')}
          aria-valuetext={atEnd ? t('map.allDates') : formatDate(dates[value], locale)}
        />
        <div className="mt-0.5 flex items-center justify-between text-[11px] text-ink-faint">
          <span className="tnum">
            {atEnd
              ? t('map.allDates')
              : t('map.showingUpTo', { date: formatDate(dates[value], locale) })}
          </span>
          <span className="tnum">
            {t('map.pointsShown', { shown: shownCount, total: totalCount })}
          </span>
        </div>
      </div>

      {value !== dates.length - 1 && (
        <button
          type="button"
          className="btn-ghost shrink-0 px-2"
          onClick={() => {
            setPlaying(false);
            onChange(dates.length - 1);
          }}
          aria-label={t('common.reset')}
        >
          <RotateCcw className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}
