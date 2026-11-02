import { expect, type APIRequestContext } from '@playwright/test';

/**
 * Waits (bounded) for the latest email to `email` in the test host's outbox
 * (`GET /test/outbox` → `{ to, subject, links }`) and returns the link containing `pathFragment`
 * (for example `/confirm-email?`) as path plus query, so it works against the app's base URL.
 */
export async function findOutboxLink(
  request: APIRequestContext,
  email: string,
  pathFragment: string,
): Promise<string> {
  let link: string | undefined;
  await expect
    .poll(
      async () => {
        const response = await request.get(`/test/outbox?email=${encodeURIComponent(email)}`);
        if (!response.ok()) return undefined;
        const mail: { links: string[] } = await response.json();
        link = mail.links.find((candidate) => candidate.includes(pathFragment));
        return link;
      },
      { message: `outbox link containing ${pathFragment} for ${email}`, timeout: 15_000 },
    )
    .toBeDefined();
  const url = new URL(link ?? '');
  return url.pathname + url.search;
}
