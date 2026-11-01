import { expect, type APIRequestContext } from '@playwright/test';

function collectStrings(value: unknown, into: string[]): void {
  if (typeof value === 'string') into.push(value);
  else if (Array.isArray(value)) value.forEach((item) => collectStrings(item, into));
  else if (value && typeof value === 'object') Object.values(value).forEach((item) => collectStrings(item, into));
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * The only place that knows the `/test/outbox` response shape: finds the first link containing
 * `pathFragment` (for example `/confirm-email?`) anywhere in the JSON and returns it as a
 * path plus query that works against the app's base URL.
 */
async function readOutboxLink(
  request: APIRequestContext,
  email: string,
  pathFragment: string,
): Promise<string | null> {
  const response = await request.get(`/test/outbox?email=${encodeURIComponent(email)}`);
  if (!response.ok()) return null;
  const text = await response.text();
  const strings: string[] = [];
  try {
    collectStrings(JSON.parse(text), strings);
  } catch {
    strings.push(text);
  }
  const token = new RegExp(`[^\\s"'<>]*${escapeRegExp(pathFragment)}[^\\s"'<>]*`);
  for (const candidate of strings) {
    const match = candidate.replace(/&amp;/g, '&').match(token);
    if (!match) continue;
    const url = new URL(match[0].replace(/^href=/, ''), 'http://localhost');
    return url.pathname + url.search;
  }
  return null;
}

/** Waits (bounded) for the email to reach the test outbox and returns the link as path plus query. */
export async function findOutboxLink(
  request: APIRequestContext,
  email: string,
  pathFragment: string,
): Promise<string> {
  let link: string | null = null;
  await expect
    .poll(async () => (link = await readOutboxLink(request, email, pathFragment)), {
      message: `outbox link containing ${pathFragment} for ${email}`,
      timeout: 15_000,
    })
    .not.toBeNull();
  return link as unknown as string;
}
