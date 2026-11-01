import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { BusyButton, TapLink } from '@/components/auth/busy-button';
import { ShieldLeaf } from '@/components/auth/illustrations';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Notice } from '@/components/ui/notice';
import { asApiError, problemToMessage } from '@/lib/problem';
import { safeReturnUrl } from '@/lib/return-url';
import { api, auth } from '@/lib/services';
import { useStore } from '@/lib/store';

/** `/consent`: health-data consent for the current privacy policy version. */
export default function ConsentPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const returnUrl = safeReturnUrl(params.get('returnUrl'));
  const me = useStore(auth.me);
  const policyChanged = !!me?.consent.given && auth.needsConsent();
  const [problem, setProblem] = useState<string | null>(null);

  const agree = useMutation({
    mutationFn: async (policyVersion: string) => {
      await api.giveConsent(policyVersion);
      await auth.loadMe(true);
    },
    onSuccess: () => {
      void navigate(returnUrl.startsWith('/consent') ? '/today' : returnUrl);
    },
    onError: (error) => {
      const apiError = asApiError(error);
      if (!apiError.handled) setProblem(problemToMessage(apiError).message);
    },
  });

  function give() {
    if (agree.isPending || !me) return;
    setProblem(null);
    agree.mutate(me.consent.currentPolicyVersion);
  }

  return (
    <>
      <div className="flex items-start justify-between gap-4">
        <PageHeader title={policyChanged ? 'Our privacy policy changed' : 'One quick question'} />
        <ShieldLeaf />
      </div>
      <div className="flex flex-col gap-3">
        <p>
          Habit names, check-ins and low days can say something about your health (think "take my meds" or "sleep 8
          hours"). Under the GDPR (Article 9) that counts as health data, so Ember asks before saving it.
        </p>
        <p>
          Ember stores it only to run your habit tracker for you. It's never shared or sold. You can change your mind
          any time by deleting your account in Settings, which removes everything.
        </p>
        <p>
          <TapLink to="/legal/privacy">Read the privacy policy</TapLink>
        </p>
      </div>

      {problem && <Notice tone="notice">{problem}</Notice>}

      <div className="flex flex-col gap-3">
        <BusyButton type="button" block busy={agree.isPending} busyLabel="Saving…" onClick={give}>
          I agree
        </BusyButton>
        <Button asChild variant="ghost" block>
          <Link to="/settings">Not now</Link>
        </Button>
        <p className="text-center text-[14px] text-muted-foreground">
          Without it you can still read your history, change settings, and export or delete your data.
        </p>
      </div>
    </>
  );
}
