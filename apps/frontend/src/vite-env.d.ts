/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Development identity sent to the backend; see `services/identity.ts`. */
  readonly VITE_DEV_USER_EMAIL?: string;
  readonly VITE_BACKEND_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
