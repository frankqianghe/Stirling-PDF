import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  Group,
  Paper,
  Stack,
  Text,
  useComputedColorScheme,
} from '@mantine/core';
import { useTranslation } from 'react-i18next';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { getVersion } from '@tauri-apps/api/app';
import { openTodayLog } from '@app/services/dailyLogService';
import { updateCheckService } from '@app/services/updateCheckService';

type UpdateState =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'up-to-date' }
  | {
      kind: 'available';
      latest: string;
      downloadUrl: string;
      notes: string;
    }
  | { kind: 'error'; message: string };

/**
 * Desktop "About" pane — the simple three-row variant requested by product:
 *
 *   1. Version            — pulled from Tauri's `getVersion()`
 *   2. Check for Updates  — hits our backend `/client/update/check` endpoint
 *                           with the current arch + version; if the server
 *                           reports an update, surface a Download button
 *                           that opens the supplied download_url in the
 *                           user's default browser
 *   3. View Logs          — opens the OS file manager at the app log dir
 *                           (which contains the `task_logs/` subfolder used
 *                           by the per-task logging system)
 */
const AboutSection: React.FC = () => {
  const { t } = useTranslation();
  const colorScheme = useComputedColorScheme('light');
  const isDark = colorScheme === 'dark';
  const isTauriApp = useMemo(() => isTauri(), []);

  const [version, setVersion] = useState<string | null>(null);
  const [update, setUpdate] = useState<UpdateState>({ kind: 'idle' });
  const [openingLogs, setOpeningLogs] = useState(false);
  const [logError, setLogError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);

  // Fetch the desktop version once on mount.
  useEffect(() => {
    if (!isTauriApp) return;
    let cancelled = false;
    getVersion()
      .then((v) => {
        if (!cancelled) setVersion(v);
      })
      .catch((err) => {
        console.error('[AboutSection] Failed to read app version:', err);
      });
    return () => {
      cancelled = true;
    };
  }, [isTauriApp]);

  const checkForUpdates = useCallback(async () => {
    if (!version) return;
    setUpdate({ kind: 'checking' });
    try {
      const result = await updateCheckService.check(version);
      if (!result.hasUpdate) {
        setUpdate({ kind: 'up-to-date' });
        return;
      }
      setUpdate({
        kind: 'available',
        latest: result.info.version,
        downloadUrl: result.info.downloadUrl,
        notes: result.info.notes,
      });
    } catch (err) {
      console.error('[AboutSection] Update check failed:', err);
      const message =
        err instanceof Error ? err.message : 'Update check failed';
      setUpdate({ kind: 'error', message });
    }
  }, [version]);

  /**
   * Opens the server-supplied download URL in the user's default
   * browser. We do NOT download via the embedded webview / Tauri's
   * native download API — product wants the standard browser download
   * UX (progress, resume, "open file" prompt on success), and the
   * browser also avoids any Cloudflare bot-checks WebView2 occasionally
   * trips on (the same reason we open the Lemon Squeezy checkout
   * externally).
   */
  const downloadLatest = useCallback(async () => {
    if (downloading) return;
    if (update.kind !== 'available' || !update.downloadUrl) return;
    setDownloading(true);
    try {
      await invoke('plugin:opener|open_url', { url: update.downloadUrl });
    } catch (err) {
      console.error('[AboutSection] Failed to open download URL:', err);
      try {
        window.open(update.downloadUrl, '_blank', 'noopener');
      } catch {
        /* swallow */
      }
    } finally {
      setDownloading(false);
    }
  }, [downloading, update]);

  const openLogs = useCallback(async () => {
    if (openingLogs) return;
    setOpeningLogs(true);
    setLogError(null);
    try {
      // Opens today's daily log file in the OS default text editor.
      // Convert/OCR per-task logs are still reachable via the right-click
      // "Open log file" menu in the task list.
      //
      // We race the IPC against an 8s timeout so that on Windows — where
      // the underlying ShellExecuteEx call can occasionally hang waiting
      // on a system-level "Open with" picker — the button never gets
      // stuck loading forever.  If we hit the timeout we surface a
      // user-actionable message rather than silently giving up.
      await Promise.race([
        openTodayLog(),
        new Promise<never>((_, reject) =>
          setTimeout(
            () =>
              reject(
                new Error(
                  'Opening the log file timed out. Please open the log folder manually.',
                ),
              ),
            8000,
          ),
        ),
      ]);
    } catch (err) {
      console.error('[AboutSection] Failed to open today log:', err);
      const message =
        err instanceof Error
          ? err.message
          : typeof err === 'string'
            ? err
            : 'Failed to open log file';
      setLogError(message);
    } finally {
      setOpeningLogs(false);
    }
  }, [openingLogs]);

  const cardBorder = isDark
    ? '1px solid rgba(255,255,255,0.08)'
    : '1px solid rgba(15,23,42,0.08)';

  const versionLabel = version ?? t('common.loading', 'Loading...');

  return (
    <Stack gap="lg">
      <div>
        <Text fw={700} size="xl" style={{ letterSpacing: '-0.3px' }}>
          {t('settings.about.title', 'About')}
        </Text>
        <Text size="sm" c="dimmed" mt={6}>
          {t(
            'settings.about.description',
            'Version, updates and diagnostic logs for this app.',
          )}
        </Text>
      </div>

      {/* Row 1: Version */}
      <Paper
        p="md"
        radius="md"
        style={{ border: cardBorder, background: 'transparent' }}
      >
        <Group justify="space-between" align="center" wrap="nowrap">
          <div>
            <Text fw={600} size="sm">
              {t('settings.about.version', 'Version')}
            </Text>
            <Text size="xs" c="dimmed" mt={4}>
              {t(
                'settings.about.versionHint',
                'The currently installed desktop app version.',
              )}
            </Text>
          </div>
          <Badge variant="light" size="lg" radius="md">
            {versionLabel}
          </Badge>
        </Group>
      </Paper>

      {/* Row 2: Check for Updates */}
      <Paper
        p="md"
        radius="md"
        style={{ border: cardBorder, background: 'transparent' }}
      >
        <Stack gap="sm">
          <Group justify="space-between" align="center" wrap="nowrap">
            <div>
              <Text fw={600} size="sm">
                {t('settings.about.checkForUpdates', 'Check for Updates')}
              </Text>
              <Text size="xs" c="dimmed" mt={4}>
                {t(
                  'settings.about.checkForUpdatesHint',
                  'Compare your version against the latest GitHub release.',
                )}
              </Text>
            </div>
            <Button
              size="sm"
              radius="md"
              variant="default"
              loading={update.kind === 'checking'}
              disabled={!version}
              onClick={checkForUpdates}
            >
              {t('settings.about.checkNow', 'Check Now')}
            </Button>
          </Group>

          {update.kind === 'up-to-date' && (
            <Alert color="green" variant="light" radius="md" withCloseButton={false}>
              {t(
                'settings.about.upToDate',
                'You are on the latest version ({{latest}}).',
                { latest: version ?? '' },
              )}
            </Alert>
          )}

          {update.kind === 'available' && (
            <Alert
              color="blue"
              variant="light"
              radius="md"
              withCloseButton={false}
            >
              <Stack gap="xs">
                <Group justify="space-between" align="center" wrap="nowrap">
                  <Text size="sm" fw={600}>
                    {t(
                      'settings.about.updateAvailable',
                      'A new version is available: {{latest}}',
                      { latest: update.latest },
                    )}
                  </Text>
                  <Button
                    size="xs"
                    radius="md"
                    loading={downloading}
                    onClick={downloadLatest}
                  >
                    {t('settings.about.download', 'Download')}
                  </Button>
                </Group>
                {update.notes && (
                  <Text
                    size="xs"
                    c="dimmed"
                    style={{ whiteSpace: 'pre-wrap' }}
                  >
                    {update.notes}
                  </Text>
                )}
              </Stack>
            </Alert>
          )}

          {update.kind === 'error' && (
            <Alert color="red" variant="light" radius="md" withCloseButton={false}>
              {t(
                'settings.about.checkFailed',
                'Failed to check for updates: {{message}}',
                { message: update.message },
              )}
            </Alert>
          )}
        </Stack>
      </Paper>

      {/* Row 3: View Logs */}
      <Paper
        p="md"
        radius="md"
        style={{ border: cardBorder, background: 'transparent' }}
      >
        <Stack gap="sm">
          <Group justify="space-between" align="center" wrap="nowrap">
            <div>
              <Text fw={600} size="sm">
                {t('settings.about.viewLogs', 'View Logs')}
              </Text>
              <Text size="xs" c="dimmed" mt={4}>
                {t(
                  'settings.about.viewLogsHint',
                  'Open the application log directory in your file manager.',
                )}
              </Text>
            </div>
            <Button
              size="sm"
              radius="md"
              variant="default"
              loading={openingLogs}
              onClick={openLogs}
            >
              {t('settings.about.openLogFolder', 'Open Log Folder')}
            </Button>
          </Group>

          {logError && (
            <Alert color="red" variant="light" radius="md" withCloseButton={false}>
              {logError}
            </Alert>
          )}
        </Stack>
      </Paper>
    </Stack>
  );
};

export default AboutSection;
