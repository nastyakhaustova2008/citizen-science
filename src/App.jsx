import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useEffect } from 'react';
import Header from './components/Header';
import Footer from './components/Footer';
import { useI18n } from './i18n';

import HomePage from './pages/HomePage';
import ObservationPage from './pages/ObservationPage';
import AddMeasurementPage from './pages/AddMeasurementPage';
import ProfilePage from './pages/ProfilePage';
import ProtocolPage from './pages/ProtocolPage';
import NotFoundPage from './pages/NotFoundPage';

function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });
  }, [pathname]);
  return null;
}

export default function App() {
  const { t } = useI18n();

  return (
    <div className="flex min-h-full flex-col">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:start-2 focus:z-[1000] focus:rounded-lg focus:bg-ink focus:px-4 focus:py-2 focus:text-paper"
      >
        {t('common.skipToContent')}
      </a>
      <Header />
      <ScrollToTop />
      <main id="main" className="mx-auto w-full max-w-content flex-1 px-4 py-6 sm:px-6 sm:py-8">
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/observations/:slug" element={<ObservationPage />} />
          <Route path="/observations/:slug/add" element={<AddMeasurementPage />} />
          <Route path="/profile" element={<ProfilePage />} />
          <Route path="/profile/:userId" element={<ProfilePage />} />
          <Route path="/protocol/:slug" element={<ProtocolPage />} />
          <Route path="/404" element={<NotFoundPage />} />
          <Route path="*" element={<Navigate to="/404" replace />} />
        </Routes>
      </main>
      <Footer />
    </div>
  );
}
