import { Routes } from '@angular/router';
import { guestGuard, signedInGuard } from './core/guards';
import { AppLayout } from './layout/app-layout';
import { CenteredLayout } from './layout/centered-layout';

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'today' },
  {
    path: '',
    component: CenteredLayout,
    children: [
      {
        path: 'signup',
        title: 'Create your account · Ember',
        canActivate: [guestGuard],
        loadComponent: () => import('./features/auth/signup').then((m) => m.SignupPage),
      },
      {
        path: 'login',
        title: 'Sign in · Ember',
        canActivate: [guestGuard],
        loadComponent: () => import('./features/auth/login').then((m) => m.LoginPage),
      },
      {
        path: 'forgot-password',
        title: 'Reset your password · Ember',
        canActivate: [guestGuard],
        loadComponent: () => import('./features/auth/forgot-password').then((m) => m.ForgotPasswordPage),
      },
      {
        path: 'confirm-email',
        title: 'Confirm your email · Ember',
        loadComponent: () => import('./features/auth/confirm-email').then((m) => m.ConfirmEmailPage),
      },
      {
        path: 'reset-password',
        title: 'Choose a new password · Ember',
        loadComponent: () => import('./features/auth/reset-password').then((m) => m.ResetPasswordPage),
      },
      {
        path: 'consent',
        title: 'One quick question · Ember',
        canActivate: [signedInGuard],
        loadComponent: () => import('./features/auth/consent').then((m) => m.ConsentPage),
      },
      {
        path: 'legal/privacy',
        title: 'Privacy · Ember',
        loadComponent: () => import('./features/legal/privacy').then((m) => m.PrivacyPage),
      },
      {
        path: 'legal/terms',
        title: 'Terms · Ember',
        loadComponent: () => import('./features/legal/terms').then((m) => m.TermsPage),
      },
      {
        path: 'legal/imprint',
        title: 'Imprint · Ember',
        loadComponent: () => import('./features/legal/imprint').then((m) => m.ImprintPage),
      },
    ],
  },
  {
    path: '',
    component: AppLayout,
    canActivate: [signedInGuard],
    children: [
      {
        path: 'today',
        title: 'Today · Ember',
        loadComponent: () => import('./features/today/today').then((m) => m.TodayPage),
      },
      {
        path: 'history',
        title: 'History · Ember',
        loadComponent: () => import('./features/history/history').then((m) => m.HistoryPage),
      },
      {
        path: 'history/:habitId',
        title: 'History · Ember',
        loadComponent: () => import('./features/history/history').then((m) => m.HistoryPage),
      },
      {
        path: 'habits/new',
        title: 'New habit · Ember',
        loadComponent: () => import('./features/habits/habit-new').then((m) => m.HabitNewPage),
      },
      {
        path: 'habits/:id/edit',
        title: 'Edit habit · Ember',
        loadComponent: () => import('./features/habits/habit-edit').then((m) => m.HabitEditPage),
      },
      {
        path: 'settings',
        title: 'Settings · Ember',
        loadComponent: () => import('./features/settings/settings').then((m) => m.SettingsPage),
      },
      {
        path: 'link/merge',
        title: 'Bring your Discord habits over · Ember',
        loadComponent: () => import('./features/link/merge').then((m) => m.MergePage),
      },
    ],
  },
  {
    path: '**',
    component: CenteredLayout,
    children: [
      {
        path: '',
        title: 'Page not found · Ember',
        loadComponent: () => import('./features/not-found/not-found').then((m) => m.NotFoundPage),
      },
    ],
  },
];
