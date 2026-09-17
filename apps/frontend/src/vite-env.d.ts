/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** The email the development sign-in starts with; see `features/auth/SignInPage.tsx`. */
  readonly VITE_DEV_USER_EMAIL?: string;
  /** Where the backend is: the dev server proxies to it, builds call it; see `services/backendOrigin.ts`. */
  readonly VITE_BACKEND_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
