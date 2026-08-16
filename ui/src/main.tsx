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
import Spotlight from './routes/Spotlight';
import Memory from './routes/Memory';
import { AuthProvider } from './auth/AuthProvider';
import './index.css';

// The Electron overlay (desktop/main.js) loads /spotlight. There the window
// itself provides the backdrop, so the canvas mesh and the body gradient must
// both get out of the way — otherwise the overlay renders as an opaque
// rectangle instead of a bar floating on the desktop.
const isSpotlight = window.location.pathname.startsWith('/spotlight');
if (isSpotlight) document.documentElement.classList.add('spotlight-shell');

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {!isSpotlight && <Background />}
    <div className={isSpotlight ? undefined : 'app-content'}>
      <BrowserRouter>
        {/* /spotlight sits INSIDE AuthProvider like every other route — it
            shares Bar's data path (runs, prefs, connections), so it needs the
            same auth context. */}
        <AuthProvider>
          <Routes>
            <Route path="/" element={<Bar />} />
            <Route path="/spotlight" element={<Spotlight />} />
            <Route path="/roster" element={<Roster />} />
            <Route path="/benchmark" element={<Benchmark />} />
            <Route path="/login" element={<Login />} />
            <Route path="/signup" element={<Signup />} />
            <Route path="/reset" element={<Reset />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="/memory" element={<Memory />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </div>
  </React.StrictMode>,
);
