import { environment } from '../../../environments/environment';

/** Opens `{WebOrigin}{path}` in the system browser (native build: Discord and sign-up flows are browser-only). */
export async function openOnWeb(path: string): Promise<void> {
  const { Browser } = await import('@capacitor/browser');
  await Browser.open({ url: `${environment.webOrigin}${path}` });
}
