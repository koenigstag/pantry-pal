/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Development identity sent to the backend; see `services/identity.ts`. */
  readonly VITE_DEV_USER_EMAIL?: string;
  /** Where the backend is: the dev server proxies to it, builds call it; see `services/backendOrigin.ts`. */
  readonly VITE_BACKEND_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
