import { HttpErrorResponse, HttpEvent, HttpInterceptorFn, HttpRequest } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, last, Observable, switchMap, throwError } from 'rxjs';
import { AuthService } from './auth.service';
import { toApiError } from './problem';

/**
 * Turns every HTTP failure into an `ApiError` and handles the cross-cutting cases:
 * 403 `antiforgery` refreshes the token and retries once; 401 outside `/api/auth/*` while signed in
 * ends the session and routes to `/login?returnUrl=…&reason=session`; 403 `consent_required` routes to
 * `/consent?returnUrl=…`. Those two are marked `handled`. Login 401s pass through as form errors.
 */
export const errorInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthService);
  const router = inject(Router);

  const send = (retried: boolean): Observable<HttpEvent<unknown>> =>
    next(req).pipe(
      catchError((response: unknown) => {
        if (!(response instanceof HttpErrorResponse)) return throwError(() => response);
        const error = toApiError(response);

        if (response.status === 403 && error.type === 'antiforgery' && !retried) {
          return next(new HttpRequest('GET', '/api/auth/antiforgery')).pipe(
            last(),
            catchError(() => throwError(() => error)),
            switchMap(() => send(true)),
          );
        }

        if (response.status === 401 && !req.url.includes('/api/auth/') && auth.me() !== null) {
          auth.clearSession();
          error.handled = true;
          void router.navigate(['/login'], { queryParams: { returnUrl: router.url, reason: 'session' } });
        } else if (response.status === 403 && error.type === 'consent_required') {
          error.handled = true;
          if (!router.url.startsWith('/consent')) {
            void router.navigate(['/consent'], { queryParams: { returnUrl: router.url } });
          }
        }

        return throwError(() => error);
      }),
    );

  return send(false);
};
