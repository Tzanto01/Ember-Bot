import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';

function StraySpark() {
  return (
    <svg viewBox="0 0 120 72" className="h-[72px] w-[120px]" focusable="false">
      <path
        d="M6 62C26 62 34 48 52 46S78 40 86 30"
        fill="none"
        strokeWidth="3"
        strokeLinecap="round"
        strokeDasharray="0.5 8"
        className="stroke-muted-foreground"
      />
      <circle cx="104" cy="16" r="9" className="fill-flame-core opacity-30" />
      <path
        d="M104 6C106.5 11 111 13 111 18A7 7 0 0 1 97 18C97 14 100 12 101.5 9.5C102 12 103 13 104 13.5C103.5 11 103.5 8.5 104 6Z"
        className="fill-flame"
      />
      <circle cx="104" cy="19" r="2.5" className="fill-flame-core" />
    </svg>
  );
}

/** The `**` page: a spark that drifted off its dotted path, and a way back to Today. */
export default function NotFoundPage() {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col items-center gap-6 text-center">
      <div aria-hidden="true">
        <StraySpark />
      </div>
      <PageHeader
        className="justify-center"
        title={t('notFound.title')}
        lede={t('notFound.lede')}
      />
      <Button asChild block>
        <Link to="/today">{t('notFound.today')}</Link>
      </Button>
    </div>
  );
}
