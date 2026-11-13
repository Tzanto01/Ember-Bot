import 'i18next';
import type { en } from './lib/i18n';

declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'translation';
    keySeparator: false;
    nsSeparator: false;
    returnNull: false;
    resources: { translation: typeof en };
  }
}
