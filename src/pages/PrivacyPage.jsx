import { useEffect } from 'react';
import { useI18n } from '../i18n';
import { LoadingBlock } from '../components/primitives';
import { privacyUrl } from '../lib/privacy';

/** /#/privacy → the static policy page (public/privacy.html) in the current language. */
export default function PrivacyPage() {
  const { locale } = useI18n();
  useEffect(() => {
    window.location.replace(privacyUrl(locale));
  }, [locale]);
  return <LoadingBlock />;
}
