import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { apiBaseInterceptor } from './api-base.interceptor';

describe('apiBaseInterceptor', () => {
  function setup(base: string) {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([apiBaseInterceptor(base)])),
        provideHttpClientTesting(),
      ],
    });
    return { http: TestBed.inject(HttpClient), mock: TestBed.inject(HttpTestingController) };
  }

  it('sends /api calls to the configured origin in the native build', () => {
    const { http, mock } = setup('https://ember.example');

    http.get('/api/habits').subscribe();

    mock.expectOne('https://ember.example/api/habits').flush([]);
    mock.verify();
  });

  it('leaves non-API paths relative', () => {
    const { http, mock } = setup('https://ember.example');

    http.get('/legal/x.md').subscribe();

    mock.expectOne('/legal/x.md').flush('');
    mock.verify();
  });

  it('keeps /api calls relative when the base is empty (web build)', () => {
    const { http, mock } = setup('');

    http.get('/api/habits').subscribe();

    mock.expectOne('/api/habits').flush([]);
    mock.verify();
  });
});
