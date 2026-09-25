import { useEffect, useState } from 'react';
import { Globe2 } from 'lucide-react';
import { useI18n } from '../../i18n';
import { useAuth } from '../../context/AuthContext';
import { Field, Notice } from '../auth/AuthUI';
import { LabErrorText } from './LabErrorText';

/**
 * Admin profile (step 5a): full name + workplace (required), position (optional).
 * Shown publicly on labs the admin created or approved — the form says so.
 * Saved through admin_profile_save (010); the database checks everything again.
 */
export default function AdminProfileForm({ onSaved, idBase = 'admin-profile' }) {
  const { t } = useI18n();
  const { adminProfile, saveAdminProfile } = useAuth();
  const [values, setValues] = useState({ fullName: '', workplace: '', position: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (adminProfile) setValues(adminProfile);
  }, [adminProfile]);

  const set = (key) => (e) => {
    setSaved(false);
    setValues((v) => ({ ...v, [key]: e.target.value }));
  };

  const fieldError = (key) => {
    const code = error?.code === 'invalid_admin_profile' ? error.details?.[key] : null;
    return code ? t(`labs.adminProfile.errors.${code}`) : null;
  };

  async function onSubmit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      await saveAdminProfile(values);
      setSaved(true);
      onSaved?.();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      <p className="flex items-start gap-2 rounded-lg border border-warn/40 bg-warn/10 p-3 text-sm text-ink dark:text-paper">
        <Globe2 className="mt-0.5 h-4 w-4 shrink-0 text-warn" aria-hidden="true" />
        <span>{t('labs.adminProfile.publicNote')}</span>
      </p>
      <Field id={`${idBase}-name`} label={t('labs.adminProfile.fullName')} error={fieldError('full_name')}>
        <input
          id={`${idBase}-name`}
          className="input"
          dir="auto"
          autoComplete="name"
          maxLength={80}
          required
          value={values.fullName}
          onChange={set('fullName')}
          aria-invalid={Boolean(fieldError('full_name'))}
        />
      </Field>
      <Field
        id={`${idBase}-work`}
        label={t('labs.adminProfile.workplace')}
        hint={t('labs.adminProfile.workplaceHint')}
        error={fieldError('workplace')}
      >
        <input
          id={`${idBase}-work`}
          className="input"
          dir="auto"
          autoComplete="organization"
          maxLength={120}
          required
          value={values.workplace}
          onChange={set('workplace')}
          aria-invalid={Boolean(fieldError('workplace'))}
        />
      </Field>
      <Field
        id={`${idBase}-position`}
        label={`${t('labs.adminProfile.position')} (${t('common.optional')})`}
        hint={t('labs.adminProfile.positionHint')}
        error={fieldError('position')}
      >
        <input
          id={`${idBase}-position`}
          className="input"
          dir="auto"
          autoComplete="organization-title"
          maxLength={80}
          value={values.position}
          onChange={set('position')}
        />
      </Field>
      {error && error.code !== 'invalid_admin_profile' && <LabErrorText error={error} />}
      {saved && <Notice>{t('labs.adminProfile.saved')}</Notice>}
      <button type="submit" className="btn-primary" disabled={busy}>
        {busy ? t('labs.saving') : t('labs.adminProfile.save')}
      </button>
    </form>
  );
}
