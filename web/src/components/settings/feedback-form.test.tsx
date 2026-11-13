import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { env } from '@/lib/env';
import { auth, localMode } from '@/lib/services';
import { me, mockFetch } from '@/lib/test-support';
import FeedbackPage from '@/pages/feedback';
import { renderPage } from '@/test-utils';

vi.mock('@/lib/env', async (original) => ({ env: { ...(await original<typeof import('@/lib/env')>()).env } }));
const appInfo = vi.hoisted(() => ({ getInfo: vi.fn() }));
vi.mock('@capacitor/app', () => ({ App: appInfo }));

function open() {
  renderPage('/feedback', FeedbackPage, '/feedback');
  return {
    user: userEvent.setup(),
    title: screen.getByRole('textbox', { name: /Title/ }),
    field: screen.getByRole('textbox', { name: /Description/ }),
  };
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
    const { user, field, title } = open();
    expect(screen.getByRole('heading', { level: 1, name: 'Send feedback' })).toBeInTheDocument();

    await user.type(title, 'Note');

    await user.type(field, '  Dark mode flickers  ');
    await send(user);

    const call = await fetch.next('POST', '/api/feedback');
    expect(call.body).toEqual({ title: 'Note', text: 'Dark mode flickers', platform: 'web' });
    call.respond(204);
    await screen.findByText('Thank you, that really helps.');
    expect(screen.queryByRole('button', { name: 'Send' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Send more feedback' })).toHaveFocus();

    await user.click(screen.getByRole('button', { name: 'Send more feedback' }));

    expect(screen.getByRole('textbox', { name: /Title/ })).toHaveFocus();
    expect(screen.getByRole('textbox', { name: /Title/ })).toHaveValue('');
    expect(screen.getByRole('textbox', { name: /Description/ })).toHaveValue('');
    expect(screen.queryByText('Please fill this in.')).toBeNull();
  });

  it('adds the app version and the android platform when native', async () => {
    env.native = true;
    appInfo.getInfo.mockResolvedValue({ version: '0.9.0-beta.3' });
    const fetch = mockFetch();
    const { user, field, title } = open();

    await user.type(title, 'Note');

    await user.type(field, 'Reminder was late');
    await send(user);

    const call = await fetch.next('POST', '/api/feedback');
    expect(call.body).toEqual({ title: 'Note', text: 'Reminder was late', platform: 'android', version: '0.9.0-beta.3' });
    call.respond(204);
  });

  it('sends the android platform without a version when the app version is unavailable', async () => {
    env.native = true;
    appInfo.getInfo.mockRejectedValue(new Error('unimplemented'));
    const fetch = mockFetch();
    const { user, field, title } = open();

    await user.type(title, 'Note');

    await user.type(field, 'Hello');
    await send(user);

    const call = await fetch.next('POST', '/api/feedback');
    expect(call.body).toEqual({ title: 'Note', text: 'Hello', platform: 'android' });
    call.respond(204);
  });

  it('shows the required error and sends nothing for an empty or blank submit', async () => {
    const fetch = mockFetch();
    const { user, field } = open();

    await send(user);
    await user.type(field, '   ');
    await send(user);

    await waitFor(() => expect(field).toHaveAccessibleDescription(/Please fill this in\./));
    expect(fetch.all).toHaveLength(0);
  });

  it('asks for a title before sending', async () => {
    const fetch = mockFetch();
    const { user, field, title } = open();

    await user.type(field, 'Only a description');
    await send(user);

    await waitFor(() => expect(title).toHaveAccessibleDescription(/Please fill this in\./));
    expect(title).toHaveFocus();
    expect(fetch.all).toHaveLength(0);
  });

  it('keeps the text and shows a message when sending fails', async () => {
    const fetch = mockFetch();
    const { user, field, title } = open();

    await user.type(title, 'Note');

    await user.type(field, 'Please keep me');
    await send(user);
    (await fetch.next('POST', '/api/feedback')).respond(500, { title: 'Server error', status: 500 });

    await screen.findByText("That wasn't sent yet");
    expect(field).toHaveValue('Please keep me');
    expect(screen.queryByText('Thank you, that really helps.')).toBeNull();
  });

  it('explains a rate limit and keeps the text', async () => {
    const fetch = mockFetch();
    const { user, field, title } = open();

    await user.type(title, 'Note');

    await user.type(field, 'Again');
    await send(user);
    (await fetch.next('POST', '/api/feedback')).respond(429, { type: 'rate_limited', status: 429 }, { 'Retry-After': '60' });

    await screen.findByText(/a lot of feedback in a short time/);
    await waitFor(() => expect(field).toHaveValue('Again'));
  });

  describe('pictures', () => {
    const webp = new Blob(['webp'], { type: 'image/webp' });

    function pick(...names: string[]) {
      const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
      return userEvent.upload(
        input,
        names.map((name) => new File(['raw'], name, { type: 'image/png' })),
      );
    }

    beforeEach(() => {
      auth.setMe(me);
      vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 4000, height: 3000, close: vi.fn() })));
      vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
        drawImage: vi.fn(),
        fillRect: vi.fn(),
      } as unknown as CanvasRenderingContext2D);
      vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((done) => done(webp));
      let url = 0;
      vi.spyOn(URL, 'createObjectURL').mockImplementation(() => `blob:picture-${++url}`);
      vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    });

    afterEach(() => {
      vi.restoreAllMocks();
      auth.clearSession();
      localMode.mode.set('account');
    });

    it('offers neither pictures nor the anonymous switch when signed out', () => {
      auth.clearSession();
      open();
      expect(screen.queryByRole('button', { name: /Add pictures/ })).toBeNull();
      expect(screen.queryByRole('switch', { name: 'Send feedback anonymously' })).toBeNull();
      expect(screen.getByText('With an account you can add pictures too.')).toBeInTheDocument();
    });

    it('offers neither pictures nor the anonymous switch in no-account mode', () => {
      localMode.mode.set('local');
      open();
      expect(screen.queryByRole('button', { name: /Add pictures/ })).toBeNull();
      expect(screen.queryByRole('switch', { name: 'Send feedback anonymously' })).toBeNull();
    });

    it('sends anonymous: true when the anonymous switch is on', async () => {
      const fetch = mockFetch();
      const { user, field, title } = open();

      await user.type(title, 'Note');
      await user.type(field, 'No name please');
      await user.click(screen.getByRole('switch', { name: 'Send feedback anonymously' }));
      await send(user);

      const call = await fetch.next('POST', '/api/feedback');
      expect(call.body).toEqual({ title: 'Note', text: 'No name please', platform: 'web', anonymous: true });
      call.respond(204);
      await screen.findByText('Thank you, that really helps.');
    });

    it('lists added pictures with the count and size, and removes one again', async () => {
      mockFetch();
      const { user } = open();
      expect(screen.getByRole('button', { name: /Add pictures/ })).toBeInTheDocument();

      await pick('one.png', 'two.png');

      expect(await screen.findByRole('img', { name: 'Picture 2' })).toBeInTheDocument();
      expect(screen.getByText('2 of 5 pictures · 1 KB of 10 MB')).toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: 'Remove picture 1' }));

      expect(screen.getAllByRole('img', { name: /Picture/ })).toHaveLength(1);
      expect(screen.queryByRole('button', { name: 'Remove picture 2' })).toBeNull();
      expect(screen.getByText('1 of 5 pictures · 1 KB of 10 MB')).toBeInTheDocument();
    });

    it('refuses a sixth picture with a message', async () => {
      mockFetch();
      open();

      await pick('1.png', '2.png', '3.png', '4.png');
      await screen.findByRole('img', { name: 'Picture 4' });
      await pick('5.png', '6.png');

      expect(await screen.findByText(/Only 1 more picture fits/)).toBeInTheDocument();
      expect(screen.getAllByRole('img', { name: /Picture/ })).toHaveLength(5);
      expect(screen.getByText('5 of 5 pictures · 1 KB of 10 MB')).toBeInTheDocument();
    });

    it('sends the pictures as plain base64 after checking the session, then clears them', async () => {
      const fetch = mockFetch();
      const { user, field, title } = open();

      await user.type(title, 'Note');

      await user.type(field, 'See the screenshot');
      await pick('screen.png');
      await screen.findByRole('img', { name: 'Picture 1' });
      await send(user);

      (await fetch.next('GET', '/api/me')).respond(200, me);
      const call = await fetch.next('POST', '/api/feedback');
      expect(call.body).toEqual({ title: 'Note', text: 'See the screenshot', platform: 'web', images: [btoa('webp')] });
      call.respond(204);
      await screen.findByText('Thank you, that really helps.');
      await user.click(screen.getByRole('button', { name: 'Send more feedback' }));
      expect(screen.queryByRole('img', { name: /Picture/ })).toBeNull();
      expect(screen.getByRole('textbox', { name: /Description/ })).toHaveValue('');
    });

    it('retries once with a fresh session when the server took the pictures as too large', async () => {
      const fetch = mockFetch();
      const { user, field, title } = open();

      await user.type(title, 'Note');

      await user.type(field, 'Two tries');
      await pick('big.png');
      await screen.findByRole('img', { name: 'Picture 1' });
      await send(user);

      (await fetch.next('GET', '/api/me')).respond(200, me);
      (await fetch.next('POST', '/api/feedback')).respond(413);
      (await fetch.next('GET', '/api/me')).respond(200, me);
      (await fetch.next('POST', '/api/feedback')).respond(204);

      await screen.findByText('Thank you, that really helps.');
    });

    it('shows the server message about the pictures and keeps them', async () => {
      const fetch = mockFetch();
      const { user, field, title } = open();

      await user.type(title, 'Note');

      await user.type(field, 'Broken picture');
      await pick('odd.png');
      await screen.findByRole('img', { name: 'Picture 1' });
      await send(user);

      (await fetch.next('GET', '/api/me')).respond(200, me);
      (await fetch.next('POST', '/api/feedback')).respond(400, {
        type: 'validation',
        status: 400,
        errors: { images: ["One of these isn't a picture Ember can use."] },
      });

      expect(await screen.findByText("One of these isn't a picture Ember can use.")).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Add pictures/ })).toHaveAccessibleDescription(
        /One of these isn't a picture Ember can use\./,
      );
      expect(screen.getByRole('img', { name: 'Picture 1' })).toBeInTheDocument();
    });
  });
});
