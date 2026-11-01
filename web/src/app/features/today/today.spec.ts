import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { AuthService } from '../../core/auth.service';
import { Me } from '../../core/models';
import { TodayPage } from './today';

const me: Me = {
  id: 'u1',
  email: 'a@example.test',
  emailConfirmed: true,
  hasPassword: true,
  discord: { linked: false, id: null },
  timezone: 'Europe/Berlin',
  timezoneSet: true,
  localToday: '2026-11-01',
  graceDaysPerWeek: 1,
  leaderboardOptIn: false,
  consent: { given: true, policyVersion: '1', currentPolicyVersion: '1' },
  dmReminders: { paused: false },
};

const tick = () => new Promise<void>((resolve) => setTimeout(resolve));

describe('TodayPage', () => {
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('looks up low days for the local day reloaded from the server, not the stale cached one', async () => {
    TestBed.inject(AuthService).setMe(me);
    const fixture = TestBed.createComponent(TodayPage);

    await tick();
    httpMock.expectNone('/api/low-days');
    httpMock
      .expectOne((r) => r.method === 'GET' && r.url === '/api/me')
      .flush({
        ...me,
        localToday: '2026-11-02',
      });

    await tick();
    const lowDays = httpMock.expectOne((r) => r.method === 'GET' && r.url === '/api/low-days');
    expect(lowDays.request.params.get('from')).toBe('2026-11-02');
    expect(lowDays.request.params.get('to')).toBe('2026-11-02');
    lowDays.flush([]);
    httpMock.expectOne('/api/habits').flush([]);
    httpMock.expectOne('/api/stats/weekly').flush({
      totalDone: 0,
      totalPossible: 0,
      headline: '',
      footer: '',
      habits: [],
    });

    await tick();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toMatch(/2 November|November 2/);
  });
});
