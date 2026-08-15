import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Background from './components/Background';
import Bar from './routes/Bar';
import Roster from './routes/Roster';
import Benchmark from './routes/Benchmark';
import Login from './routes/Login';
import Signup from './routes/Signup';
import Verify from './routes/Verify';
import Reset from './routes/Reset';
import { AuthProvider } from './auth/AuthProvider';
import './index.css';

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
            <Route path="/verify" element={<Verify />} />
            <Route path="/reset" element={<Reset />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </div>
  </React.StrictMode>,
);
