import { useTranslation } from 'react-i18next';
import { TapLink } from '@/components/auth/busy-button';
import { CrisisLines } from '@/components/moment/crisis-lines';
import { PageHeader } from '@/components/page-header';

/** `/help`, public: crisis lines for the picked region, a door to the moment flow and a way back. */
export default function HelpPage() {
  const { t } = useTranslation();
  return (
    <div className="flex w-full max-w-[40rem] flex-col gap-6">
      <PageHeader title={t('title.help')} lede={t('help.lede')} />
      <CrisisLines />
      <div className="flex flex-wrap gap-x-6">
        <TapLink to="/moment">{t('help.moment')}</TapLink>
        <TapLink to="/">{t('help.back')}</TapLink>
      </div>
    </div>
  );
}
