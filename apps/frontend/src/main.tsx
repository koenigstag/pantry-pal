import { configure } from 'mobx';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router/dom';

import { router } from './router';
import { StoreProvider } from './stores/StoreContext';

import './index.css';

// Strict mode: every observable mutation must happen inside an action, so an
// accidental write from a component fails loudly instead of silently working.
configure({
  enforceActions: 'always',
  computedRequiresReaction: false,
  reactionRequiresObservable: false,
  observableRequiresReaction: false,
});

const container = document.getElementById('root');
if (container === null) {
  throw new Error('Root element #root is missing from index.html');
}

createRoot(container).render(
  <StrictMode>
    <StoreProvider>
      <RouterProvider router={router} />
    </StoreProvider>
  </StrictMode>,
);
