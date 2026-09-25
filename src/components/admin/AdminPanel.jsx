import { useState } from 'react';
import { History, Users, FlaskConical } from 'lucide-react';
import { useI18n } from '../../i18n';
import { SectionHeading } from '../primitives';
import Tabs from '../Tabs';
import UserList from './UserList';
import RoleLog from './RoleLog';
import LabList from '../labs/LabList';
import LabLog from '../labs/LabLog';
import { useAppData } from '../../context/AppDataContext';

/**
 * Own profile of an admin → "Administration": users (roles, renames), labs (editor, step 5a)
 * and the change logs (roles | labs).
 */
export default function AdminPanel() {
  const { t } = useI18n();
  const [tab, setTab] = useState('labs');
  const [logKind, setLogKind] = useState('labs');
  const { reviewCount } = useAppData(); // labs I can review now → badge on the Labs tab
  const tabs = [
    { id: 'labs', label: t('admin.tabs.labs'), icon: FlaskConical, count: reviewCount || null },
    { id: 'users', label: t('admin.tabs.users'), icon: Users },
    { id: 'log', label: t('admin.tabs.log'), icon: History },
  ];
  return (
    <section id="admin" className="scroll-mt-4">
      <SectionHeading as="h2" title={t('admin.title')} subtitle={t('admin.subtitle')} />
      <Tabs tabs={tabs} active={tab} onChange={setTab} idBase="admin" />
      <div role="tabpanel" id={`admin-panel-${tab}`} aria-labelledby={`admin-${tab}`} className="pt-4">
        {tab === 'labs' && <LabList />}
        {tab === 'users' && <UserList />}
        {tab === 'log' && (
          <div className="space-y-3">
            <div className="flex gap-2" role="group" aria-label={t('admin.tabs.log')}>
              {['labs', 'roles'].map((k) => (
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
            {logKind === 'labs' ? <LabLog /> : <RoleLog />}
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
