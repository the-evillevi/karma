/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly KARMA_PWA_ENABLED?: boolean;
  readonly KARMA_DEMO_PREVIEW?: boolean;
  readonly VITE_SUPABASE_URL?: string;
  /** Public anon/publishable key only. Never put a service-role key in VITE_ variables. */
  readonly VITE_SUPABASE_ANON_KEY?: string;
  readonly VITE_KARMA_ACCESS_MODE?: "secure";
  readonly VITE_KARMA_BRANCH_ID?: string;
  readonly VITE_KARMA_DEVICE_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
