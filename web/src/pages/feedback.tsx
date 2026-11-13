import { useTranslation } from 'react-i18next';
import { TapLink } from '@/components/auth/busy-button';
import { PageHeader } from '@/components/page-header';
import { FeedbackForm } from '@/components/settings/feedback-form';

/** `/feedback`, public: the Settings feedback form for anyone not signed in. */
export default function FeedbackPage() {
  const { t } = useTranslation();
  return (
    <div className="flex w-full flex-col gap-8">
      <PageHeader title={t('title.feedback')} lede={t('feedback.page.lede')} />
      <FeedbackForm />
      <p className="text-muted-foreground">
        <TapLink to="/login">{t('feedback.page.back')}</TapLink>
      </p>
    </div>
  );
}
