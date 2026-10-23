// ============================================================
// SAFEVISION AI — FRONTEND ENTRY POINT
// ============================================================
//
// Starts the React application, loads global styles, and
// renders the main SafeVision interface into the page root.
//
// ============================================================

import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode><App /></React.StrictMode>,
)
