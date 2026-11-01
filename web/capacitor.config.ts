import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Capacitor 8 wraps the `mobile` Angular build (`ng build --configuration mobile`). The Android project lives
 * in `mobile/android`. HTTPS scheme (origin `https://localhost`), no cleartext, no mixed content.
 */
const config: CapacitorConfig = {
  appId: 'app.ember.habits',
  appName: 'Ember',
  webDir: 'dist/ember-mobile/browser',
  server: { androidScheme: 'https', cleartext: false },
  android: { path: '../mobile/android', allowMixedContent: false },
};

export default config;
