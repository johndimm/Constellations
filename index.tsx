import React from 'react';
import ReactDOM from 'react-dom/client';
import App from '@johndimm/constellations/App';
import './index.css';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
const hubUrl: string = import.meta.env.VITE_HUB_URL || "https://johndimm.vercel.app";

root.render(
  <React.StrictMode>
    <App homeHref={hubUrl} />
  </React.StrictMode>
);
