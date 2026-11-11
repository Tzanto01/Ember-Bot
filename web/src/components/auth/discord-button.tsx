import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { env } from '@/lib/env';
import { api } from '@/lib/services';

/** "or" separator and the Discord sign-in link (web build only; renders nothing in the native app). */
export function DiscordButton({ returnUrl = '/today', children }: { returnUrl?: string; children: ReactNode }) {
  if (env.native) return null;
  return (
    <>
      <Separator>or</Separator>
      <Button asChild variant="secondary" block>
        <a href={api.discordLoginUrl(returnUrl)}>{children}</a>
      </Button>
    </>
  );
}
