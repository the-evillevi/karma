import React from 'react';
import { createRoot } from 'react-dom/client';
import './karma-data.js'; // side effect: sets window.KARMA (read by ComandaApp logic)
import './styles.css';
import { ComandaRoot } from './pwa/ComandaRoot.tsx';

createRoot(document.getElementById('root')).render(<ComandaRoot />);
