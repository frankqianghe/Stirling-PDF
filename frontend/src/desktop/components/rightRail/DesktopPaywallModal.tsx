import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Modal,
  Stack,
  Group,
  Text,
  UnstyledButton,
  Box,
  useComputedColorScheme,
} from '@mantine/core';
import CheckIcon from '@mui/icons-material/Check';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { orderService } from '@app/services/orderService';
import { deviceRegisterService } from '@app/services/deviceRegisterService';
import { PaymentSuccessPanel } from './PaymentSuccessPanel';
import { useDesktopLicenseStatus } from '@app/hooks/useDesktopLicenseStatus';

/**
 * Fixed localhost URL used as the redirect target for the checkout flow.
 * The checkout webview intercepts navigation to this URL (see the Rust
 * `open_checkout_webview` command) — there is NO actual local HTTP server.
 */
const CHECKOUT_REDIRECT_URL = 'http://localhost:37691/plexpdf/payment/success';

const LIFETIME_FEATURES = [
  '1 Windows Device',
  'Full PDF Editing Features',
  'PDF to Word / Excel / PPT',
  'OCR Text Recognition',
  'Lifetime Access',
];

const YEARLY_FEATURES = [
  '1 Windows Device',
  'Full PDF Editing Features',
  'PDF to Word / Excel / PPT',
  'OCR Text Recognition',
  'Annual Subscription',
];

interface DesktopPaywallModalProps {
  opened: boolean;
  onClose: () => void;
  source?: string;
}

type PaywallView = 'plans' | 'success';

type MembershipView = 'free' | 'year' | 'lifetime';

const LIFETIME_GRADIENT = 'linear-gradient(90deg, #FF072D 0%, #FF6D05 100%)';
const LIFETIME_SHADOW = '0 4px 10px 0 rgba(0, 0, 0, 0.1)';
const YEARLY_GRADIENT = 'linear-gradient(90deg, #8B5CF6 0%, #C026D3 100%)';
const YEARLY_SHADOW = '0 4px 10px 0 rgba(0, 0, 0, 0.1)';

