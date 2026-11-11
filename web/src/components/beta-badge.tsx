import { Badge } from '@/components/ui/badge';
import { env } from '@/lib/env';

/**
 * A quiet "Beta" pill beside the Ember wordmark, rendered only on the beta deployment: when the API host (web: this
 * page's host) starts with `beta.`.
 */
export function BetaBadge() {
  const host = env.apiBase ? new URL(env.apiBase).hostname : location.hostname;
  if (!host.startsWith('beta.')) return null;
  return (
    <Badge variant="outline" className="font-sans text-[12px] font-semibold">
      Beta
    </Badge>
  );
}
