import { HttpErrorResponse, HttpInterceptorFn, HttpRequest } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, from, switchMap, throwError } from 'rxjs';
import { environment } from '../../../environments/environment';
import { SKIP_BEARER, TokenStore } from './token-store';

/** Only this build's API gets the token: a relative `/api` URL or `{apiBase}/api/…`. */
function isOwnApi(url: string): boolean {
  return url.startsWith('/api/') || (!!environment.apiBase && url.startsWith(`${environment.apiBase}/api/`));
}

function authorized(req: HttpRequest<unknown>, token: string | null): HttpRequest<unknown> {
  return token ? req.clone({ setHeaders: { Authorization: `Bearer ${token}` } }) : req;
}

/**
 * Native build only: sends `Authorization: Bearer` (never cookies) on `/api` calls. A 401 outside `/api/auth/*`
 * refreshes once (single flight in {@link TokenStore}) and retries; if the refresh fails the 401 passes on and
 * the error interceptor ends the session.
 */
export const bearerInterceptor: HttpInterceptorFn = (req, next) => {
  if (req.context.get(SKIP_BEARER) || !isOwnApi(req.url)) return next(req);
  const tokens = inject(TokenStore);
  return next(authorized(req, tokens.accessToken)).pipe(
    catchError((error: unknown) => {
      if (
        !(error instanceof HttpErrorResponse) ||
        error.status !== 401 ||
        req.url.includes('/api/auth/')
      ) {
        return throwError(() => error);
      }
      return from(tokens.refresh()).pipe(
        switchMap((ok) =>
          ok ? next(authorized(req, tokens.accessToken)) : throwError(() => error),
        ),
      );
    }),
  );
};
