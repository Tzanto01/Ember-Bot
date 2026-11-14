import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

const links = [
  { to: '/legal/privacy', label: 'legalLinks.privacy' },
  { to: '/legal/terms', label: 'legalLinks.terms' },
  { to: '/legal/imprint', label: 'legalLinks.imprint' },
  { to: '/help', label: 'legalLinks.help' },
  { to: '/about', label: 'about.link' },
] as const;

/** Footer navigation to the three legal pages, the crisis lines page and About Ember. */
export function LegalLinks() {
  const { t } = useTranslation();
  return (
    <nav aria-label={t('legalLinks.label')} className="flex flex-wrap justify-center gap-x-5 gap-y-2 text-[0.875rem]">
      {links.map((link) => (
        <Link
          key={link.to}
          to={link.to}
          className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center text-muted-foreground underline-offset-4 hover:underline"
        >
          {t(link.label)}
        </Link>
      ))}
    </nav>
  );
}
