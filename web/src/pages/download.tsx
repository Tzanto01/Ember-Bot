import { Download, ExternalLink } from 'lucide-react';
import { TapLink } from '@/components/auth/busy-button';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { pitch } from '@/content/pitch';
import { downloads } from '@/lib/downloads';
import { env } from '@/lib/env';

function AndroidSection() {
  const { apkUrl, version, size } = downloads.android;
  return (
    <section aria-labelledby="download-android" className="flex flex-col gap-3">
      <h2 id="download-android" className="text-[22px]">
        Android
      </h2>
      <Button asChild className="self-start">
        <a href={apkUrl} download>
          <Download aria-hidden />
          Download for Android
        </a>
      </Button>
      <p className="text-muted-foreground">
        Version {version}, {size}, for Android 7 or newer.
      </p>
      <ol className="flex list-decimal flex-col gap-1 pl-5">
        <li>Open the file once it has downloaded.</li>
        <li>When asked, allow "Install unknown apps" for your browser or messaging app.</li>
        <li>
          If Play Protect warns about an unknown developer, choose "Install anyway". That's expected for a beta
          build.
        </li>
      </ol>
    </section>
  );
}

function BrowserSection() {
  return (
    <section aria-labelledby="download-browser" className="flex flex-col gap-3">
      <h2 id="download-browser" className="text-[22px]">
        iPhone and any other device
      </h2>
      <p>Use Ember right here in your browser, then add it to your home screen so it opens like an app.</p>
      <ul className="flex list-disc flex-col gap-1 pl-5">
        <li>iPhone, in Safari: tap Share, then "Add to Home Screen".</li>
        <li>Android, in Chrome: open the menu, then "Add to Home screen" or "Install app".</li>
      </ul>
      <p className="text-muted-foreground">
        On iPhone, reminder notifications need Ember on your home screen (iOS 16.4 or newer).
      </p>
    </section>
  );
}

function DiscordSection() {
  return (
    <section aria-labelledby="download-discord" className="flex flex-col gap-3">
      <h2 id="download-discord" className="text-[22px]">
        If you use Discord
      </h2>
      <Button asChild variant="secondary" className="self-start">
        <a href={downloads.discordInvite} target="_blank" rel="noopener">
          Add Ember to Discord <span className="sr-only">(opens in a new tab)</span>
          <ExternalLink aria-hidden />
        </a>
      </Button>
      <p className="text-muted-foreground">
        Optional: the Ember bot can remind you in your DMs and lets you check in with slash commands, in any server or
        in your DMs.
      </p>
    </section>
  );
}

/**
 * `/download`, public: the Android APK, adding the web app to a home screen, and the Discord bot. Android browsers
 * see the APK first, everyone else the browser route first; the native app hides the APK.
 */
export default function DownloadPage() {
  const native = env.native;
  const androidBrowser = !native && navigator.userAgent.includes('Android');
  return (
    <div className="flex w-full flex-col gap-8">
      <PageHeader
        title="Get Ember"
        lede={`${pitch.description} Ember is in beta, so a few things may still change. Thanks for trying it early.`}
      />
      {androidBrowser && <AndroidSection />}
      <BrowserSection />
      {!native && !androidBrowser && <AndroidSection />}
      <DiscordSection />
      <p className="text-muted-foreground">
        Ready to start? <TapLink to="/signup">Create an account</TapLink> or <TapLink to="/login">sign in</TapLink>.
      </p>
    </div>
  );
}
