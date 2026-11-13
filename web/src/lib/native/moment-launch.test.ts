import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { listenForMoment, takeMomentLaunch } from './moment-launch';
import type { EmberWidgetPlugin } from './widget';

const loader = (plugin: Partial<EmberWidgetPlugin>) =>
  vi.fn(async () => ({ EmberWidget: plugin as EmberWidgetPlugin }));

describe('moment-launch', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/today');
  });

  afterEach(() => {
    window.history.replaceState(null, '', '/');
  });

  describe('takeMomentLaunch', () => {
    it('does nothing on the web and never loads the plugin', async () => {
      const load = loader({});

      expect(await takeMomentLaunch(false, load)).toBe(false);

      expect(load).not.toHaveBeenCalled();
      expect(window.location.pathname).toBe('/today');
    });

    it('replaces the URL with /moment without adding a history entry', async () => {
      const length = window.history.length;
      const load = loader({ takeLaunchAction: async () => ({ action: 'moment' }) });

      expect(await takeMomentLaunch(true, load)).toBe(true);

      expect(window.location.pathname).toBe('/moment');
      expect(window.history.length).toBe(length);
    });

    it('leaves the URL when no action is pending', async () => {
      const load = loader({ takeLaunchAction: async () => ({ action: null }) });

      expect(await takeMomentLaunch(true, load)).toBe(false);

      expect(window.location.pathname).toBe('/today');
    });

    it('returns false when the native plugin lacks the method', async () => {
      expect(await takeMomentLaunch(true, loader({}))).toBe(false);

      expect(window.location.pathname).toBe('/today');
    });

    it('returns false without throwing when the call is unimplemented', async () => {
      const load = loader({
        takeLaunchAction: () => Promise.reject(new Error('UNIMPLEMENTED')),
      });

      expect(await takeMomentLaunch(true, load)).toBe(false);

      expect(window.location.pathname).toBe('/today');
    });

    it('returns false without throwing when loading the plugin fails', async () => {
      const load = vi.fn(() => Promise.reject(new Error('no plugin')));

      expect(await takeMomentLaunch(true, load)).toBe(false);
    });
  });

  describe('listenForMoment', () => {
    it('does nothing on the web', async () => {
      const load = loader({});

      await listenForMoment(false, vi.fn(), load);

      expect(load).not.toHaveBeenCalled();
    });

    it('calls open on every openMoment event natively', async () => {
      const open = vi.fn();
      const addListener = vi.fn(async (_event: string, _listener: () => void) => ({
        remove: async () => undefined,
      }));
      const load = loader({ addListener: addListener as EmberWidgetPlugin['addListener'] });

      await listenForMoment(true, open, load);

      expect(addListener).toHaveBeenCalledTimes(1);
      expect(addListener.mock.calls[0][0]).toBe('openMoment');
      expect(open).not.toHaveBeenCalled();
      addListener.mock.calls[0][1]();
      addListener.mock.calls[0][1]();
      expect(open).toHaveBeenCalledTimes(2);
    });

    it('does not throw when registering the listener rejects', async () => {
      const load = loader({ addListener: () => Promise.reject(new Error('UNIMPLEMENTED')) });

      await expect(listenForMoment(true, vi.fn(), load)).resolves.toBeUndefined();
    });
  });
});
