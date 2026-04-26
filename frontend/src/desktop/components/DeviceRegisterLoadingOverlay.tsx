import React from 'react';
import { useTranslation } from 'react-i18next';
import { Box, Loader, Stack, Text, useComputedColorScheme } from '@mantine/core';

/**
 * Fullscreen loading overlay shown while the very first
 * `/client/device/register` round-trip is in flight.
 *
 * Why we block:
 * - Almost every paid feature (paywall gate, license refresh, order
 *   creation, OCR / Convert quotas, …) needs the device token returned
 *   by `/register`.  Letting the user in before that token exists
 *   triggers spurious 401s and confusing "free user" UI flicker for
 *   accounts that are actually paid.
 *
 * Behaviour:
 * - Covers the entire viewport with a very high z-index so it blocks
 *   ALL interaction below it (pointer + keyboard focus).
 * - Renders a spinner plus the localised "Registering device, please
 *   wait" message.
 * - Uses `aria-live="assertive"` / `role="alertdialog"` so screen
 *   readers announce it correctly.
 * - The parent unmounts this component the moment registration
 *   resolves (success OR final failure after retries) so the user is
 *   never stuck behind it forever.
 */
export const DeviceRegisterLoadingOverlay: React.FC = () => {
  const { t } = useTranslation();
  const colorScheme = useComputedColorScheme('light');

  const message = t('deviceRegister.loading', '正在注册设备，请稍等');

  const overlayBackground =
    colorScheme === 'dark'
      ? 'rgba(10, 10, 15, 0.78)'
      : 'rgba(255, 255, 255, 0.78)';

  return (
    <Box
      role="alertdialog"
      aria-modal="true"
      aria-live="assertive"
      aria-label={message}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 20000,
        background: overlayBackground,
        backdropFilter: 'blur(4px)',
        WebkitBackdropFilter: 'blur(4px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: 'wait',
      }}
      onContextMenu={(event) => event.preventDefault()}
    >
      <Stack align="center" gap="md">
        <Loader size="lg" />
        <Text size="md" fw={500} ta="center" maw={320}>
          {message}
        </Text>
      </Stack>
    </Box>
  );
};
