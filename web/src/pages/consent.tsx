import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
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
  const { t } = useTranslation();
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
        <PageHeader className="hyphens-auto" title={policyChanged ? t('consent.changed') : t('consent.title')} />
        <ShieldLeaf />
      </div>
      <div className="flex flex-col gap-3">
        <p>{t('consent.what')}</p>
        <p>{t('consent.why')}</p>
        <p className="hyphens-auto">
          <TapLink to="/legal/privacy">{t('consent.readPolicy')}</TapLink>
        </p>
      </div>

      {problem && <Notice tone="notice">{problem}</Notice>}

      <div className="flex flex-col gap-3">
        <p className="text-center text-[0.875rem] text-muted-foreground">{t('auth.age')}</p>
        <BusyButton type="button" block busy={agree.isPending} busyLabel={t('auth.saving')} onClick={give}>
          {t('consent.agree')}
        </BusyButton>
        <Button asChild variant="ghost" block>
          <Link to="/settings">{t('consent.notNow')}</Link>
        </Button>
        <p className="text-center text-[0.875rem] text-muted-foreground">
          {t('consent.without')}
        </p>
      </div>
    </>
  );
}
