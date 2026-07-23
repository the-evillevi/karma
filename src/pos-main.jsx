import React from 'react';
import { createRoot } from 'react-dom/client';
import './karma-data.js'; // side effect: sets window.KARMA (read by PosApp logic)
import './styles.css';
import PosApp from './PosApp.jsx';

// Defaults from the design's data-props (vistaCatalogo / mostrarAgotados / propinaInicial).
createRoot(document.getElementById('root')).render(
  <PosApp vistaCatalogo="cuadricula" mostrarAgotados={true} propinaInicial="0" />
);
