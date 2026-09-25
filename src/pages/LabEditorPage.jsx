import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Lock } from 'lucide-react';
import { useI18n } from '../i18n';
import { useAuth } from '../context/AuthContext';
import { useAppData } from '../context/AppDataContext';
import { isAdminRole } from '../lib/roles';
import { emptyLab, labFromCampaign } from '../lib/labs';
import { canEditLab } from '../lib/labsApi';
import { EmptyState, ErrorBlock, LoadingBlock } from '../components/primitives';
import LabEditor from '../components/labs/LabEditor';
import { AdminProfileRequired } from '../components/labs/LabErrorText';

/**
 * /labs/new and /labs/:id/edit — admins only (the database checks again on every save).
 * Needs a complete admin profile; editing an existing lab needs lab_can_edit (author, main
 * admins, owner).
 */
export default function LabEditorPage() {
  const { id } = useParams();
  const { t, locale } = useI18n();
  const { profile, adminProfile } = useAuth();
  const { getObservation, campaignsLoading, campaignsError, reloadCampaigns, refreshCampaigns } = useAppData();
  const [allowed, setAllowed] = useState(id ? null : true);
  const [reloadNonce, setReloadNonce] = useState(0);
  const campaign = id ? getObservation(id) : null;
  const campaignId = campaign?.id;

  useEffect(() => {
    if (!id || !campaignId) return undefined;
    let alive = true;
    setAllowed(null);
    canEditLab(campaignId)
      .then((ok) => alive && setAllowed(Boolean(ok)))
      .catch(() => alive && setAllowed(false));
    return () => {
      alive = false;
    };
  }, [id, campaignId]);

  const Back = locale === 'he' ? ArrowRight : ArrowLeft;
  const back = (
    <Link to="/profile#admin" className="btn-ghost -ms-2 text-sm">
      <Back className="h-4 w-4" aria-hidden="true" />
      {t('labs.editor.backToAdmin')}
    </Link>
  );

  if (!isAdminRole(profile?.role)) {
    return <EmptyState icon={Lock} title={t('labs.editor.adminsOnly')} />;
  }
  if (adminProfile === undefined) return <LoadingBlock />;
  if (adminProfile === null) {
    return (
      <div className="mx-auto max-w-2xl space-y-4">
        {back}
        <AdminProfileRequired />
      </div>
    );
  }
  if (id) {
    if (campaignsError) return <ErrorBlock onRetry={reloadCampaigns} />;
    if (campaignsLoading) return <LoadingBlock />;
    if (!campaign) return <EmptyState title={t('observation.notFound')} />;
    if (allowed === null) return <LoadingBlock />;
    if (!allowed) {
      return (
        <div className="mx-auto max-w-2xl space-y-4">
          {back}
          <EmptyState icon={Lock} title={t('labs.editor.notYours')} body={t('labs.editor.notYoursBody')} />
        </div>
      );
    }
  }

  async function reload() {
    await refreshCampaigns();
    setReloadNonce((n) => n + 1);
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      {back}
      <LabEditor
        key={`${campaign?.id || 'new'}-${reloadNonce}`}
        initial={campaign ? labFromCampaign(campaign) : emptyLab()}
        onReload={reload}
      />
    </div>
  );
}
