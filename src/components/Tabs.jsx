import { useRef } from 'react';

/**
 * Accessible tab strip. Roving focus with arrow keys, RTL-aware.
 * `tabs`: [{ id, label, icon: Component, count }]
 */
export default function Tabs({ tabs, active, onChange, idBase = 'tab' }) {
  const refs = useRef([]);

  function onKeyDown(e) {
    const idx = tabs.findIndex((tb) => tb.id === active);
    const rtl = document.documentElement.dir === 'rtl';
    let next = null;
    const forward = rtl ? 'ArrowLeft' : 'ArrowRight';
    const backward = rtl ? 'ArrowRight' : 'ArrowLeft';
    if (e.key === forward) next = (idx + 1) % tabs.length;
    else if (e.key === backward) next = (idx - 1 + tabs.length) % tabs.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = tabs.length - 1;
    if (next != null) {
      e.preventDefault();
      onChange(tabs[next].id);
      refs.current[next]?.focus();
    }
  }

  return (
    <div
      role="tablist"
      aria-orientation="horizontal"
      onKeyDown={onKeyDown}
      className="flex gap-1 overflow-x-auto border-b border-edge dark:border-white/10"
    >
      {tabs.map((tb, i) => {
        const selected = tb.id === active;
        const Icon = tb.icon;
        return (
          <button
            key={tb.id}
            ref={(el) => (refs.current[i] = el)}
            role="tab"
            id={`${idBase}-${tb.id}`}
            aria-selected={selected}
            aria-controls={`${idBase}-panel-${tb.id}`}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(tb.id)}
            className={`-mb-px inline-flex shrink-0 items-center gap-2 border-b-2 px-3.5 py-2.5 text-sm font-semibold transition ${
              selected
                ? 'border-bark text-ink dark:text-paper'
                : 'border-transparent text-ink-faint hover:text-ink dark:hover:text-paper'
            }`}
          >
            {Icon && <Icon className="h-4 w-4" aria-hidden="true" strokeWidth={1.75} />}
            {tb.label}
            {tb.count != null && (
              <span className="tnum rounded-full bg-paper-sunk px-1.5 text-xs text-ink-faint dark:bg-white/10">
                {tb.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

export function TabPanel({ id, active, idBase = 'tab', children }) {
  if (id !== active) return null;
  return (
    <div role="tabpanel" id={`${idBase}-panel-${id}`} aria-labelledby={`${idBase}-${id}`} tabIndex={0}>
      {children}
    </div>
  );
}
