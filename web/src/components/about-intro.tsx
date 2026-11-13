import { useTranslation } from 'react-i18next';
import { TapLink } from '@/components/auth/busy-button';

/** A short "what Ember is" line and a link to `/about`, for sign-in and `/local`. */
export function AboutIntro() {
  const { t } = useTranslation();
  return (
    <p className="flex flex-col items-center text-center text-muted-foreground">
      {t('about.intro')}
      <TapLink to="/about">{t('about.link')}</TapLink>
    </p>
  );
}
