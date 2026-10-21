/// <reference types="vite/client" />
interface ImportMetaEnv {
  readonly VITE_ZERO_CACHE_URL: string;
  /** Origin printed into container QR codes (defaults to the current origin). */
  readonly VITE_PUBLIC_URL?: string;
}

/** Launch Handler API (Chromium only), not yet in TypeScript's DOM lib. */
interface LaunchParams {
  readonly targetURL?: string;
}
interface Window {
  readonly launchQueue?: { setConsumer(consumer: (params: LaunchParams) => void): void };
}
