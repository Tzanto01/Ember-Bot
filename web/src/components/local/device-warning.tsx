import { env } from '@/lib/env';

/** Where no-account data lives and how it can be lost, for the start screen and the "On this device" settings card. */
export function DeviceWarning() {
  return (
    <>
      <p>
        {env.native
          ? 'Your habits stay only on this phone. Uninstalling the app deletes them.'
          : 'Your habits stay only in this browser on this device. Browsers can delete site data (Safari after 7 days without a visit). Installing Ember as an app helps keep it.'}
      </p>
      <p>
        Nothing is sent to Ember's server, so there's no sync and no Discord. You can export a backup any time, and
        create an account later to keep your data.
      </p>
    </>
  );
}
