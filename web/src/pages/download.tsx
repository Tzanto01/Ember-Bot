import { Download, ExternalLink } from 'lucide-react';
import { Trans, useTranslation } from 'react-i18next';
import { TapLink } from '@/components/auth/busy-button';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { pitch } from '@/content/pitch';
import { downloads } from '@/lib/downloads';
import { env } from '@/lib/env';
import { currentLanguage } from '@/lib/i18n';

function AndroidSection() {
  const { t } = useTranslation();
  const { apkUrl, version, sizeMb } = downloads.android;
  const size = new Intl.NumberFormat(currentLanguage()).format(sizeMb);
  return (
    <section aria-labelledby="download-android" className="flex flex-col gap-3">
      <h2 id="download-android" className="text-[1.375rem]">
        Android
      </h2>
      <Button asChild className="self-start">
        <a href={apkUrl} download>
          <Download aria-hidden />
          {t('download.android.button')}
        </a>
      </Button>
      <p className="text-muted-foreground">
        {t('download.android.meta', { version, size })}
      </p>
      <ol className="flex list-decimal flex-col gap-1 pl-5">
        <li>{t('download.android.step1')}</li>
        <li>{t('download.android.step2')}</li>
        <li>{t('download.android.step3')}</li>
      </ol>
    </section>
  );
}

function BrowserSection() {
  const { t } = useTranslation();
  return (
    <section aria-labelledby="download-browser" className="flex flex-col gap-3">
      <h2 id="download-browser" className="text-[1.375rem]">
        {t('download.browser.heading')}
      </h2>
      <p>{t('download.browser.lede')}</p>
      <ul className="flex list-disc flex-col gap-1 pl-5">
        <li>{t('download.browser.iphone')}</li>
        <li>{t('download.browser.android')}</li>
      </ul>
      <p className="text-muted-foreground">{t('download.browser.iosNote')}</p>
    </section>
  );
}

function DiscordSection() {
  const { t } = useTranslation();
  return (
    <section aria-labelledby="download-discord" className="flex flex-col gap-3">
      <h2 id="download-discord" className="text-[1.375rem]">
        {t('download.discord.heading')}
      </h2>
      <Button asChild variant="secondary" className="self-start">
        <a href={downloads.discordInvite} target="_blank" rel="noopener">
          {t('download.discord.button')} <span className="sr-only">{t('download.newTab')}</span>
          <ExternalLink aria-hidden />
        </a>
      </Button>
      <p className="text-muted-foreground">{t('download.discord.text')}</p>
    </section>
  );
}

/**
 * `/download`, public: the Android APK, adding the web app to a home screen, and the Discord bot. Android browsers
 * see the APK first, everyone else the browser route first; the native app hides the APK.
 */
export default function DownloadPage() {
  const { t } = useTranslation();
  const native = env.native;
  const androidBrowser = !native && navigator.userAgent.includes('Android');
  return (
    <div className="flex w-full flex-col gap-8">
      <PageHeader
        title={t('download.title')}
        lede={t('download.lede', { description: pitch.description })}
      />
      {androidBrowser && <AndroidSection />}
      <BrowserSection />
      {!native && !androidBrowser && <AndroidSection />}
      <DiscordSection />
      <p className="text-muted-foreground">
        <Trans
          i18nKey="download.ready"
          components={{ signup: <TapLink to="/signup" />, login: <TapLink to="/login" /> }}
        />
      </p>
    </div>
  );
}
