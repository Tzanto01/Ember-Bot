import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { Habit } from '../../core/models';
import { HabitEditPage } from './habit-edit';

const tick = () => new Promise<void>((resolve) => setTimeout(resolve));

const habit = {
  id: 7,
  name: 'Stretch',
  frequency: 'daily',
  weeklyTarget: null,
  reminderTime: '08:00',
  pausedFrom: null,
  pausedUntil: null,
  pausedToday: false,
  createdAt: '2026-10-01T08:00:00Z',
  startDate: '2026-10-01',
  reminderChannels: ['mobile'],
} as unknown as Habit;

describe('HabitEditPage reminder channels', () => {
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: convertToParamMap({ id: '7' }) } } },
      ],
    });
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it.each([
    ['Discord DM', 'discord'],
    ['Web push', 'webpush'],
  ])('drops mobile when %s is added to a mobile-only habit', async (label, channel) => {
    const fixture = TestBed.createComponent(HabitEditPage);
    await tick();
    httpMock.expectOne('/api/me').flush(null, { status: 401, statusText: 'Unauthorized' });
    await tick();
    httpMock.expectOne('/api/habits/7').flush(habit);
    await tick();
    fixture.detectChanges();

    const box = [...(fixture.nativeElement as HTMLElement).querySelectorAll('label.checkbox')]
      .find((l) => l.textContent?.includes(label))!
      .querySelector<HTMLInputElement>('input')!;
    box.checked = true;
    box.dispatchEvent(new Event('change'));
    await tick();

    const patch = httpMock.expectOne((r) => r.method === 'PATCH' && r.url === '/api/habits/7');
    expect(patch.request.body).toEqual({ reminderChannels: [channel] });
    patch.flush({ ...habit, reminderChannels: [channel] });
    await tick();
  });
});
