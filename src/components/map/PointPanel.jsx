import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { X, Flag } from 'lucide-react';
import { useI18n } from '../../i18n';
import { useAppData } from '../../context/AppDataContext';
import { colorForValue } from '../../data/metrics';
import { formatDate, formatTime, formatNumber } from '../../lib/format';
import { locationLabel } from '../../lib/location';
import { fieldLabel, formatFieldValue, hasValue, visibleFields } from '../../lib/fields';
import { photoDataUri } from '../../lib/media';
import { Avatar, AuthorName, LoginPrompt, VerificationBadge } from '../primitives';
import useComments from '../../hooks/useComments';
import usePhotos from '../../hooks/usePhotos';
import CommentThread from '../comments/CommentThread';
import MeasurementPhoto from '../photos/MeasurementPhoto';
import CommentForm from '../comments/CommentForm';

export default function PointPanel({ measurement, observation, onClose }) {
  const { t, locale } = useI18n();
  const { getAuthor, currentUser } = useAppData();
  const thread = useComments(measurement?.id);
  const photoThread = usePhotos(measurement?.id);
  const [flagOpen, setFlagOpen] = useState(false);
  const [flagDone, setFlagDone] = useState(false);
  const closeRef = useRef(null);

  useEffect(() => {
    setFlagOpen(false);
    setFlagDone(false);
  }, [measurement?.id]);

  useEffect(() => {
    closeRef.current?.focus();
    function onKey(e) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [measurement?.id, onClose]);

  if (!measurement) return null;
  const scale = observation.scale;
  const primary = observation.primaryField;
  const user = getAuthor(measurement.userId);
  // All fields with a value on this point, archived ones included; the primary one is in the header.
  const fields = visibleFields(observation, [measurement]).filter(
    (f) => f.key !== primary?.key && hasValue(measurement.values[f.key]),
  );
  // Photo fields are shown below the list (stored photos, 016); demo rows have a generated image.
  const photoFields = fields.filter((f) => f.type === 'photo');
  const photoAlt = (label) => [label, measurement.placeLabel].filter(Boolean).join(' — ');

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
              style={{ background: colorForValue(scale, measurement.value) }}
              aria-hidden="true"
            />
            <span className="tnum text-xl font-semibold text-ink dark:text-paper" dir="ltr">
              {formatNumber(measurement.value, { locale, decimals: scale?.decimals ?? 0 })}
              {scale?.unit && measurement.value != null ? ` ${scale.unit}` : ''}
            </span>
          </div>
          {primary && <p className="mt-1 text-xs text-ink-faint">{fieldLabel(primary, locale)}</p>}
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
                {user ? (
                  <Link to={`/profile/${measurement.userId}`} className="hover:underline">
                    <AuthorName user={user} />
                  </Link>
                ) : (
                  <AuthorName user={user} />
                )}
                {user?.school && <span className="text-ink-faint"> · {user.school}</span>}
              </span>
            </dd>
          </div>
          {measurement.placeLabel && (
            <div className="col-span-2">
              <dt className="text-xs text-ink-faint">{t('data.columns.place')}</dt>
              <dd>{measurement.placeLabel}</dd>
            </div>
          )}
          {fields
            .filter((f) => f.type !== 'photo')
            .map((f) => (
              <div key={f.key} className="col-span-2">
                <dt className="text-xs text-ink-faint">
                  {fieldLabel(f, locale)}
                  {f.archived && <span className="ms-1 italic">({t('fields.archived')})</span>}
                </dt>
                <dd className={f.type === 'number' ? 'tnum' : 'whitespace-pre-line break-words'}>
                  {f.type === 'number' ? (
                    <span dir="ltr">{formatFieldValue(f, measurement.values[f.key], { locale, t })}</span>
                  ) : (
                    formatFieldValue(f, measurement.values[f.key], { locale, t })
                  )}
                </dd>
              </div>
            ))}
          <div>
            <dt className="text-xs text-ink-faint">{t('data.columns.status')}</dt>
            <dd>
              <VerificationBadge status={measurement.verification} />
            </dd>
          </div>
          <div className="col-span-2">
            <dt className="text-xs text-ink-faint">GPS</dt>
            <dd dir="ltr" className="tnum text-xs">
              {locationLabel(measurement.lat)}, {locationLabel(measurement.lng)}
            </dd>
          </div>
        </dl>

        {photoFields.map((f) => (
          <MeasurementPhoto
            key={f.key}
            field={f}
            label={fieldLabel(f, locale)}
            value={measurement.values[f.key]}
            alt={photoAlt(fieldLabel(f, locale))}
            photos={photoThread}
          />
        ))}
        {measurement.photoSeed && (
          <figure>
            <img
              src={photoDataUri(measurement.photoSeed)}
              alt={photoAlt(t('map.panel.photo'))}
              className="w-full rounded-lg border border-edge dark:border-white/10"
              loading="lazy"
            />
          </figure>
        )}

        <CommentThread thread={thread} />
      </div>

      <footer className="border-t border-edge p-3 dark:border-white/10">
        {!currentUser ? (
          <LoginPrompt className="text-xs" message={t('auth.loginToParticipate')} />
        ) : flagOpen ? (
          <CommentForm
            id="pp-issue"
            autoFocus
            danger
            placeholder={t('comments.issuePlaceholder')}
            submitLabel={t('common.submit')}
            onSubmit={async (body) => {
              await thread.add(body, locale, 'issue');
              setFlagOpen(false);
              setFlagDone(true);
            }}
            onCancel={() => setFlagOpen(false)}
          />
        ) : flagDone ? (
          <p className="text-center text-xs text-ink-faint" role="status">
            {t('comments.issueDone')}
          </p>
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
