import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import './index.css';
import { Landing } from './pages/Landing';
import { DriverPage } from './pages/DriverPage';
import { OfficerPage } from './pages/OfficerPage';
import { HospitalPage } from './pages/HospitalPage';
import { ControlPage } from './pages/ControlPage';
import { DemoPage } from './pages/DemoPage';
import { SummaryPage } from './pages/SummaryPage';

// Installable app (PWA). Production only, so dev hot-reload isn't cached.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => void navigator.serviceWorker.register('/sw.js'));
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/driver" element={<DriverPage />} />
        <Route path="/officer" element={<OfficerPage />} />
        <Route path="/hospital" element={<HospitalPage />} />
        <Route path="/control" element={<ControlPage />} />
        <Route path="/demo" element={<DemoPage />} />
        <Route path="/trips/:id" element={<SummaryPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>,
);
