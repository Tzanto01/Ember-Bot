import { useTranslation } from 'react-i18next';
import { TapLink } from '@/components/auth/busy-button';
import { PageHeader } from '@/components/page-header';
import { FeedbackForm } from '@/components/settings/feedback-form';
import { auth } from '@/lib/services';
import { useStore } from '@/lib/store';

/** `/feedback`, open to everyone: the Settings feedback form, with a way back to sign-in for guests. */
export default function FeedbackPage() {
  const { t } = useTranslation();
  const me = useStore(auth.me);
  return (
    <div className="flex w-full max-w-[40rem] flex-col gap-8 2xl:mx-auto">
      <PageHeader title={t('title.feedback')} lede={t('feedback.page.lede')} />
      <FeedbackForm />
      {!me && (
        <p className="text-muted-foreground">
          <TapLink to="/login">{t('feedback.page.back')}</TapLink>
        </p>
      )}
    </div>
  );
}
