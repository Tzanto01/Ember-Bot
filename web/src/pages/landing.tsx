import { BellRing, LockKeyhole, MessageCircle, Moon, NotebookPen, Palette, Smartphone } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { TapLink } from '@/components/auth/busy-button';
import { BetaBadge } from '@/components/beta-badge';
import { FlameMark } from '@/components/flame-mark';
import { LegalLinks } from '@/components/legal-links';
import { MomentDoor } from '@/components/moment/moment-door';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { pitch } from '@/content/pitch';

const features = [
  {
    icon: BellRing,
    title: 'landing.feature.reminders.title',
    text: 'landing.feature.reminders.text',
  },
  {
    icon: Smartphone,
    title: 'landing.feature.platforms.title',
    text: 'landing.feature.platforms.text',
  },
  {
    icon: Moon,
    title: 'landing.feature.flexible.title',
    text: 'landing.feature.flexible.text',
  },
  {
    icon: LockKeyhole,
    title: 'landing.feature.private.title',
    text: 'landing.feature.private.text',
  },
] as const;

const extras = [
  {
    icon: NotebookPen,
    title: 'landing.extra.journal.title',
    text: 'landing.extra.journal.text',
  },
  {
    icon: Palette,
    title: 'landing.extra.themes.title',
    text: 'landing.extra.themes.text',
  },
  {
    icon: MessageCircle,
    title: 'landing.extra.discord.title',
    text: 'landing.extra.discord.text',
  },
] as const;

/**
 * `/` for signed-out visitors on the web: the companion pitch with the moment door first, the ways in, a real Today
 * screenshot (light or dark with the system, German when the page is), then the habits.
 */
export default function LandingPage() {
  const { t, i18n } = useTranslation();
  const shot = i18n.language === 'de' ? '.de' : '';
  return (
    <div className="flex min-h-dvh flex-col bg-[radial-gradient(60rem_30rem_at_50%_-10rem,var(--notice),transparent_70%)] pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]">
      <header className="mx-auto flex w-full max-w-[72rem] px-4 pt-4 lg:px-6">
        <span className="inline-flex min-h-[44px] items-center gap-2 font-display text-[1.375rem] font-bold text-foreground">
          <FlameMark />
          Ember
          <BetaBadge />
        </span>
      </header>
      <main
        id="main"
        tabIndex={-1}
        className="mx-auto flex w-full max-w-[72rem] flex-1 flex-col gap-12 px-4 py-8 focus:outline-none lg:gap-16 lg:px-6 lg:py-14"
      >
        <section className="grid grid-cols-1 items-center gap-8 lg:grid-cols-12 lg:gap-10">
          <div className="flex flex-col gap-6 lg:col-span-7">
            <div className="flex flex-col gap-3">
              <h1 tabIndex={-1} className="text-[2.25rem] hyphens-auto focus:outline-none md:text-[3rem]">
                {pitch.hero}
              </h1>
              <p className="max-w-[36rem] text-[1.125rem] text-muted-foreground">
                {t('landing.lede', { description: pitch.description })}
              </p>
            </div>
            <div className="flex flex-col items-start gap-2">
              <MomentDoor variant="hero" />
              <p className="text-muted-foreground">
                {t('landing.talk')} <TapLink to="/help">{t('landing.crisisLine')}</TapLink>
              </p>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
              <Button asChild variant="secondary">
                <Link to="/signup">{t('landing.cta.signup')}</Link>
              </Button>
              <Button asChild variant="secondary">
                <Link to="/login">{t('landing.cta.login')}</Link>
              </Button>
              <Button asChild variant="ghost">
                <Link to="/local">{t('landing.cta.local')}</Link>
              </Button>
              <Button asChild variant="ghost">
                <Link to="/download">{t('landing.cta.download')}</Link>
              </Button>
            </div>
            <p className="text-muted-foreground">{t('landing.madeBy')}</p>
          </div>
          <picture className="mx-auto block w-full max-w-[20.5rem] lg:col-span-5">
            <source srcSet={`/landing/today-dark${shot}.webp`} media="(prefers-color-scheme: dark)" />
            <img
              src={`/landing/today-light${shot}.webp`}
              width={390}
              height={760}
              loading="lazy"
              decoding="async"
              alt={t('landing.screenshotAlt')}
              className="block h-auto max-h-[40rem] w-full rounded-[1.75rem] border-[length:max(1px,var(--border-width))] border-border object-cover object-top shadow-card"
            />
          </picture>
        </section>
        <section aria-labelledby="landing-features" className="flex flex-col gap-6">
          <h2 id="landing-features" className="text-[1.5rem] md:text-[1.75rem]">
            {pitch.habitsLine}
          </h2>
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {features.map(({ icon: Icon, title, text }) => (
              <li key={title}>
                <Card className="h-full">
                  <Icon aria-hidden className="size-[24px] text-primary" />
                  <h3 className="text-[1.125rem]">{t(title)}</h3>
                  <p className="text-muted-foreground">{t(text)}</p>
                </Card>
              </li>
            ))}
          </ul>
        </section>
        <section aria-labelledby="landing-extras" className="flex flex-col gap-6">
          <h2 id="landing-extras" className="text-[1.5rem] md:text-[1.75rem]">
            {t('landing.extrasHeading')}
          </h2>
          <ul className="grid gap-4 md:grid-cols-3">
            {extras.map(({ icon: Icon, title, text }) => (
              <li key={title}>
                <Card className="h-full">
                  <Icon aria-hidden className="size-[24px] text-primary" />
                  <h3 className="text-[1.125rem]">{t(title)}</h3>
                  <p className="text-muted-foreground">{t(text)}</p>
                </Card>
              </li>
            ))}
          </ul>
        </section>
      </main>
      <footer className="px-4 pb-4">
        <LegalLinks />
      </footer>
    </div>
  );
}