export function DesktopPaywallModal({
  opened,
  onClose,
  source = 'unknown',
}: DesktopPaywallModalProps) {
  const [view, setView] = useState<PaywallView>('plans');
  const { plan, planExpiresAt } = useDesktopLicenseStatus();
  const colorScheme = useComputedColorScheme('light');
  const isDark = colorScheme === 'dark';

  useEffect(() => {
    let unlisten: (() => void) | undefined;

    listen<{ order_id?: string | null; redirect_url?: string }>(
      'checkout-payment-success',
      async (event) => {
        console.log('[Paywall] 🎉 checkout-payment-success event received:', event.payload);

        // Re-register so the server's new paid_plan is pushed into localStorage,
        // then broadcast to any mounted consumer of useDesktopLicenseStatus.
        try {
          const reg = await deviceRegisterService.register();
          console.log('[Paywall] License refreshed after payment, plan =', reg?.paidPlan);
        } catch (err) {
          console.warn('[Paywall] Failed to refresh license after payment:', err);
        }
        window.dispatchEvent(new Event('plexpdf-license-updated'));

        setView('success');
      }
    ).then((fn) => {
      unlisten = fn;
    });

    return () => {
      if (unlisten) unlisten();
    };
  }, []);

  useEffect(() => {
    if (!opened) {
      setView('plans');
    }
  }, [opened]);

  const openCheckout = useCallback(
    async (plan: 'lifetime' | 'yearly') => {
      const cachedToken = deviceRegisterService.getCachedToken();
      console.log('[Paywall] Buy Now clicked:', {
        plan,
        source,
        tokenPresent: !!cachedToken,
        tokenPrefix: cachedToken ? `${cachedToken.slice(0, 16)}...` : null,
      });

      const createPlan = plan === 'yearly' ? 'year' : 'buyout';

      const attemptCreate = async () =>
        orderService.createOrder(createPlan, CHECKOUT_REDIRECT_URL);

      try {
        let order;
        try {
          order = await attemptCreate();
        } catch (err) {
          const errAny = err as any;
          const is401 =
            errAny?.code === 'ERR_UNAUTHORIZED' ||
            errAny?.status === 401 ||
            /invalid credentials|unauthor/i.test(errAny?.message ?? '');

          if (is401) {
            console.warn(
              '[Paywall] 401 on create-order — device token looks stale or missing. Forcing fresh /client/device/register and retrying...'
            );
            const reg = await deviceRegisterService.registerWithRetry(3, 800);
            if (!reg) {
              console.error(
                '[Paywall] Re-registration FAILED. Cannot create order without a valid device token. Please restart the app.'
              );
              throw err;
            }
            console.log(
              '[Paywall] ✅ Re-registered with fresh token, retrying create-order...'
            );
            order = await attemptCreate();
          } else {
            throw err;
          }
        }

        console.log('[Paywall] Order created:', {
          plan: createPlan,
          order_id: order.orderId,
          checkout_url: order.checkoutUrl,
          source,
        });

        await invoke('open_checkout_webview', {
          url: order.checkoutUrl,
          orderId: order.orderId,
          redirectUrl: CHECKOUT_REDIRECT_URL,
        });
      } catch (err) {
        const errAny = err as any;
        console.error('[Paywall] create order / open checkout failed:', {
          message: errAny?.message,
          code: errAny?.code,
          status: errAny?.status,
          responseData: errAny?.response?.data,
          raw: err,
        });
      }
    },
    [source]
  );

  const handleDone = useCallback(() => {
    onClose();
  }, [onClose]);

  const membershipView: MembershipView =
    plan === 'lifetime' ? 'lifetime' : plan === 'year' ? 'year' : 'free';

  const yearExpiryText = planExpiresAt
    ? new Date(planExpiresAt).toLocaleString()
    : 'Unknown expiry time';

  const surfaceBg = useMemo(
    () =>
      isDark
        ? 'linear-gradient(180deg, #1A1D27 0%, #141720 100%)'
        : 'linear-gradient(180deg, #FFFFFF 0%, #F7F8FC 100%)',
    [isDark]
  );

  const closeBtnBg = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(15,23,42,0.06)';
  const closeBtnBorder = isDark
    ? '1px solid rgba(255,255,255,0.10)'
    : '1px solid rgba(15,23,42,0.08)';

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={null}
      size={760}
      centered
      padding={0}
      withCloseButton={false}
      radius="lg"
      overlayProps={{ blur: 4, backgroundOpacity: 0.5 }}
      styles={{
        body: { padding: 0 },
        content: {
          background: surfaceBg,
          border: isDark
            ? '1px solid rgba(255,255,255,0.08)'
            : '1px solid rgba(15,23,42,0.06)',
        },
      }}
    >
      {view === 'success' ? (
        <PaymentSuccessPanel onClose={handleDone} />
      ) : (
        <Stack gap={0}>
          <Stack align="center" pt={36} pb={28} px={32} gap={10}>
            <UnstyledButton
              onClick={onClose}
              style={{
                position: 'absolute',
                top: 16,
                right: 16,
                width: 32,
                height: 32,
                borderRadius: '50%',
                background: closeBtnBg,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--mantine-color-dimmed)',
                fontSize: 18,
                lineHeight: 1,
                cursor: 'pointer',
                zIndex: 10,
                border: closeBtnBorder,
                transition: 'background 0.15s',
              }}
              aria-label="Close"
            >
              ×
            </UnstyledButton>

            <PricingPill />

            <Text
              fw={900}
              ta="center"
              style={{
                fontSize: 30,
                lineHeight: 1.15,
                letterSpacing: '-0.5px',
                color: 'var(--mantine-color-text)',
              }}
            >
              Choose the Plex Plan That Fits You
            </Text>
            <Text size="sm" c="dimmed" ta="center" maw={460}>
              Upgrade to unlock the full set of PDF tools.
            </Text>
          </Stack>

          <Group
            align="stretch"
            gap={20}
            px={36}
            pb={32}
            style={{ flexWrap: 'nowrap' }}
          >
            {membershipView === 'free' ? (
              <>
                <PlanCard
                  isDark={isDark}
                  recommended
                  ribbonLabel="Best Choice"
                  ribbonGradient={LIFETIME_GRADIENT}
                  borderColor="#FF6D05"
                  planName="Lifetime Plan"
                  subTitle="BEST VALUE"
                  price="59"
                  period="/ ONCE"
                  features={LIFETIME_FEATURES}
                  checkGradient={LIFETIME_GRADIENT}
                  buttonGradient={LIFETIME_GRADIENT}
                  buttonShadow={LIFETIME_SHADOW}
                  footerNote="One-time purchase · No recurring charge"
                  onBuy={() => openCheckout('lifetime')}
                />

                <PlanCard
                  isDark={isDark}
                  ribbonLabel="Optional"
                  ribbonGradient={YEARLY_GRADIENT}
                  borderColor="#8B5CF6"
                  planName="Yearly Plan"
                  subTitle="Annual Subscription"
                  price="39"
                  period="/ year"
                  features={YEARLY_FEATURES}
                  checkGradient={YEARLY_GRADIENT}
                  buttonGradient={YEARLY_GRADIENT}
                  buttonShadow={YEARLY_SHADOW}
                  footerNote="Need help? Contact: support@yourpdf.com"
                  onBuy={() => openCheckout('yearly')}
                />
              </>
            ) : membershipView === 'year' ? (
              <Box style={{ width: '100%' }}>
                <Stack gap={10} mb={16} align="center">
                  <Text fw={800} size="lg" style={{ color: '#F59E0B' }}>
                    You are currently a Yearly VIP member
                  </Text>
                  <Text size="sm" c="dimmed">
                    Your yearly membership expires at: {yearExpiryText}
                  </Text>
                </Stack>
                <PlanCard
                  isDark={isDark}
                  recommended
                  ribbonLabel="Upgrade"
                  ribbonGradient={LIFETIME_GRADIENT}
                  borderColor="#FF6D05"
                  planName="Lifetime Plan"
                  subTitle="BEST VALUE"
                  price="59"
                  period="/ ONCE"
                  features={LIFETIME_FEATURES}
                  checkGradient={LIFETIME_GRADIENT}
                  buttonGradient={LIFETIME_GRADIENT}
                  buttonShadow={LIFETIME_SHADOW}
                  footerNote="Upgrade now and never worry about renewals."
                  onBuy={() => openCheckout('lifetime')}
                />
              </Box>
            ) : (
              <Box style={{ width: '100%' }}>
                <Stack align="center" py={40} gap={10}>
                  <Text fw={900} size="xl" style={{ color: '#F59E0B' }}>
                    Thank you for being a Lifetime VIP member!
                  </Text>
                  <Text size="sm" c="dimmed" ta="center" maw={520}>
                    Your account already has permanent premium access. We truly appreciate your support.
                  </Text>
                </Stack>
              </Box>
            )}
          </Group>
        </Stack>
      )}
    </Modal>
  );
}

