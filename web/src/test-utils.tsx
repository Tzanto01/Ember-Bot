import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import type { ComponentType } from 'react';
import { createMemoryRouter, RouterProvider, useLocation } from 'react-router';
import i18n from '@/lib/i18n';

function Elsewhere() {
  return <h1>{useLocation().pathname}</h1>;
}

/**
 * Test helper: renders `Page` on `path` inside `<main id="main">` with a fresh query client, starting at `url`.
 * Any other path renders its pathname as the `h1`. Returns the memory router, whose `state.location` is the address bar.
 */
export function renderPage(path: string, Page: ComponentType, url: string) {
  const router = createMemoryRouter(
    [
      {
        path,
        element: (
          <main id="main">
            <Page />
          </main>
        ),
      },
      { path: '*', Component: Elsewhere },
    ],
    { initialEntries: [url] },
  );
  render(
    <QueryClientProvider client={new QueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}

/** Test helper: shows the app in German until the test ends (`test-setup.ts` switches back to English). */
export async function inGerman(): Promise<void> {
  await i18n.changeLanguage('de');
}
