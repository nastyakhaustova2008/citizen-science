import { useState } from 'react';
import { Send } from 'lucide-react';
import { useI18n } from '../../i18n';
import { useAppData } from '../../context/AppDataContext';
import { COMMENT_MAX, cleanComment, commentError, commentLength } from '../../lib/comments';
import CommentErrorText from './CommentErrorText';

/**
 * Text box for a new comment, an edit or a "problem" report. Checks the text as you type
 * (same rules as the database); onSubmit(cleanText) may throw a CommentError.
 */
export default function CommentForm({
  id,
  initial = '',
  onSubmit,
  onCancel,
  placeholder,
  submitLabel,
  danger = false,
  autoFocus = false,
  rows = 2,
}) {
  const { t } = useI18n();
  const { linkDomains } = useAppData();
  const [text, setText] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const clean = cleanComment(text);
  const length = commentLength(clean);
  const live = clean ? commentError(clean, linkDomains) : null;
  const shown = error || live;

  async function submit(e) {
    e.preventDefault();
    if (!clean || live || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onSubmit(clean);
      setText('');
    } catch (err) {
      setError({ code: err.code || 'generic', details: err.details });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="space-y-1.5" onSubmit={submit} noValidate>
      <label className="sr-only" htmlFor={id}>
        {placeholder}
      </label>
      <div className="flex items-start gap-2">
        <textarea
          id={id}
          rows={rows}
          dir="auto"
          autoFocus={autoFocus}
          className="input flex-1 py-2 text-sm"
          placeholder={placeholder}
          value={text}
          aria-invalid={Boolean(shown)}
          onChange={(e) => {
            setText(e.target.value);
            setError(null);
          }}
        />
        {!onCancel && (
          <button type="submit" className="btn-secondary mt-0.5 px-2.5" disabled={!clean || Boolean(live) || busy}>
            <Send className="h-4 w-4" aria-hidden="true" />
            <span className="sr-only">{submitLabel || t('discussion.send')}</span>
          </button>
        )}
      </div>
      <CommentErrorText error={shown} />
      {length > COMMENT_MAX * 0.8 && (
        <p className={`tnum text-[11px] ${length > COMMENT_MAX ? 'text-danger' : 'text-ink-faint'}`} dir="ltr">
          {length} / {COMMENT_MAX}
        </p>
      )}
      {onCancel && (
        <div className="flex gap-2">
          <button
            type="submit"
            className={`btn-primary flex-1 ${danger ? '!bg-danger hover:!bg-danger/90' : ''}`}
            disabled={!clean || Boolean(live) || busy}
          >
            {busy ? t('common.loading') : submitLabel || t('common.save')}
          </button>
          <button type="button" className="btn-ghost" onClick={onCancel} disabled={busy}>
            {t('common.cancel')}
          </button>
        </div>
      )}
    </form>
  );
}
