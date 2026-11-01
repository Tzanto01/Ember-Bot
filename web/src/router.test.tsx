import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type FetchMock, me, mockFetch } from '@/lib/test-support';

describe('router guards', () => {
  let mock: FetchMock;

  beforeEach(() => {
    vi.resetModules();
    mock = mockFetch();
    vi.stubGlobal('scrollTo', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function visit(path: string) {
    const { routes } = await import('./router');
    const router = createMemoryRouter(routes, { initialEntries: [path] });
    render(
      <QueryClientProvider client={new QueryClient()}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );
    return router;
  }

  const url = (router: Awaited<ReturnType<typeof visit>>) =>
    router.state.location.pathname + router.state.location.search;

  it('sends a signed-out visit to /today to /login with the return URL', async () => {
    const router = await visit('/today');

    (await mock.next('GET', '/api/me')).respond(401);

    expect(await screen.findByRole('heading', { name: 'Welcome back' })).toBeInTheDocument();
    expect(url(router)).toBe('/login?returnUrl=%2Ftoday');
  });

  it('sends a signed-in visit to /login to /today', async () => {
    const router = await visit('/login');

    (await mock.next('GET', '/api/me')).respond(200, me);

    expect(await screen.findByRole('heading', { name: 'Today' })).toBeInTheDocument();
    expect(url(router)).toBe('/today');
  });
});
