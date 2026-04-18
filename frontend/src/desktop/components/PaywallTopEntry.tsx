import { useCallback, useEffect, useState } from 'react';
import { UnstyledButton, Box, Text } from '@mantine/core';
import { useDesktopLicenseStatus } from '@app/hooks/useDesktopLicenseStatus';
import { DesktopPaywallModal } from './rightRail/DesktopPaywallModal';

/**
 * Paywall entry pill rendered inline by its parent container.
 *
 * Visibility rules:
 *  - free plan       : show pill (clicking opens the paywall modal)
 *  - year / lifetime : hide pill (user already has VIP access)
 *
 * NOTE: the pill's visibility is decoupled from the modal's mount state.
 * The modal must stay mounted while `paywallOpen === true` so that:
 *   1. its `'checkout-payment-success'` listener keeps receiving events, and
 *   2. the success panel remains visible after the plan flips from
 *      `free` → `lifetime` mid-flow (otherwise the pill would vanish and
 *      unmount the modal before the user sees the success screen).
 */
export function PaywallTopEntry() {
  const { plan, loading } = useDesktopLicenseStatus();
  const [paywallOpen, setPaywallOpen] = useState(false);

  const handleClick = useCallback(() => {
    setPaywallOpen(true);
  }, []);

  const handleClose = useCallback(() => {
    setPaywallOpen(false);
  }, []);

  // Allow programmatic opens (e.g. the /client/ad check right after
  // registration) via a window-level CustomEvent.
  useEffect(() => {
    const handleOpen = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      console.log('[PaywallTopEntry] 📣 plexpdf-open-paywall received:', detail);
      setPaywallOpen(true);
    };
    window.addEventListener('plexpdf-open-paywall', handleOpen);
    return () => window.removeEventListener('plexpdf-open-paywall', handleOpen);
  }, []);

  const showPill = !loading && plan === 'free';

  return (
    <>
      {showPill && (
        <UnstyledButton
          onClick={handleClick}
          aria-label="Upgrade to Lifetime Access"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            padding: '3px 3px 3px 12px',
            borderRadius: 999,
            background: 'linear-gradient(90deg, #FFF4E6 0%, #FFE5D0 100%)',
            border: '1px solid #FFB070',
            boxShadow: '0 4px 10px 0 rgba(0, 0, 0, 0.08)',
            transition: 'transform 0.12s ease, box-shadow 0.12s ease',
            cursor: 'pointer',
            height: 28,
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLButtonElement).style.transform =
              'translateY(-1px)';
            (e.currentTarget as HTMLButtonElement).style.boxShadow =
              '0 6px 14px 0 rgba(255, 109, 5, 0.22)';
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLButtonElement).style.transform =
              'translateY(0)';
            (e.currentTarget as HTMLButtonElement).style.boxShadow =
              '0 4px 10px 0 rgba(0, 0, 0, 0.08)';
          }}
        >
          <Text
            component="span"
            fw={700}
            fs="italic"
            style={{
              fontSize: 12,
              color: '#8A3A00',
              letterSpacing: '0.2px',
              whiteSpace: 'nowrap',
              lineHeight: 1,
            }}
          >
            Lifetime Access
          </Text>
          <Text
            component="span"
            fw={800}
            style={{
              fontSize: 13,
              color: '#FF3D00',
              whiteSpace: 'nowrap',
              lineHeight: 1,
            }}
          >
            $59
          </Text>
          <Box
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '4px 11px',
              borderRadius: 999,
              background: 'linear-gradient(90deg, #FF072D 0%, #FF6D05 100%)',
              color: '#FFFFFF',
              fontSize: 11,
              fontWeight: 700,
              lineHeight: 1.3,
              boxShadow: '0 2px 6px 0 rgba(255, 61, 0, 0.25)',
            }}
          >
            Get
          </Box>
        </UnstyledButton>
      )}

      <DesktopPaywallModal
        opened={paywallOpen}
        onClose={handleClose}
        source="workbench-corner"
      />
    </>
  );
}
