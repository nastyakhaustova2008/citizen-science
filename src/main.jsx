import React from 'react';
import ReactDOM from 'react-dom/client';
import { HashRouter } from 'react-router-dom';

import 'leaflet/dist/leaflet.css';
import 'leaflet.markercluster/dist/MarkerCluster.css';
import 'leaflet.markercluster/dist/MarkerCluster.Default.css';
import './leaflet-setup';
import './index.css';

import { I18nProvider } from './i18n';
import { ThemeProvider } from './context/ThemeContext';
import { AppDataProvider } from './context/AppDataContext';
import App from './App';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <HashRouter>
      <I18nProvider>
        <ThemeProvider>
          <AppDataProvider>
            <App />
          </AppDataProvider>
        </ThemeProvider>
      </I18nProvider>
    </HashRouter>
  </React.StrictMode>,
);
