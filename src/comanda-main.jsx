import React from 'react';
import { createRoot } from 'react-dom/client';
import './karma-data.js'; // side effect: sets window.KARMA (read by ComandaApp logic)
import './styles.css';
import ComandaApp from './ComandaApp.jsx';

createRoot(document.getElementById('root')).render(<ComandaApp />);
