import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Box, Loader, Stack, Text, useComputedColorScheme } from '@mantine/core';
import { useBackendHealth } from '@app/hooks/useBackendHealth';

/**
 * Fullscreen overlay shown while the bundled backend is still starting up
 * (i.e. the status dot in the right-rail footer is not green yet).
 *
 * Behaviour:
 * - Covers the entire viewport with a very high z-index so it blocks ALL
 *   interaction with the app below it (pointer + keyboard focus).
 * - Renders a spinner plus a localised status message that mirrors the
 *   message shown in the footer indicator tooltip.
 * - Uses `aria-live="assertive"` / `role="alertdialog"` so screen readers
 *   announce it and understand that focus is trapped.
 * - Unmounts the moment the backend reports healthy, so the user regains
 *   full control without any extra transition logic.
 */
export const BackendLoadingOverlay: React.FC = () => {
  const { t } = useTranslation();
  const { status, isHealthy } = useBackendHealth();
  const colorScheme = useComputedColorScheme('light');

  const message = useMemo(() => {
    if (status === 'starting') {
      return t('backendHealth.starting', 'Backend starting up...');
    }
    if (status === 'unhealthy') {
      return t('backendHealth.wait', 'Please wait for the backend to finish launching and try again.');
    }
    return t('backendHealth.checking', 'Checking backend status...');
  }, [status, t]);

  if (isHealthy) {
    return null;
  }

  const overlayBackground = colorScheme === 'dark'
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
