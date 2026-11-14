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
import type { en } from '@/lib/i18n';
import { setNavigator } from '@/lib/navigation';
import { auth } from '@/lib/services';
import { useStore } from '@/lib/store';
import { useTranslation } from 'react-i18next';

type TitleKey = Extract<keyof typeof en, `title.${string}`> | 'pitch.title';

interface RouteHandle {
  title?: TitleKey;
}

type LegalDoc = 'privacy' | 'terms' | 'imprint';

function page(title: TitleKey, load: () => Promise<{ default: ComponentType }>) {
  return {
    handle: { title } satisfies RouteHandle,
    lazy: { Component: async () => (await load()).default },
  };
}

function legal(doc: LegalDoc, title: TitleKey): RouteObject {
  return {
    path: `legal/${doc}`,
    handle: { title } satisfies RouteHandle,
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

async function loadSession() {
  await auth.loadMe().catch(() => null);
  return null;
}

/** Shell for pages open to everyone: the app shell when signed in or in no-account mode, else the public centred one. */
function OpenShell() {
  return useStore(auth.me) ? <AppShell /> : <CenteredShell />;
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
  const { t, i18n } = useTranslation();
  const { pathname } = useLocation();
  const title = useMatches()
    .map((match) => (match.handle as RouteHandle | undefined)?.title)
    .filter(Boolean)
    .at(-1);
  const previousPath = useRef<string | null>(null);

  useEffect(() => {
    if (title) document.title = t('app.titleSuffix', { title: t(title) });
  }, [title, t, i18n.language]);

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
        {t('app.skipToContent')}
      </a>
      <ScrollRestoration />
      <Outlet />
    </>
  );
}

function StartingUp() {
  const { t } = useTranslation();
  return (
    <div role="status" className="grid min-h-dvh place-items-center text-muted-foreground">
      <Spinner className="size-[28px]" />
      <span className="sr-only">{t('app.loading')}</span>
    </div>
  );
}

function RouteError() {
  const { t } = useTranslation();
  return (
    <main id="main" className="grid min-h-dvh place-items-center p-6 text-center">
      <div className="flex max-w-[28rem] flex-col items-center gap-4">
        <h1 className="text-[1.75rem]">{t('app.error.title')}</h1>
        <p className="text-muted-foreground">{t('app.error.body')}</p>
        <Button asChild>
          <a href="/today">{t('app.error.today')}</a>
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
        ...page('pitch.title', () => import('./pages/landing')),
      },
      {
        element: <CenteredShell variant="auth" />,
        children: [
          { path: 'signup', loader: requireGuest, ...page('title.signup', () => import('./pages/signup')) },
          { path: 'login', loader: requireGuest, ...page('title.login', () => import('./pages/login')) },
          {
            path: 'forgot-password',
            loader: requireGuest,
            ...page('title.forgotPassword', () => import('./pages/forgot-password')),
          },
          { path: 'confirm-email', ...page('title.confirmEmail', () => import('./pages/confirm-email')) },
          { path: 'reset-password', ...page('title.resetPassword', () => import('./pages/reset-password')) },
          { path: 'consent', loader: requireSignedIn, ...page('title.consent', () => import('./pages/consent')) },
          {
            path: 'local',
            loader: requireGuest,
            ...page('title.local', () => import('./pages/local-start')),
          },
          { path: 'keep-data', loader: requireSignedIn, ...page('title.keepData', () => import('./pages/keep-data')) },
        ],
      },
      {
        element: <CenteredShell />,
        children: [
          legal('privacy', 'title.privacy'),
          legal('terms', 'title.terms'),
          legal('imprint', 'title.imprint'),
          { path: 'download', ...page('title.download', () => import('./pages/download')) },
          { path: 'moment', ...page('title.moment', () => import('./pages/moment')) },
          { path: 'about', ...page('title.about', () => import('./pages/about')) },
        ],
      },
      {
        element: <OpenShell />,
        loader: loadSession,
        children: [
          { path: 'feedback', ...page('title.feedback', () => import('./pages/feedback')) },
          { path: 'help', ...page('title.help', () => import('./pages/help')) },
          { path: '*', ...page('title.notFound', () => import('./pages/not-found')) },
        ],
      },
      {
        Component: AppShell,
        loader: requireSignedIn,
        children: [
          { path: 'today', ...page('title.today', () => import('./pages/today')) },
          { path: 'history', ...page('title.history', () => import('./pages/history')) },
          { path: 'history/:habitId', ...page('title.history', () => import('./pages/history')) },
          { path: 'habits/new', ...page('title.habitNew', () => import('./pages/habit-new')) },
          { path: 'habits/:id/edit', ...page('title.habitEdit', () => import('./pages/habit-edit')) },
          { path: 'history/year', ...page('title.year', () => import('./pages/year')) },
          { path: 'year', loader: () => redirect('/history/year') },
          { path: 'routines', ...page('title.routines', () => import('./pages/routines')) },
          { path: 'routines/new', ...page('title.routineNew', () => import('./pages/routine-edit')) },
          { path: 'routines/:id/edit', ...page('title.routineEdit', () => import('./pages/routine-edit')) },
          { path: 'settings/:group?', ...page('title.settings', () => import('./pages/settings')) },
          { path: 'whats-new', ...page('title.whatsNew', () => import('./pages/whats-new')) },
          { path: 'moments', ...page('title.moments', () => import('./pages/moments')) },
          { path: 'link/merge', ...page('title.linkMerge', () => import('./pages/link-merge')) },
        ],
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
