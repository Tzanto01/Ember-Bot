/**
 * Build-time settings for the Capacitor app (`ng build --configuration mobile`): bearer auth against the
 * absolute `{WebOrigin}` API. Set both URLs to the deployed `Ember__WebOrigin` before building an APK.
 */
export const environment = {
  native: true,
  apiBase: 'https://ember.invalid',
  webOrigin: 'https://ember.invalid',
};
