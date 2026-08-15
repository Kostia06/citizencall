import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Background from './components/Background';
import Bar from './routes/Bar';
import Roster from './routes/Roster';
import Benchmark from './routes/Benchmark';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Background />
    <div className="app-content">
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Bar />} />
          <Route path="/roster" element={<Roster />} />
          <Route path="/benchmark" element={<Benchmark />} />
        </Routes>
      </BrowserRouter>
    </div>
  </React.StrictMode>,
);
