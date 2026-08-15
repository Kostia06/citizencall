import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Background from './components/Background';
import Bar from './routes/Bar';
import Roster from './routes/Roster';
import Benchmark from './routes/Benchmark';
import Spotlight from './routes/Spotlight';
import './index.css';

// The Electron overlay (desktop/main.js) loads /spotlight. There the window
// itself provides the backdrop via macOS vibrancy, so the canvas mesh and the
// body gradient must both get out of the way — otherwise the overlay renders
// as an opaque black rectangle instead of frosted glass.
const isSpotlight = window.location.pathname.startsWith('/spotlight');
if (isSpotlight) document.documentElement.classList.add('spotlight-shell');

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {!isSpotlight && <Background />}
    <div className={isSpotlight ? undefined : 'app-content'}>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Bar />} />
          <Route path="/spotlight" element={<Spotlight />} />
          <Route path="/roster" element={<Roster />} />
          <Route path="/benchmark" element={<Benchmark />} />
        </Routes>
      </BrowserRouter>
    </div>
  </React.StrictMode>,
);
