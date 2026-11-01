import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { SwPush } from '@angular/service-worker';
import { AuthService } from '../../core/auth.service';
import { Me } from '../../core/models';
import { SettingsPage } from './settings';

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

describe('SettingsPage', () => {
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: SwPush, useValue: { isEnabled: false } },
      ],
    });
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('sends quick successive grace changes one PATCH at a time, in order', async () => {
    TestBed.inject(AuthService).setMe(me);
    const fixture = TestBed.createComponent(SettingsPage);
    fixture.detectChanges();

    const root: HTMLElement = fixture.nativeElement;
    const label = [...root.querySelectorAll('label')].find((l) =>
      l.textContent?.includes('Grace days per week'),
    )!;
    const select = root.querySelector<HTMLSelectElement>(`#${label.htmlFor}`)!;
    const choose = (index: number) => {
      select.selectedIndex = index;
      select.dispatchEvent(new Event('change'));
    };

    choose(2);
    choose(3);
    await tick();

    const first = httpMock.expectOne((r) => r.method === 'PATCH' && r.url === '/api/me');
    expect(first.request.body).toEqual({ graceDaysPerWeek: 2 });
    first.flush({ ...me, graceDaysPerWeek: 2 });

    await tick();
    const second = httpMock.expectOne((r) => r.method === 'PATCH' && r.url === '/api/me');
    expect(second.request.body).toEqual({ graceDaysPerWeek: 3 });
    second.flush({ ...me, graceDaysPerWeek: 3 });

    await tick();
    fixture.detectChanges();
    expect(select.options[select.selectedIndex].textContent).toContain('3 days a week');
  });
});
