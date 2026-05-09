import React from 'react';
import ReactDOM from 'react-dom/client';
import PolarisApp from './translation-engine/PolarisApp';

// Standalone wrapper: replicates the TranslationEngineView container
// from the portfolio to ensure identical rendering behavior
const StandalonePolaris = () => {
  return (
    <div
      className="fixed inset-0 z-[60] bg-black overflow-y-auto"
      style={{ marginTop: 0 }}
    >
      <PolarisApp />
    </div>
  );
};

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <StandalonePolaris />
  </React.StrictMode>
);
