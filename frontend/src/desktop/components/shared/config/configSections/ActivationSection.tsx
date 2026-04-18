import React, { useCallback, useState } from 'react';
import {
  Alert,
  Button,
  Group,
  Stack,
  Text,
  TextInput,
  useComputedColorScheme,
} from '@mantine/core';
import { useTranslation } from 'react-i18next';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import { licenseActivationService } from '@app/services/licenseActivationService';
import { useDesktopLicenseStatus } from '@app/hooks/useDesktopLicenseStatus';

type ActivationResult =
  | { kind: 'idle' }
  | { kind: 'success' }
  | { kind: 'error'; message: string };

/**
 * Normalize raw user input to the canonical XXXX-XXXX-XXXX-XXXX form.
 *
 * - Strips anything that isn't [0-9A-Z] (so dashes, spaces and stray
 *   punctuation don't throw off the grouping).
 * - Uppercases alpha chars to match the placeholder style.
 * - Re-inserts a dash after every 4 chars, up to 4 groups (16 chars).
 */
function formatLicenseKey(raw: string): string {
  const cleaned = raw.replace(/[^0-9a-zA-Z]/g, '').toUpperCase().slice(0, 16);
  const groups: string[] = [];
  for (let i = 0; i < cleaned.length; i += 4) {
    groups.push(cleaned.slice(i, i + 4));
  }
  return groups.join('-');
}

/**
 * Desktop-only "Activation" settings pane. Mirrors the manual activation
 * flow described in the product spec: paste a License Key received via
 * purchase email, click Activate, and (on success) have the device's paid
 * plan refreshed inline so the VIP crown / paywall pill update right away.
 *
 * The success / error alerts only appear AFTER the user clicks "Activate".
 */
const ActivationSection: React.FC = () => {
  const { t } = useTranslation();
  const colorScheme = useComputedColorScheme('light');
  const isDark = colorScheme === 'dark';
  // `isVip` is derived from the plan value that's cached in localStorage on
  // every successful /client/device/register call, so on first render we
  // already know whether the device is activated — no need to wait for the
  // hook's background refresh.
  const { isVip } = useDesktopLicenseStatus();

  const [licenseKey, setLicenseKey] = useState('');
  const [result, setResult] = useState<ActivationResult>({ kind: 'idle' });
  const [activating, setActivating] = useState(false);

  const handleActivate = useCallback(async () => {
    if (activating) return;
    setActivating(true);
    try {
      const res = await licenseActivationService.activate(licenseKey);
      if (res.ok) {
        setResult({ kind: 'success' });
      } else {
        // Per spec: always show the fixed "Invalid License Key..." copy,
        // regardless of what the server returned. `res.errorMessage` is
        // still useful for logging / debugging, which the service does.
        setResult({
          kind: 'error',
          message: t(
            'settings.activation.invalidKey',
            'Invalid License Key. Please check the key from your purchase email and try again.'
          ),
        });
      }
    } finally {
      setActivating(false);
    }
  }, [activating, licenseKey, t]);

  const handlePaste = useCallback(async () => {
    try {
      if (
        typeof navigator !== 'undefined' &&
        navigator.clipboard &&
        typeof navigator.clipboard.readText === 'function'
      ) {
        const text = await navigator.clipboard.readText();
        if (text) {
          setLicenseKey(formatLicenseKey(text));
          if (result.kind !== 'idle') {
            setResult({ kind: 'idle' });
          }
        }
      }
    } catch (err) {
      console.warn('[ActivationSection] Failed to read clipboard:', err);
    }
  }, [result.kind]);

  const pasteBtnBg = isDark ? 'rgba(255,255,255,0.06)' : '#F1F3F5';
  const pasteBtnBorder = isDark
    ? '1px solid rgba(255,255,255,0.1)'
    : '1px solid rgba(15,23,42,0.08)';
  const pasteBtnColor = isDark ? 'var(--mantine-color-text)' : '#1F2937';

  // Short-circuit view: if the device is already on a paid plan (year /
  // lifetime) the activation form is pointless. Show a single "Activated"
  // line instead.
  if (isVip) {
    return (
      <Stack gap="lg">
        <div>
          <Text fw={700} size="xl" style={{ letterSpacing: '-0.3px' }}>
            {t('settings.activation.title', 'Activate License')}
          </Text>
        </div>

        <Group gap={10} align="center">
          <CheckCircleIcon
            style={{ fontSize: 22, color: '#1F8A49' }}
          />
          <Text fw={600} size="md" style={{ color: '#1F8A49' }}>
            {t('settings.activation.activated', 'Activated')}
          </Text>
        </Group>
      </Stack>
    );
  }

  return (
    <Stack gap="lg">
      <div>
        <Text fw={700} size="xl" style={{ letterSpacing: '-0.3px' }}>
          {t('settings.activation.title', 'Activate License')}
        </Text>
        <Text size="sm" c="dimmed" mt={6}>
          {t(
            'settings.activation.description',
            'Please enter your License Key from your purchase email.'
          )}
        </Text>
      </div>

      <TextInput
        value={licenseKey}
        onChange={(event) => {
          setLicenseKey(formatLicenseKey(event.currentTarget.value));
          if (result.kind !== 'idle') {
            setResult({ kind: 'idle' });
          }
        }}
        placeholder={t(
          'settings.activation.placeholder',
          'XXXX-XXXX-XXXX-XXXX'
        )}
        size="md"
        radius="md"
        styles={{
          input: {
            fontFamily:
              'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
            letterSpacing: '0.08em',
          },
        }}
      />

      <Group gap="sm">
        <Button
          onClick={handleActivate}
          loading={activating}
          disabled={!licenseKey.trim()}
          radius="md"
          size="md"
          styles={{
            root: {
              background: 'linear-gradient(90deg, #FF072D 0%, #FF6D05 100%)',
              color: '#FFFFFF',
              border: 'none',
              boxShadow: '0 4px 10px 0 rgba(255, 61, 0, 0.25)',
              fontWeight: 700,
            },
          }}
        >
          {t('settings.activation.activate', 'Activate')}
        </Button>

        <Button
          onClick={handlePaste}
          radius="md"
          size="md"
          styles={{
            root: {
              background: pasteBtnBg,
              color: pasteBtnColor,
              border: pasteBtnBorder,
              fontWeight: 700,
            },
          }}
        >
          {t('settings.activation.pasteFromClipboard', 'Paste from Clipboard')}
        </Button>
      </Group>

      {result.kind === 'success' && (
        <Alert
          color="green"
          variant="light"
          radius="md"
          withCloseButton={false}
        >
          {t(
            'settings.activation.successMessage',
            'License activated successfully. Your Pro features are now available on this device.'
          )}
        </Alert>
      )}

      {result.kind === 'error' && (
        <Alert
          color="red"
          variant="light"
          radius="md"
          withCloseButton={false}
        >
          {result.message}
        </Alert>
      )}

      <Text size="xs" c="dimmed">
        {t(
          'settings.activation.support',
          'Need help? Contact: support@yourpdf.com'
        )}
      </Text>
    </Stack>
  );
};

export default ActivationSection;
