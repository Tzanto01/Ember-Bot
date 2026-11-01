import { HttpInterceptorFn } from '@angular/common/http';
import { environment } from '../../environments/environment';

/**
 * Prefixes `/api` calls with `apiBase`: the absolute `{WebOrigin}` in the native build, empty (relative,
 * same origin) in the web build.
 */
export function apiBaseInterceptor(apiBase: string): HttpInterceptorFn {
  return (req, next) =>
    next(apiBase && req.url.startsWith('/api/') ? req.clone({ url: apiBase + req.url }) : req);
}

/** {@link apiBaseInterceptor} with this build's `environment.apiBase`. */
export const buildApiBaseInterceptor = apiBaseInterceptor(environment.apiBase);
