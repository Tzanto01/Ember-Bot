import { type ComponentType, type MouseEvent, useEffect, useRef } from 'react';
import {
  createBrowserRouter,
  type LoaderFunctionArgs,
  Outlet,
  redirect,
  type RouteObject,
  ScrollRestoration,
  useLocation,
  useMatches,
} from 'react-router';
import { AppShell } from '@/components/app-shell';
import { CenteredShell } from '@/components/centered-shell';
import { Spinner } from '@/components/spinner';
import { Button } from '@/components/ui/button';
import { env } from '@/lib/env';
import { guest, signedIn } from '@/lib/guards';
import { setNavigator } from '@/lib/navigation';

interface RouteHandle {
  title?: string;
}

type LegalDoc = 'privacy' | 'terms' | 'imprint';

function page(title: string, load: () => Promise<{ default: ComponentType }>) {
  return {
    handle: { title: `${title} · Ember` } satisfies RouteHandle,
    lazy: { Component: async () => (await load()).default },
  };
}

function legal(doc: LegalDoc, title: string): RouteObject {
  return {
    path: `legal/${doc}`,
    handle: { title: `${title} · Ember` } satisfies RouteHandle,
    lazy: {
      element: async () => {
        const { default: LegalPage } = await import('./pages/legal');
        return <LegalPage doc={doc} />;
      },
    },
  };
}

async function requireSignedIn({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const target = await signedIn(url.pathname + url.search);
  return target ? redirect(target) : null;
}

async function requireGuest({ request }: LoaderFunctionArgs) {
  if (new URL(request.url).searchParams.get('reason') === 'offline') return null;
  const target = await guest();
  return target ? redirect(target) : null;
}

function landingOrToday(args: LoaderFunctionArgs) {
  return env.native ? redirect('/today') : requireGuest(args);
}

function focusPageHeading(): void {
  const heading = document.querySelector<HTMLElement>('#main h1');
  if (!heading) return;
  if (!heading.hasAttribute('tabindex')) heading.setAttribute('tabindex', '-1');
  heading.focus({ preventScroll: true });
}

function skipToMain(event: MouseEvent<HTMLAnchorElement>): void {
  event.preventDefault();
  document.getElementById('main')?.focus();
}

/** Root: skip link, scroll restoration, the page title, and focus on the page `h1` after each route change. */
function Root() {
  const { pathname } = useLocation();
  const title = useMatches()
    .map((match) => (match.handle as RouteHandle | undefined)?.title)
    .filter(Boolean)
    .at(-1);
  const previousPath = useRef<string | null>(null);

  useEffect(() => {
    if (title) document.title = title;
  }, [title]);

  useEffect(() => {
    if (previousPath.current !== null && previousPath.current !== pathname) focusPageHeading();
    previousPath.current = pathname;
  }, [pathname]);

  return (
    <>
      <a
        href="#main"
        onClick={skipToMain}
        className="sr-only z-50 rounded-md bg-background px-4 py-3 font-medium text-foreground focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
      >
        Skip to content
      </a>
      <ScrollRestoration />
      <Outlet />
    </>
  );
}

function StartingUp() {
  return (
    <div role="status" className="grid min-h-dvh place-items-center text-muted-foreground">
      <Spinner className="size-[28px]" />
      <span className="sr-only">Loading…</span>
    </div>
  );
}

function RouteError() {
  return (
    <main id="main" className="grid min-h-dvh place-items-center p-6 text-center">
      <div className="flex max-w-[28rem] flex-col items-center gap-4">
        <h1 className="text-[28px]">Something went wrong</h1>
        <p className="text-muted-foreground">Ember hit a snag on this page. Nothing you saved is lost.</p>
        <Button asChild>
          <a href="/today">Go to Today</a>
        </Button>
      </div>
    </main>
  );
}

/** Every route of the app with its page title; guards run as loaders. */
export const routes: RouteObject[] = [
  {
    path: '/',
    Component: Root,
    HydrateFallback: StartingUp,
    ErrorBoundary: RouteError,
    children: [
      {
        index: true,
        loader: landingOrToday,
        ...page('A calm place for your habits', () => import('./pages/landing')),
      },
      {
        element: <CenteredShell variant="auth" />,
        children: [
          { path: 'signup', loader: requireGuest, ...page('Create your account', () => import('./pages/signup')) },
          { path: 'login', loader: requireGuest, ...page('Sign in', () => import('./pages/login')) },
          {
            path: 'forgot-password',
            loader: requireGuest,
            ...page('Reset your password', () => import('./pages/forgot-password')),
          },
          { path: 'confirm-email', ...page('Confirm your email', () => import('./pages/confirm-email')) },
          { path: 'reset-password', ...page('Choose a new password', () => import('./pages/reset-password')) },
          { path: 'consent', loader: requireSignedIn, ...page('One quick question', () => import('./pages/consent')) },
          {
            path: 'local',
            loader: requireGuest,
            ...page('Use Ember without an account', () => import('./pages/local-start')),
          },
          { path: 'keep-data', loader: requireSignedIn, ...page('Keep your data', () => import('./pages/keep-data')) },
        ],
      },
      {
        element: <CenteredShell />,
        children: [
          legal('privacy', 'Privacy'),
          legal('terms', 'Terms'),
          legal('imprint', 'Imprint'),
          { path: 'download', ...page('Get Ember', () => import('./pages/download')) },
          { path: 'feedback', ...page('Send feedback', () => import('./pages/feedback')) },
          { path: 'moment', ...page('A moment', () => import('./pages/moment')) },
          { path: 'help', ...page('Help right now', () => import('./pages/help')) },
        ],
      },
      {
        Component: AppShell,
        loader: requireSignedIn,
        children: [
          { path: 'today', ...page('Today', () => import('./pages/today')) },
          { path: 'history', ...page('History', () => import('./pages/history')) },
          { path: 'history/:habitId', ...page('History', () => import('./pages/history')) },
          { path: 'habits/new', ...page('New habit', () => import('./pages/habit-new')) },
          { path: 'habits/:id/edit', ...page('Edit habit', () => import('./pages/habit-edit')) },
          { path: 'history/year', ...page('Your year', () => import('./pages/year')) },
          { path: 'year', loader: () => redirect('/history/year') },
          { path: 'routines', ...page('Routines', () => import('./pages/routines')) },
          { path: 'routines/new', ...page('New routine', () => import('./pages/routine-edit')) },
          { path: 'routines/:id/edit', ...page('Edit routine', () => import('./pages/routine-edit')) },
          { path: 'settings/:group?', ...page('Settings', () => import('./pages/settings')) },
          { path: 'whats-new', ...page("What's new", () => import('./pages/whats-new')) },
          { path: 'link/merge', ...page('Bring your Discord habits over', () => import('./pages/link-merge')) },
        ],
      },
      {
        element: <CenteredShell />,
        children: [{ path: '*', ...page('Page not found', () => import('./pages/not-found')) }],
      },
    ],
  },
];

/** Creates the browser router and registers it as the app's navigator (call once). */
export function createAppRouter() {
  const router = createBrowserRouter(routes);
  setNavigator((path) => void router.navigate(path));
  return router;
}
