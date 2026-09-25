import { useState } from 'react';
import { History, Users } from 'lucide-react';
import { useI18n } from '../../i18n';
import { SectionHeading } from '../primitives';
import Tabs from '../Tabs';
import UserList from './UserList';
import RoleLog from './RoleLog';

/** Own profile of an admin → "Administration": users (roles, renames) and the change log. */
export default function AdminPanel() {
  const { t } = useI18n();
  const [tab, setTab] = useState('users');
  const tabs = [
    { id: 'users', label: t('admin.tabs.users'), icon: Users },
    { id: 'log', label: t('admin.tabs.log'), icon: History },
  ];
  return (
    <section>
      <SectionHeading as="h2" title={t('admin.title')} subtitle={t('admin.subtitle')} />
      <Tabs tabs={tabs} active={tab} onChange={setTab} idBase="admin" />
      <div role="tabpanel" id={`admin-panel-${tab}`} aria-labelledby={`admin-${tab}`} className="pt-4">
        {tab === 'users' ? <UserList /> : <RoleLog />}
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
