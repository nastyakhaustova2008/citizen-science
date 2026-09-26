import { useState } from 'react';
import { History, Users, FlaskConical, MessageSquareWarning } from 'lucide-react';
import { useI18n } from '../../i18n';
import { SectionHeading } from '../primitives';
import Tabs from '../Tabs';
import UserList from './UserList';
import RoleLog from './RoleLog';
import LabList from '../labs/LabList';
import LabLog from '../labs/LabLog';
import ReportQueue from '../comments/ReportQueue';
import LinkDomains from '../comments/LinkDomains';
import CommentLog from '../comments/CommentLog';
import LinkDomainLog from '../comments/LinkDomainLog';
import PhotoQueue from '../photos/PhotoQueue';
import PhotoLog from '../photos/PhotoLog';
import { useAppData } from '../../context/AppDataContext';

/**
 * Own profile of an admin → "Administration": users (roles, renames), labs (editor, step 5a),
 * comments & photos (reported comments, allowed link domains — 015; measurement photos waiting
 * for approval or reported — 016) and the change logs.
 */
export default function AdminPanel() {
  const { t } = useI18n();
  const [tab, setTab] = useState('labs');
  const [logKind, setLogKind] = useState('labs');
  // Badges: labs I can review now; photos, reported comments + link domain proposals waiting for me.
  const { reviewCount, commentReportCount, photoQueueCount, linkProposalCount } = useAppData();
  const tabs = [
    { id: 'labs', label: t('admin.tabs.labs'), icon: FlaskConical, count: reviewCount || null },
    {
      id: 'comments',
      label: t('admin.tabs.comments'),
      icon: MessageSquareWarning,
      count: photoQueueCount + commentReportCount + linkProposalCount || null,
    },
    { id: 'users', label: t('admin.tabs.users'), icon: Users },
    { id: 'log', label: t('admin.tabs.log'), icon: History },
  ];
  return (
    <section id="admin" className="scroll-mt-4">
      <SectionHeading as="h2" title={t('admin.title')} subtitle={t('admin.subtitle')} />
      <Tabs tabs={tabs} active={tab} onChange={setTab} idBase="admin" />
      <div role="tabpanel" id={`admin-panel-${tab}`} aria-labelledby={`admin-${tab}`} className="pt-4">
        {tab === 'labs' && <LabList />}
        {tab === 'comments' && (
          <div className="space-y-8">
            <PhotoQueue />
            <ReportQueue />
            <LinkDomains />
          </div>
        )}
        {tab === 'users' && <UserList />}
        {tab === 'log' && (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2" role="group" aria-label={t('admin.tabs.log')}>
              {['labs', 'roles', 'comments', 'photos', 'links'].map((k) => (
                <button
                  key={k}
                  type="button"
                  className={`chip !py-1.5 !text-sm ${logKind === k ? 'chip-active' : ''}`}
                  aria-pressed={logKind === k}
                  onClick={() => setLogKind(k)}
                >
                  {t(`admin.logKinds.${k}`)}
                </button>
              ))}
            </div>
            {logKind === 'labs' && <LabLog />}
            {logKind === 'roles' && <RoleLog />}
            {logKind === 'comments' && <CommentLog />}
            {logKind === 'photos' && <PhotoLog />}
            {logKind === 'links' && <LinkDomainLog />}
          </div>
        )}
      </div>
    </section>
  );
}

/** Error line for an admin error code (admin.errors.<code>, username rules → auth.errors). */
export function AdminErrorText({ error }) {
  const { t } = useI18n();
  if (!error) return null;
  let text = t(`admin.errors.${error.code}`);
  if (error.code === 'invalid_username' && error.detail) text = t(`auth.errors.${error.detail}`);
  if (text.startsWith('admin.errors.') || text.startsWith('auth.errors.')) text = t('admin.errors.generic');
  return (
    <p className="text-sm text-danger" role="alert">
      {text}
    </p>
  );
}
