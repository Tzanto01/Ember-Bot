import { TapLink } from '@/components/auth/busy-button';
import { PageHeader } from '@/components/page-header';
import { FeedbackForm } from '@/components/settings/feedback-form';

/** `/feedback`, public: the Settings feedback form for anyone not signed in. */
export default function FeedbackPage() {
  return (
    <div className="flex w-full flex-col gap-8">
      <PageHeader title="Send feedback" lede="Ember is in beta, and every note helps make it kinder and simpler." />
      <FeedbackForm />
      <p className="text-muted-foreground">
        <TapLink to="/login">Back to sign in</TapLink>
      </p>
    </div>
  );
}
