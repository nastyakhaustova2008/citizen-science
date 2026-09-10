import { useEffect, useRef, useState } from 'react';
import { useI18n } from '../i18n';
import { formatNumber } from '../lib/format';

function useCountUp(target, duration = 900) {
  const [value, setValue] = useState(0);
  const startRef = useRef(null);

  useEffect(() => {
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduce) {
      setValue(target);
      return;
    }
    let raf;
    startRef.current = null;
    const tick = (ts) => {
      if (startRef.current == null) startRef.current = ts;
      const p = Math.min(1, (ts - startRef.current) / duration);
      const eased = 1 - (1 - p) ** 3;
      setValue(Math.round(target * eased));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, duration]);

  return value;
}

/** One "living counter" tile. */
export default function Counter({ label, value, icon: Icon }) {
  const { locale } = useI18n();
  const shown = useCountUp(value);
  return (
    <div className="surface flex items-center gap-3 px-4 py-3.5">
      {Icon && (
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-paper-sunk text-moss dark:bg-white/5">
          <Icon className="h-5 w-5" aria-hidden="true" strokeWidth={1.75} />
        </span>
      )}
      <div>
        <div
          className="tnum text-2xl font-semibold leading-none text-ink dark:text-paper"
          aria-hidden="true"
        >
          {formatNumber(shown, { locale })}
        </div>
        <div className="mt-1 text-xs font-medium text-ink-faint">{label}</div>
        <span className="sr-only">
          {formatNumber(value, { locale })} {label}
        </span>
      </div>
    </div>
  );
}
