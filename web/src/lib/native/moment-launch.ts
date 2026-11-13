import { capacitorWidget, type EmberWidgetPlugin } from './widget';

type LoadWidget = () => Promise<{ EmberWidget: EmberWidgetPlugin }>;

/**
 * Cold start from a moment door (launcher shortcut or widget): takes and clears the pending launch action and, for
 * `moment`, replaces the URL with `/moment` before the router exists. A no-op on the web and when the native plugin
 * lacks the method. Never throws.
 */
export async function takeMomentLaunch(native: boolean, load: LoadWidget = capacitorWidget): Promise<boolean> {
  if (!native) return false;
  try {
    const { EmberWidget } = await load();
    if (typeof EmberWidget.takeLaunchAction !== 'function') return false;
    const { action } = await EmberWidget.takeLaunchAction();
    if (action !== 'moment') return false;
    window.history.replaceState(null, '', '/moment');
    return true;
  } catch {
    return false;
  }
}

/** Warm start from a moment door: calls `open` on each `openMoment` event. A no-op on the web. Never throws. */
export async function listenForMoment(
  native: boolean,
  open: () => void,
  load: LoadWidget = capacitorWidget,
): Promise<void> {
  if (!native) return;
  try {
    const { EmberWidget } = await load();
    await EmberWidget.addListener('openMoment', () => open());
  } catch {
    return;
  }
}
