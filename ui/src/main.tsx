import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Background from './components/Background';
import Bar from './routes/Bar';
import Roster from './routes/Roster';
import Benchmark from './routes/Benchmark';
import Login from './routes/Login';
import Signup from './routes/Signup';
import Reset from './routes/Reset';
import Settings from './routes/Settings';
import Memory from './routes/Memory';
import Landing from './routes/Landing';
import { AuthProvider } from './auth/AuthProvider';
import { registerServiceWorker } from './lib/pwa';
import './index.css';

// Installable PWA (replaced the retired Electron overlay): the service
// worker only makes the app installable + caches immutable assets — it
// never touches /api|/auth|/oauth, so runs/SSE behave identically installed.
registerServiceWorker();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Background />
    <div className="app-content">
      <BrowserRouter>
        <AuthProvider>
          <Routes>
            <Route path="/" element={<Bar />} />
            <Route path="/roster" element={<Roster />} />
            <Route path="/benchmark" element={<Benchmark />} />
            <Route path="/login" element={<Login />} />
            <Route path="/signup" element={<Signup />} />
            <Route path="/reset" element={<Reset />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="/memory" element={<Memory />} />
            <Route path="/welcome" element={<Landing />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </div>
  </React.StrictMode>,
);
