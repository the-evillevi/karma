import React from 'react';
import { createRoot } from 'react-dom/client';
import './karma-data.js'; // side effect: sets window.KARMA (read by PosApp logic)
import './styles.css';
import { PosRoot } from './pwa/PosRoot.tsx';

// Defaults from the design's data-props (vistaCatalogo / mostrarAgotados / propinaInicial).
createRoot(document.getElementById('root')).render(
  <PosRoot vistaCatalogo="cuadricula" mostrarAgotados={true} propinaInicial="0" />
);
