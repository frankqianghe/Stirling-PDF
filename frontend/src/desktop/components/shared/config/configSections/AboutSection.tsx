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

const RELEASES_LATEST_API =
  'https://api.github.com/repos/frankqianghe/Stirling-PDF/releases/latest';
const RELEASES_PAGE_URL =
  'https://github.com/frankqianghe/Stirling-PDF/releases/latest';

type UpdateState =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'up-to-date'; latest: string }
  | { kind: 'available'; latest: string }
  | { kind: 'error'; message: string };

/**
 * Compares two semver-ish version strings (e.g. "2.5.7" vs "2.5.10").
 * Strips a leading "v" if present. Missing segments are treated as 0.
 *
 * Returns:
 *   > 0  if a > b
 *   < 0  if a < b
 *   = 0  if equal
 */
function compareVersions(a: string, b: string): number {
  const parse = (raw: string) =>
    raw
      .replace(/^v/i, '')
      .split('.')
      .map((segment) => {
        const n = parseInt(segment, 10);
        return Number.isFinite(n) ? n : 0;
      });

  const aParts = parse(a);
  const bParts = parse(b);
  const length = Math.max(aParts.length, bParts.length);
  for (let i = 0; i < length; i += 1) {
    const av = aParts[i] ?? 0;
    const bv = bParts[i] ?? 0;
    if (av !== bv) return av - bv;
  }
  return 0;
}

/**
 * Desktop "About" pane — the simple three-row variant requested by product:
 *
 *   1. Version            — pulled from Tauri's `getVersion()`
 *   2. Check for Updates  — hits the public GitHub releases API and compares
 *                           the tag against the locally bundled version
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
      const resp = await fetch(RELEASES_LATEST_API, {
        headers: { Accept: 'application/vnd.github+json' },
      });
      if (!resp.ok) {
        throw new Error(`GitHub API responded ${resp.status} ${resp.statusText}`);
      }
      const json = (await resp.json()) as { tag_name?: string; name?: string };
      const latestTag = (json.tag_name || json.name || '').trim();
      if (!latestTag) {
        throw new Error('Empty tag_name in GitHub response');
      }
      const cmp = compareVersions(latestTag, version);
      if (cmp > 0) {
        setUpdate({ kind: 'available', latest: latestTag });
      } else {
        setUpdate({ kind: 'up-to-date', latest: latestTag });
      }
    } catch (err) {
      console.error('[AboutSection] Update check failed:', err);
      const message =
        err instanceof Error ? err.message : 'Update check failed';
      setUpdate({ kind: 'error', message });
    }
  }, [version]);

  const openReleases = useCallback(async () => {
    try {
      // tauri-plugin-opener is registered with `opener:default`; using the
      // shell plugin's open() would also work but opener is already in use
      // elsewhere in the app, so stay consistent.
      await invoke('plugin:opener|open_url', { url: RELEASES_PAGE_URL });
    } catch (err) {
      console.error('[AboutSection] Failed to open releases page:', err);
      // Fallback to window.open if the IPC route fails.
      try {
        window.open(RELEASES_PAGE_URL, '_blank', 'noopener');
      } catch {
        /* swallow */
      }
    }
  }, []);

  const openLogs = useCallback(async () => {
    if (openingLogs) return;
    setOpeningLogs(true);
    setLogError(null);
    try {
      // Opens today's daily log file in the OS default text editor.
      // Convert/OCR per-task logs are still reachable via the right-click
      // "Open log file" menu in the task list.
      await openTodayLog();
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
                { latest: update.latest },
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
              <Group justify="space-between" align="center" wrap="nowrap">
                <Text size="sm">
                  {t(
                    'settings.about.updateAvailable',
                    'A new version is available: {{latest}}',
                    { latest: update.latest },
                  )}
                </Text>
                <Button size="xs" radius="md" onClick={openReleases}>
                  {t('settings.about.download', 'Download')}
                </Button>
              </Group>
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
