import { defineConfig } from '@playwright/test';

const baseURL = process.env.FABLE_UI_BASE ?? 'http://127.0.0.1:4173/FableShot/';

export default defineConfig({
  // Offline precaching includes SQLite WASM; avoid starving cold browser contexts on this workstation.
  workers: 3,
  testDir: 'e2e',
  use: {
    baseURL,
    channel: process.env.FABLE_BROWSER ?? 'chrome',
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    colorScheme: 'dark',
    // Existing workflow scenarios start after first-run onboarding. Its suite uses a fresh origin.
    storageState: { cookies: [], origins: [{ origin: new URL(baseURL).origin, localStorage: [{
      name: 'app.fableshot.training-preferences.v1', value: JSON.stringify({ version: 1, preferences: {
        hideScores: false, averageHundredths: false, animations: true, haptics: false, keepAwake: true, onboardingSeen: true,
      } }),
    }] }] },
  },
  webServer: process.env.FABLE_UI_BASE ? undefined : {
    command: 'node node_modules/vite/bin/vite.js preview --host 127.0.0.1 --port 4173 --strictPort --base /FableShot/',
    url: baseURL,
  },
});
