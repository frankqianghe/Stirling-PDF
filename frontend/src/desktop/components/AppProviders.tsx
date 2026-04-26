import { ReactNode, useEffect, useState } from "react";
import { AppProviders as ProprietaryAppProviders } from "@proprietary/components/AppProviders";
import { DesktopConfigSync } from '@app/components/DesktopConfigSync';
import { DesktopBannerInitializer } from '@app/components/DesktopBannerInitializer';
import { SaveShortcutListener } from '@app/components/SaveShortcutListener';
import { useFirstLaunchCheck } from '@app/hooks/useFirstLaunchCheck';
import { useBackendInitializer } from '@app/hooks/useBackendInitializer';
import { useDeviceRegister } from '@app/hooks/useDeviceRegister';
import { DESKTOP_DEFAULT_APP_CONFIG } from '@app/config/defaultAppConfig';
import { connectionModeService } from '@app/services/connectionModeService';
import { tauriBackendService } from '@app/services/tauriBackendService';
import { DeviceRegisterLoadingOverlay } from '@app/components/DeviceRegisterLoadingOverlay';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { isTauri } from '@tauri-apps/api/core';

/**
 * Desktop application providers
 * Wraps proprietary providers and adds desktop-specific configuration
 * - Enables retry logic for app config (needed for Tauri mode when backend is starting)
 * - Shows setup wizard on first launch
 */
export function AppProviders({ children }: { children: ReactNode }) {
  const { setupComplete } = useFirstLaunchCheck();
  const [connectionMode, setConnectionMode] = useState<'saas' | 'selfhosted' | null>(null);
  const [appReady, setAppReady] = useState(false);
  // Load connection mode on mount
  useEffect(() => {
    void connectionModeService.getCurrentMode().then(setConnectionMode);
  }, []);

  useEffect(() => {
    if (setupComplete) {
      setAppReady(true);
    }
  }, [setupComplete]);

  // Register device with backend on every launch (after backend is ready).
  // We surface `registering` so we can mount a fullscreen blocking
  // overlay until `/client/device/register` returns a token — every
  // paid-plan / paywall code path depends on that token, and showing
  // the workspace before it lands causes "free user" UI flicker plus
  // 401s on the first user click.
  const { registering } = useDeviceRegister();

  // Initialize backend health monitoring for self-hosted mode
  useEffect(() => {
    if (setupComplete && connectionMode === 'selfhosted') {
      void tauriBackendService.initializeExternalBackend();
    }
  }, [setupComplete, connectionMode]);

  // Initialize monitoring for bundled backend (already started in Rust)
  // This sets up port detection and health checks
  const shouldMonitorBackend = setupComplete && connectionMode === 'saas';
  useBackendInitializer(shouldMonitorBackend);

  useEffect(() => {
    if (!appReady) {
      return;
    }

    if (!isTauri()) {
      return;
    }

    const currentWindow = getCurrentWindow();
    currentWindow
      .show()
      .then(() => currentWindow.unminimize().catch(() => {}))
      .then(() => currentWindow.setFocus().catch(() => {}))
      .then(() => currentWindow.requestUserAttention(1).catch(() => {}))
      .catch(() => {});
  }, [appReady]);

  if (!appReady) {
    return (
      <ProprietaryAppProviders
        appConfigRetryOptions={{
          maxRetries: 5,
          initialDelay: 1000,
        }}
        appConfigProviderProps={{
          initialConfig: DESKTOP_DEFAULT_APP_CONFIG,
          bootstrapMode: 'non-blocking',
          autoFetch: false,
        }}
      >
        <div style={{ minHeight: '100vh' }} />
      </ProprietaryAppProviders>
    );
  }

  // Normal app flow
  return (
    <ProprietaryAppProviders
      appConfigRetryOptions={{
        maxRetries: 5,
        initialDelay: 1000, // 1 second, with exponential backoff
      }}
      appConfigProviderProps={{
        initialConfig: DESKTOP_DEFAULT_APP_CONFIG,
        bootstrapMode: 'non-blocking',
        autoFetch: false,
      }}
    >
      <DesktopConfigSync />
      <DesktopBannerInitializer />
      <SaveShortcutListener />
      {children}
      {/*
        Block the entire UI until the very first /client/device/register
        round-trip resolves (success OR final failure after retries).
        The hook stops returning `registering: true` in either case, so
        the user is never stuck behind it forever.

        Note: we intentionally do NOT block on JRE backend startup any
        more — JRE-dependent tools are soft-disabled at the tile /
        submit-button level (see `useToolManagement` + `OperationButton`)
        and light up the moment the backend health monitor reports
        healthy.  Convert and OCR (remote PlexPDF cloud) stay clickable
        throughout backend startup.
      */}
      {registering && <DeviceRegisterLoadingOverlay />}
    </ProprietaryAppProviders>
  );
}
