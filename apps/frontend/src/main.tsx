import { configure } from 'mobx';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router/dom';

import { LOCALE } from './i18n/locale';
import { router } from './router';
import { registerServiceWorker } from './services/pwa';
import { StoreProvider } from './stores/StoreContext';

import './index.css';

// Screen readers pronounce, and browsers hyphenate, by the page's language.
document.documentElement.lang = LOCALE;

// Strict mode: every observable mutation must happen inside an action, so an
// accidental write from a component fails loudly instead of silently working.
configure({
  enforceActions: 'always',
  computedRequiresReaction: false,
  reactionRequiresObservable: false,
  observableRequiresReaction: false,
});

// Before the app renders, and whether or not anyone signs in: the worker caches
// the app itself, which is what makes it installable and openable offline.
registerServiceWorker();

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
