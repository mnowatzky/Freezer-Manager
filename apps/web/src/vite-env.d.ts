/// <reference types="vite/client" />
interface ImportMetaEnv {
  readonly VITE_ZERO_CACHE_URL: string;
  /** Origin printed into container QR codes (defaults to the current origin). */
  readonly VITE_PUBLIC_URL?: string;
}

/** Version of this web bundle (vite.config.ts → packages/shared/build-info.ts). */
declare const __APP_BUILD__: { version: string; commit: string };

/** Launch Handler API (Chromium only), not yet in TypeScript's DOM lib. */
interface LaunchParams {
  readonly targetURL?: string;
}
interface Window {
  readonly launchQueue?: { setConsumer(consumer: (params: LaunchParams) => void): void };
}
