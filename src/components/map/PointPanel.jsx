import { useEffect, useRef, useState } from 'react';
import { X, Flag, Send } from 'lucide-react';
import { useI18n } from '../../i18n';
import { useAppData } from '../../context/AppDataContext';
import { getUser } from '../../data/mockData';
import { METRICS, metricLabel, colorForValue } from '../../data/metrics';
import { formatDate, formatTime, formatValueWithUnit, relativeTime, coordLabel } from '../../lib/format';
import { photoDataUri } from '../../lib/media';
import { Avatar, VerificationBadge } from '../primitives';

function relText(t, iso) {
  const r = relativeTime(iso);
  return t(r.key, r.count != null ? { count: r.count } : undefined);
}

export default function PointPanel({ measurement, metric, onClose }) {
  const { t, locale } = useI18n();
  const { addComment, flagMeasurement } = useAppData();
  const [comment, setComment] = useState('');
  const [flagOpen, setFlagOpen] = useState(false);
  const [flagReason, setFlagReason] = useState('');
  const closeRef = useRef(null);

  useEffect(() => {
    closeRef.current?.focus();
    function onKey(e) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [measurement?.id, onClose]);

  if (!measurement) return null;
  const m = METRICS[metric];
  const user = getUser(measurement.userId);
  const photo =
    measurement.photoDataUri ||
    (measurement.photoSeed ? photoDataUri(measurement.photoSeed) : null);

  return (
    <aside
      className="absolute inset-y-0 end-0 z-[900] flex w-full max-w-sm flex-col border-s border-edge bg-paper-raised shadow-lg animate-slide-in-end dark:border-white/10 dark:bg-char-raised"
      role="dialog"
      aria-modal="false"
      aria-label={t('map.panel.value')}
    >
      <header className="flex items-start justify-between gap-2 border-b border-edge p-4 dark:border-white/10">
        <div>
          <div className="flex items-center gap-2">
            <span
              className="h-3.5 w-3.5 rounded-full ring-2 ring-paper-raised dark:ring-char-raised"
              style={{ background: colorForValue(metric, measurement.value) }}
              aria-hidden="true"
            />
            <span className="tnum text-xl font-semibold text-ink dark:text-paper">
              {formatValueWithUnit(measurement.value, m.unit, {
                locale,
                decimals: m.decimals,
              })}
            </span>
          </div>
          <p className="mt-1 text-xs text-ink-faint">{metricLabel(metric, locale)}</p>
        </div>
        <button
          ref={closeRef}
          type="button"
          className="btn-ghost px-2"
          onClick={onClose}
          aria-label={t('a11y.closePanel')}
        >
          <X className="h-4 w-4" />
        </button>
      </header>

      <div className="flex-1 space-y-4 overflow-y-auto p-4 text-sm">
        <dl className="grid grid-cols-2 gap-x-3 gap-y-2.5">
          <div>
            <dt className="text-xs text-ink-faint">{t('map.panel.date')}</dt>
            <dd className="tnum">{formatDate(measurement.timestamp, locale)}</dd>
          </div>
          <div>
            <dt className="text-xs text-ink-faint">{t('map.panel.time')}</dt>
            <dd className="tnum">{formatTime(measurement.timestamp, locale)}</dd>
          </div>
          <div className="col-span-2">
            <dt className="text-xs text-ink-faint">{t('map.panel.author')}</dt>
            <dd className="mt-1 flex items-center gap-2">
              <Avatar user={user} size={26} />
              <span>
                {user?.displayName} · <span className="text-ink-faint">{user?.school}</span>
              </span>
            </dd>
          </div>
          <div className="col-span-2">
            <dt className="text-xs text-ink-faint">{t('wizard.step2.instrumentLabel')}</dt>
            <dd>{measurement.instrument}</dd>
          </div>
          <div>
            <dt className="text-xs text-ink-faint">{t('wizard.step2.conditionsLabel')}</dt>
            <dd>{measurement.conditions}</dd>
          </div>
          <div>
            <dt className="text-xs text-ink-faint">{t('data.columns.status')}</dt>
            <dd>
              <VerificationBadge status={measurement.verification} />
            </dd>
          </div>
          {measurement.notes && (
            <div className="col-span-2">
              <dt className="text-xs text-ink-faint">{t('wizard.step2.notesLabel')}</dt>
              <dd>{measurement.notes}</dd>
            </div>
          )}
          <div className="col-span-2">
            <dt className="text-xs text-ink-faint">GPS</dt>
            <dd dir="ltr" className="tnum text-xs">
              {coordLabel(measurement.lat)}, {coordLabel(measurement.lng)}
            </dd>
          </div>
        </dl>

        {photo && (
          <figure>
            <img
              src={photo}
              alt={`${t('map.panel.photo')} — ${measurement.placeLabel}`}
              className="w-full rounded-lg border border-edge dark:border-white/10"
              loading="lazy"
            />
          </figure>
        )}

        {/* Comments */}
        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-faint">
            {t('map.panel.comments')} ({measurement.comments.length})
          </h3>
          {measurement.comments.length === 0 ? (
            <p className="text-xs text-ink-faint">{t('map.panel.noComments')}</p>
          ) : (
            <ul className="space-y-2.5">
              {measurement.comments.map((c) => {
                const cu = getUser(c.authorId);
                return (
                  <li key={c.id} className="flex gap-2">
                    <Avatar user={cu} size={24} />
                    <div className="min-w-0 flex-1">
                      <p className="text-xs">
                        <span className="font-semibold">{cu?.displayName}</span>{' '}
                        {c.verifiedExpert && (
                          <span className="chip chip-active !py-0 text-[10px]">
                            {t('discussion.expertBadge')}
                          </span>
                        )}
                        <span className="text-ink-faint"> · {relText(t, c.createdAt)}</span>
                      </p>
                      <p
                        className={`mt-0.5 text-sm ${
                          c.isFlag || c.verifiedExpert ? 'text-danger' : ''
                        }`}
                      >
                        {c.body}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

          <form
            className="mt-3 flex items-start gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (!comment.trim()) return;
              addComment(measurement.id, comment.trim());
              setComment('');
            }}
          >
            <label className="sr-only" htmlFor="pp-comment">
              {t('map.panel.addComment')}
            </label>
            <textarea
              id="pp-comment"
              rows={2}
              className="input flex-1 py-2 text-sm"
              placeholder={t('map.panel.addComment')}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
            />
            <button type="submit" className="btn-secondary mt-0.5 px-2.5" disabled={!comment.trim()}>
              <Send className="h-4 w-4" aria-hidden="true" />
              <span className="sr-only">{t('discussion.send')}</span>
            </button>
          </form>
        </section>
      </div>

      <footer className="border-t border-edge p-3 dark:border-white/10">
        {flagOpen ? (
          <form
            className="space-y-2"
            onSubmit={(e) => {
              e.preventDefault();
              flagMeasurement(measurement.id, flagReason.trim() || t('map.panel.reportIssue'));
              setFlagOpen(false);
              setFlagReason('');
            }}
          >
            <textarea
              rows={2}
              autoFocus
              className="input py-2 text-sm"
              placeholder={t('map.panel.reportIssue')}
              value={flagReason}
              onChange={(e) => setFlagReason(e.target.value)}
            />
            <div className="flex gap-2">
              <button type="submit" className="btn-primary flex-1 !bg-danger">
                {t('common.submit')}
              </button>
              <button type="button" className="btn-ghost" onClick={() => setFlagOpen(false)}>
                {t('common.cancel')}
              </button>
            </div>
          </form>
        ) : (
          <button
            type="button"
            className="btn-secondary w-full text-danger"
            onClick={() => setFlagOpen(true)}
          >
            <Flag className="h-4 w-4" aria-hidden="true" />
            {t('map.panel.reportIssue')}
          </button>
        )}
      </footer>
    </aside>
  );
}
