import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { env } from '@/lib/env';
import { mockFetch } from '@/lib/test-support';
import FeedbackPage from '@/pages/feedback';
import { renderPage } from '@/test-utils';

vi.mock('@/lib/env', async (original) => ({ env: { ...(await original<typeof import('@/lib/env')>()).env } }));
const appInfo = vi.hoisted(() => ({ getInfo: vi.fn() }));
vi.mock('@capacitor/app', () => ({ App: appInfo }));

function open() {
  renderPage('/feedback', FeedbackPage, '/feedback');
  return { user: userEvent.setup(), field: screen.getByRole('textbox', { name: /Your feedback/ }) };
}

const send = (user: ReturnType<typeof userEvent.setup>) => user.click(screen.getByRole('button', { name: 'Send' }));

describe('FeedbackForm', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    env.native = false;
    appInfo.getInfo.mockReset();
  });

  it('renders on the public /feedback page and sends only the trimmed text and platform on the web', async () => {
    const fetch = mockFetch();
    const { user, field } = open();
    expect(screen.getByRole('heading', { level: 1, name: 'Send feedback' })).toBeInTheDocument();

    await user.type(field, '  Dark mode flickers  ');
    await send(user);

    const call = await fetch.next('POST', '/api/feedback');
    expect(call.body).toEqual({ text: 'Dark mode flickers', platform: 'web' });
    call.respond(204);
    await screen.findByText('Thank you, that really helps.');
    expect(field).toHaveValue('');
  });

  it('adds the app version and the android platform when native', async () => {
    env.native = true;
    appInfo.getInfo.mockResolvedValue({ version: '0.9.0-beta.3' });
    const fetch = mockFetch();
    const { user, field } = open();

    await user.type(field, 'Reminder was late');
    await send(user);

    const call = await fetch.next('POST', '/api/feedback');
    expect(call.body).toEqual({ text: 'Reminder was late', platform: 'android', version: '0.9.0-beta.3' });
    call.respond(204);
  });

  it('sends the android platform without a version when the app version is unavailable', async () => {
    env.native = true;
    appInfo.getInfo.mockRejectedValue(new Error('unimplemented'));
    const fetch = mockFetch();
    const { user, field } = open();

    await user.type(field, 'Hello');
    await send(user);

    const call = await fetch.next('POST', '/api/feedback');
    expect(call.body).toEqual({ text: 'Hello', platform: 'android' });
    call.respond(204);
  });

  it('shows the required error and sends nothing for an empty or blank submit', async () => {
    const fetch = mockFetch();
    const { user, field } = open();

    await send(user);
    await user.type(field, '   ');
    await send(user);

    expect(await screen.findByText('Please fill this in.')).toBeInTheDocument();
    expect(fetch.all).toHaveLength(0);
  });

  it('keeps the text and shows a message when sending fails', async () => {
    const fetch = mockFetch();
    const { user, field } = open();

    await user.type(field, 'Please keep me');
    await send(user);
    (await fetch.next('POST', '/api/feedback')).respond(500, { title: 'Server error', status: 500 });

    await screen.findByText("That wasn't sent yet");
    expect(field).toHaveValue('Please keep me');
    expect(screen.queryByText('Thank you, that really helps.')).toBeNull();
  });

  it('explains a rate limit and keeps the text', async () => {
    const fetch = mockFetch();
    const { user, field } = open();

    await user.type(field, 'Again');
    await send(user);
    (await fetch.next('POST', '/api/feedback')).respond(429, { type: 'rate_limited', status: 429 }, { 'Retry-After': '60' });

    await screen.findByText(/a lot of feedback in a short time/);
    await waitFor(() => expect(field).toHaveValue('Again'));
  });
});
