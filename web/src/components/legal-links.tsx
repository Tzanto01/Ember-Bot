import { Link } from 'react-router';

const links = [
  { to: '/legal/privacy', label: 'Privacy' },
  { to: '/legal/terms', label: 'Terms' },
  { to: '/legal/imprint', label: 'Imprint' },
  { to: '/help', label: 'Help right now' },
];

/** Footer navigation to the three legal pages and the crisis lines page. */
export function LegalLinks() {
  return (
    <nav aria-label="Legal" className="flex flex-wrap justify-center gap-x-5 gap-y-2 text-[14px]">
      {links.map((link) => (
        <Link
          key={link.to}
          to={link.to}
          className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center text-muted-foreground underline-offset-4 hover:underline"
        >
          {link.label}
        </Link>
      ))}
    </nav>
  );
}