function PricingPill() {
  return (
    <Box style={{ position: 'relative', marginBottom: 4 }}>
      <Box
        style={{
          padding: '4px 14px',
          borderRadius: 999,
          border: '1.5px solid #FF072D',
          color: '#FF072D',
          fontSize: 12,
          fontWeight: 700,
          letterSpacing: '0.3px',
          background: 'transparent',
        }}
      >
        Pricing
      </Box>
      <Box
        style={{
          position: 'absolute',
          left: '50%',
          bottom: -5,
          transform: 'translateX(-50%) rotate(45deg)',
          width: 8,
          height: 8,
          borderRight: '1.5px solid #FF072D',
          borderBottom: '1.5px solid #FF072D',
          background: 'var(--mantine-color-body)',
        }}
      />
    </Box>
  );
}

interface PlanCardProps {
  isDark: boolean;
  recommended?: boolean;
  ribbonLabel: string;
  ribbonGradient: string;
  borderColor: string;
  planName: string;
  subTitle: string;
  price: string;
  period: string;
  features: string[];
  checkGradient: string;
  buttonGradient: string;
  buttonShadow: string;
  footerNote: string;
  onBuy: () => void;
}

function PlanCard({
  isDark,
  ribbonLabel,
  ribbonGradient,
  borderColor,
  planName,
  subTitle,
  price,
  period,
  features,
  checkGradient,
  buttonGradient,
  buttonShadow,
  footerNote,
  onBuy,
}: PlanCardProps) {
  const cardBg = isDark
    ? 'linear-gradient(180deg, rgba(255,255,255,0.04) 0%, rgba(255,255,255,0.02) 100%)'
    : '#FFFFFF';
  const cardShadow = isDark
    ? '0 10px 30px -18px rgba(0,0,0,0.6)'
    : '0 10px 30px -18px rgba(15,23,42,0.18)';

  return (
    <Box
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        background: cardBg,
        border: `1.5px dashed ${borderColor}`,
        borderRadius: 20,
        padding: '26px 24px 22px',
        position: 'relative',
        boxShadow: cardShadow,
      }}
    >
      <Box
        style={{
          position: 'absolute',
          top: 18,
          right: 18,
          padding: '6px 14px',
          borderRadius: 999,
          background: ribbonGradient,
          color: '#FFFFFF',
          fontSize: 12,
          fontWeight: 700,
          letterSpacing: '0.2px',
          boxShadow: '0 6px 14px -4px rgba(0,0,0,0.25)',
          pointerEvents: 'none',
        }}
      >
        {ribbonLabel}
      </Box>

      <Text
        fw={800}
        style={{
          fontSize: 22,
          color: 'var(--mantine-color-text)',
          letterSpacing: '-0.3px',
        }}
      >
        {planName}
      </Text>
      <Text size="xs" c="dimmed" mt={2} mb={16} style={{ letterSpacing: '0.3px' }}>
        {subTitle}
      </Text>

      <Group gap={6} align="baseline" mb={18}>
        <Text
          style={{
            fontSize: 20,
            fontWeight: 800,
            color: 'var(--mantine-color-text)',
            lineHeight: 1,
          }}
        >
          $
        </Text>
        <Text
          fw={900}
          style={{
            fontSize: 48,
            lineHeight: 1,
            letterSpacing: '-1.5px',
            color: 'var(--mantine-color-text)',
          }}
        >
          {price}
        </Text>
        <Text size="sm" c="dimmed" fw={500}>
          {period}
        </Text>
      </Group>

      <Stack gap={10} mb={22} style={{ flex: 1 }}>
        {features.map((f) => (
          <Group key={f} gap={10} wrap="nowrap" align="center">
            <Box
              style={{
                width: 20,
                height: 20,
                borderRadius: '50%',
                background: checkGradient,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              <CheckIcon style={{ fontSize: 13, color: '#FFFFFF' }} />
            </Box>
            <Text size="sm" style={{ color: 'var(--mantine-color-text)' }}>
              {f}
            </Text>
          </Group>
        ))}
      </Stack>

      <button
        type="button"
        onPointerDown={() => console.log('[Paywall] buy-now pointerdown', planName)}
        onMouseDown={() => console.log('[Paywall] buy-now mousedown', planName)}
        onClick={(e) => {
          console.log('[Paywall] buy-now click', planName);
          (e.currentTarget as HTMLButtonElement).style.background = '#7C3AED';
          onBuy();
        }}
        style={{
          all: 'unset',
          display: 'block',
          boxSizing: 'border-box',
          width: '100%',
          padding: '14px 0',
          borderRadius: 999,
          background: buttonGradient,
          color: '#FFFFFF',
          fontSize: 15,
          fontWeight: 700,
          textAlign: 'center',
          boxShadow: buttonShadow,
          transition: 'transform 0.12s ease, box-shadow 0.12s ease',
          cursor: 'pointer',
          position: 'relative',
          zIndex: 10,
          pointerEvents: 'auto',
        }}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLButtonElement).style.transform =
            'translateY(-1px)';
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLButtonElement).style.transform =
            'translateY(0)';
        }}
      >
        Buy Now
      </button>

      <Text size="xs" c="dimmed" ta="center" mt={12} lh={1.4}>
        {footerNote}
      </Text>
    </Box>
  );
}
