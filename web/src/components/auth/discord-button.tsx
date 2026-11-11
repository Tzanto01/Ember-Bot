import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { env } from '@/lib/env';
import { api } from '@/lib/services';

/**
 * "or" separator and the Discord sign-in link. In the native app it is a button calling `onNative`, and renders nothing
 * without it.
 */
export function DiscordButton({
  returnUrl = '/today',
  onNative,
  children,
}: {
  returnUrl?: string;
  onNative?: () => void;
  children: ReactNode;
}) {
  if (env.native) {
    if (!onNative) return null;
    return (
      <>
        <Separator>or</Separator>
        <Button type="button" variant="secondary" block onClick={onNative}>
          {children}
        </Button>
      </>
    );
  }
  return (
    <>
      <Separator>or</Separator>
      <Button asChild variant="secondary" block>
        <a href={api.discordLoginUrl(returnUrl)}>{children}</a>
      </Button>
    </>
  );
}
