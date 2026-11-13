import { useTranslation } from 'react-i18next';
import { env } from '@/lib/env';

/** Where no-account data lives and how it can be lost, for the start screen and the "On this device" settings card. */
export function DeviceWarning() {
  const { t } = useTranslation();
  return (
    <>
      <p>
        {env.native ? t('local.warning.native') : t('local.warning.browser')}
      </p>
      <p>{t('local.warning.noServer')}</p>
    </>
  );
}
