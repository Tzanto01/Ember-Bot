import {
  ApplicationConfig,
  inject,
  isDevMode,
  provideAppInitializer,
  provideBrowserGlobalErrorListeners,
} from '@angular/core';
import { provideHttpClient, withInterceptors, withXsrfConfiguration } from '@angular/common/http';
import { provideRouter, withInMemoryScrolling } from '@angular/router';
import { provideServiceWorker } from '@angular/service-worker';

import { routes } from './app.routes';
import { AuthService } from './core/auth.service';
import { environment } from '../environments/environment';
import { buildApiBaseInterceptor } from './core/api-base.interceptor';
import { DeviceSync, reminderTriggerInterceptor } from './core/device-sync';
import { errorInterceptor } from './core/error.interceptor';
import { bearerInterceptor } from './core/native/bearer.interceptor';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes, withInMemoryScrolling({ scrollPositionRestoration: 'enabled', anchorScrolling: 'enabled' })),
    provideHttpClient(
      withInterceptors(
        environment.native
          ? [errorInterceptor, reminderTriggerInterceptor, bearerInterceptor, buildApiBaseInterceptor]
          : [errorInterceptor],
      ),
      withXsrfConfiguration({ cookieName: 'XSRF-TOKEN', headerName: 'X-XSRF-TOKEN' }),
    ),
    provideAppInitializer(() => inject(AuthService).refreshAntiforgery()),
    provideAppInitializer(() => inject(DeviceSync).start()),
    provideServiceWorker('ngsw-worker.js', {
      enabled: !isDevMode() && !environment.native,
      registrationStrategy: 'registerWhenStable:30000',
    }),
  ],
};
