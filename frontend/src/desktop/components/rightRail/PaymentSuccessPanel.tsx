import React from 'react';
import { Box, Stack, Text, UnstyledButton, useComputedColorScheme } from '@mantine/core';

interface PaymentSuccessPanelProps {
  onClose: () => void;
}

export function PaymentSuccessPanel({ onClose }: PaymentSuccessPanelProps) {
  const colorScheme = useComputedColorScheme('light');
  const isDark = colorScheme === 'dark';

  const cardBg = isDark ? 'rgba(255,255,255,0.04)' : '#FFFFFF';
  const cardBorder = isDark
    ? '1px solid rgba(255,255,255,0.08)'
    : '1px solid rgba(15,23,42,0.06)';
  const cardShadow = isDark
    ? '0 10px 30px -18px rgba(0,0,0,0.6)'
    : '0 10px 30px -18px rgba(15,23,42,0.15)';

  const pillBg = isDark ? 'rgba(34,197,94,0.16)' : '#E7F8EE';
  const pillText = isDark ? '#4ADE80' : '#1F8A49';

  const closeBtnBg = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(15,23,42,0.06)';
  const closeBtnBorder = isDark
    ? '1px solid rgba(255,255,255,0.10)'
    : '1px solid rgba(15,23,42,0.08)';

  return (
    <Box style={{ position: 'relative' }} pt={36} pb={32} px={36}>
      <UnstyledButton
        onClick={onClose}
        aria-label="Close"
        style={{
          position: 'absolute',
          top: 16,
          right: 16,
          width: 32,
          height: 32,
          borderRadius: '50%',
          background: closeBtnBg,
          border: closeBtnBorder,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--mantine-color-dimmed)',
          fontSize: 18,
          lineHeight: 1,
          cursor: 'pointer',
          zIndex: 10,
        }}
      >
        ×
      </UnstyledButton>

      <Stack gap={6} mb={20}>
        <Text
          fw={900}
          style={{
            fontSize: 26,
            lineHeight: 1.2,
            letterSpacing: '-0.4px',
            color: 'var(--mantine-color-text)',
          }}
        >
          Client Payment Success Notification
        </Text>
        <Text size="sm" c="dimmed" style={{ lineHeight: 1.55 }}>
          Corresponds to the success feedback after completing payment within the client.
          The current client is activated directly, and a notification is shown that a License Key
          backup has been received in the email.
        </Text>
      </Stack>

      <Box
        style={{
          background: cardBg,
          border: cardBorder,
          borderRadius: 16,
          boxShadow: cardShadow,
          padding: '28px 28px 30px',
        }}
      >
        <Box
          style={{
            display: 'inline-block',
            padding: '10px 22px',
            borderRadius: 999,
            background: pillBg,
            color: pillText,
            fontSize: 16,
            fontWeight: 600,
            marginBottom: 18,
          }}
        >
          Payment Successful
        </Box>

        <Text
          fw={900}
          style={{
            fontSize: 26,
            lineHeight: 1.2,
            letterSpacing: '-0.4px',
            color: 'var(--mantine-color-text)',
            marginBottom: 8,
          }}
        >
          Your Pro features are now unlocked
        </Text>
        <Text size="sm" c="dimmed" style={{ lineHeight: 1.55 }}>
          This device has been activated successfully. Your License Key has also been sent to your
          email as a backup.
        </Text>
      </Box>
    </Box>
  );
}
