import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Modal,
  Stack,
  Group,
  Text,
  UnstyledButton,
  Box,
  Button,
  Loader,
  useComputedColorScheme,
} from '@mantine/core';
import CheckIcon from '@mui/icons-material/Check';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { useTranslation } from 'react-i18next';
import { orderService } from '@app/services/orderService';
import { deviceRegisterService } from '@app/services/deviceRegisterService';
import { PaymentSuccessPanel } from './PaymentSuccessPanel';
import { useDesktopLicenseStatus } from '@app/hooks/useDesktopLicenseStatus';
import { trackEvent } from '@app/services/eventReportService';

/**
 * Public redirect target sent to the order service when creating a checkout
 * session. After Lemon Squeezy completes the payment, the user's browser is
 * redirected to this hosted success page (which doubles as a download landing
 * page for users who haven't installed PlexPDF yet). Inside the desktop app
 * we no longer rely on this URL — payment success is detected via license
 * polling against `/client/device/register`.
 */
const CHECKOUT_REDIRECT_URL =
  'https://plexpdf-test.wenxstudio.ai/static/payments/success.html';

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

type PaywallView = 'plans' | 'waiting' | 'success';

/**
 * Polling cadence for the post-Buy-Now waiting view.
 *
 * We hand the actual checkout off to the user's *default browser* (rather
 * than embedding it in a WebView2 window) — Cloudflare's bot detection on
 * the Lemon Squeezy hosted page reliably flags the embedded WebView2 in
 * some Windows configurations and serves a JS challenge that never
 * renders, leaving the user staring at a blank page.  The system browser
 * already has the user's TLS / cookie footprint, so it sails right
 * through.
 *
 * Trade-off: we no longer get the redirect-URL navigation interception
 * that used to instantly tell us payment succeeded.  Instead, while the
 * waiting view is mounted we re-poll `/client/device/register` every
 * `POLL_INTERVAL_MS` for at most `POLL_MAX_DURATION_MS`.  When the server
 * starts returning a non-`free` `paid_plan`, we know payment landed.
 */
const POLL_INTERVAL_MS = 5_000;
const POLL_MAX_DURATION_MS = 15 * 60 * 1000;

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
  const { t } = useTranslation();
  const [view, setView] = useState<PaywallView>('plans');
  const [pendingCheckoutUrl, setPendingCheckoutUrl] = useState<string | null>(null);
  const [waitingError, setWaitingError] = useState<string | null>(null);
  const [openingBrowser, setOpeningBrowser] = useState(false);
  const [manualChecking, setManualChecking] = useState(false);
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

  // Listen for the checkout webview's page-load completion (emitted
  // by the Rust `open_checkout_webview` command's `on_page_load`
  // hook) and report a `lemonsqueezy_load_finished` analytics event
  // each time. The event fires only on `PageLoadEvent::Finished`, and
  // the success-redirect URL is filtered out on the Rust side, so
  // we don't need to deduplicate here. We do, however, scope the
  // listener to lemonsqueezy hosts to defend against any other host
  // that might somehow get redirected through this webview.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    listen<{ url?: string }>('checkout-page-loaded', (event) => {
      const url = event.payload?.url ?? '';
      console.log('[Paywall] 📄 checkout-page-loaded:', url);
      try {
        const host = new URL(url).hostname.toLowerCase();
        if (host.includes('lemonsqueezy')) {
          trackEvent('lemonsqueezy_load_finished', url);
        }
      } catch {
        // Invalid URL — skip telemetry rather than guessing.
      }
    }).then((fn) => {
      unlisten = fn;
    });
    return () => {
      if (unlisten) unlisten();
    };
  }, []);

  useEffect(() => {
    if (!opened) {
      setView('plans');
      setPendingCheckoutUrl(null);
      setWaitingError(null);
      setOpeningBrowser(false);
      setManualChecking(false);
    }
  }, [opened]);

  // Helper: open the order's hosted checkout URL in the user's default
  // browser via the Tauri opener plugin.  We lean on the system browser
  // rather than the embedded WebView2 so we don't have to fight
  // Cloudflare's bot detection on the Lemon Squeezy domain.
  const openCheckoutInBrowser = useCallback(async (url: string) => {
    setOpeningBrowser(true);
    setWaitingError(null);
    try {
      await invoke('plugin:opener|open_url', { url });
    } catch (err) {
      console.error('[Paywall] failed to open checkout URL in browser:', err);
      const message =
        err instanceof Error
          ? err.message
          : typeof err === 'string'
            ? err
            : 'Failed to open browser';
      setWaitingError(message);
    } finally {
      setOpeningBrowser(false);
    }
  }, []);

  // Auto-poll license status while we're sitting on the waiting view.
  // Stops on success, on unmount, on view change, or after 15 minutes
  // (a generous bound for hosted-checkout drop-off; user can manually
  // re-open the modal if they take longer).
  const pollStartedAtRef = useRef<number | null>(null);
  useEffect(() => {
    if (view !== 'waiting') {
      pollStartedAtRef.current = null;
      return;
    }
    if (pollStartedAtRef.current === null) {
      pollStartedAtRef.current = Date.now();
    }

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const tick = async () => {
      if (cancelled) return;
      try {
        const reg = await deviceRegisterService.register();
        if (cancelled) return;
        if (reg && reg.paidPlan && reg.paidPlan !== 'free') {
          console.log('[Paywall] 🎉 license polling detected paid plan:', reg.paidPlan);
          window.dispatchEvent(new Event('plexpdf-license-updated'));
          setView('success');
          return;
        }
      } catch (err) {
        // Swallow — registration endpoint can be flaky and we just retry.
        console.warn('[Paywall] license poll attempt failed (will retry):', err);
      }

      if (cancelled) return;
      const elapsed = Date.now() - (pollStartedAtRef.current ?? Date.now());
      if (elapsed >= POLL_MAX_DURATION_MS) {
        console.log('[Paywall] license polling window elapsed — stopping');
        return;
      }
      timer = setTimeout(tick, POLL_INTERVAL_MS);
    };

    timer = setTimeout(tick, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [view]);

  const openCheckout = useCallback(
    async (plan: 'lifetime' | 'yearly') => {
      const cachedToken = deviceRegisterService.getCachedToken();
      console.log('[Paywall] Buy Now clicked:', {
        plan,
        source,
        tokenPresent: !!cachedToken,
        tokenPrefix: cachedToken ? `${cachedToken.slice(0, 16)}...` : null,
      });

      // Telemetry: Buy Now click attribution. Spec key for the
      // lifetime plan is `checkout_order_lifttime` (sic — the spec
      // uses double `t`; preserved verbatim for server-side parity).
      trackEvent(
        plan === 'yearly' ? 'checkout_order_year' : 'checkout_order_lifttime',
        source,
      );

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

        // Switch to the waiting view *before* asking the OS to open the
        // browser — that way the user sees a coherent "we're handing
        // off to your browser" panel even on slow opens, instead of
        // staring at the plan selector.
        setPendingCheckoutUrl(order.checkoutUrl);
        setWaitingError(null);
        setView('waiting');
        await openCheckoutInBrowser(order.checkoutUrl);
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
    [source, openCheckoutInBrowser]
  );

  const handleDone = useCallback(() => {
    onClose();
  }, [onClose]);

  // "I've Paid · Check Status" handler in the waiting view.  Forces a
  // fresh /client/device/register call, dispatches a license-updated
  // event so the rest of the UI re-renders, and either flips us to the
  // success view (if paid) or surfaces a "not detected yet" hint.
  const handleManualCheck = useCallback(async () => {
    if (manualChecking) return;
    setManualChecking(true);
    setWaitingError(null);
    try {
      const reg = await deviceRegisterService.register();
      if (reg && reg.paidPlan && reg.paidPlan !== 'free') {
        window.dispatchEvent(new Event('plexpdf-license-updated'));
        setView('success');
        return;
      }
      setWaitingError(t('paywall.waiting.notDetectedYet', 'Payment not detected yet. Please complete payment in your browser, then try again.'));
    } catch (err) {
      console.error('[Paywall] manual license check failed:', err);
      const message =
        err instanceof Error
          ? err.message
          : typeof err === 'string'
            ? err
            : 'License check failed';
      setWaitingError(message);
    } finally {
      setManualChecking(false);
    }
  }, [manualChecking, t]);

  const handleBackToPlans = useCallback(() => {
    setView('plans');
    setPendingCheckoutUrl(null);
    setWaitingError(null);
  }, []);

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
      ) : view === 'waiting' ? (
        <PaywallWaitingPanel
          isDark={isDark}
          checkoutUrl={pendingCheckoutUrl}
          openingBrowser={openingBrowser}
          manualChecking={manualChecking}
          waitingError={waitingError}
          onClose={onClose}
          onReopenBrowser={() =>
            pendingCheckoutUrl && openCheckoutInBrowser(pendingCheckoutUrl)
          }
          onManualCheck={handleManualCheck}
          onBack={handleBackToPlans}
          closeBtnBg={closeBtnBg}
          closeBtnBorder={closeBtnBorder}
        />
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

interface PaywallWaitingPanelProps {
  isDark: boolean;
  checkoutUrl: string | null;
  openingBrowser: boolean;
  manualChecking: boolean;
  waitingError: string | null;
  onClose: () => void;
  onReopenBrowser: () => void;
  onManualCheck: () => void;
  onBack: () => void;
  closeBtnBg: string;
  closeBtnBorder: string;
}

/**
 * "Payment in progress" panel shown after Buy Now is clicked.
 *
 * The flow is intentionally browser-first: we hand the actual checkout
 * page off to the user's default browser (which sails through Lemon
 * Squeezy + Cloudflare bot detection), and use this panel to:
 *   - explain what's happening
 *   - show the URL with a copy/retry escape hatch in case the
 *     `opener` plugin failed to launch a browser
 *   - drive a manual "I've Paid · Check Status" button
 *   - host the auto-poll loop (hooked up by the parent via
 *     `setView('waiting')`) that flips us straight to the success
 *     view as soon as the server reports a non-free `paid_plan`.
 */
function PaywallWaitingPanel({
  isDark,
  checkoutUrl,
  openingBrowser,
  manualChecking,
  waitingError,
  onClose,
  onReopenBrowser,
  onManualCheck,
  onBack,
  closeBtnBg,
  closeBtnBorder,
}: PaywallWaitingPanelProps) {
  const { t } = useTranslation();

  const accentGradient = 'linear-gradient(135deg, #8B5CF6 0%, #C026D3 100%)';
  const accentShadow = '0 12px 28px -10px rgba(139, 92, 246, 0.55)';
  const cardBorder = isDark
    ? '1px solid rgba(255,255,255,0.08)'
    : '1px solid rgba(15,23,42,0.08)';
  const cardBg = isDark ? 'rgba(255,255,255,0.04)' : '#F9FAFB';

  return (
    <Box style={{ position: 'relative' }} pt={40} pb={32} px={36}>
      <UnstyledButton
        onClick={onClose}
        aria-label={t('paymentSuccess.closeAriaLabel', 'Close')}
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
      >
        ×
      </UnstyledButton>

      <Stack align="center" gap={14} mb={22}>
        <Box
          style={{
            width: 64,
            height: 64,
            borderRadius: '50%',
            background: accentGradient,
            boxShadow: accentShadow,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#FFFFFF',
          }}
        >
          <OpenInNewIcon style={{ fontSize: 30 }} />
        </Box>
        <Text fw={800} size="xl" ta="center" style={{ letterSpacing: '-0.3px' }}>
          {t('paywall.waiting.title', 'Complete payment in your browser')}
        </Text>
        <Text size="sm" c="dimmed" ta="center" maw={520} style={{ lineHeight: 1.55 }}>
          {t(
            'paywall.waiting.description',
            "We've opened the secure checkout page in your default browser. Once you complete the payment we'll automatically activate this device — no need to copy any license key.",
          )}
        </Text>
      </Stack>

      {openingBrowser && (
        <Group gap={10} justify="center" mb={14}>
          <Loader size="xs" />
          <Text size="sm" c="dimmed">
            {t('paywall.waiting.opening', 'Opening secure checkout in your browser…')}
          </Text>
        </Group>
      )}

      {checkoutUrl && (
        <Box
          style={{
            background: cardBg,
            border: cardBorder,
            borderRadius: 12,
            padding: '12px 14px',
            marginBottom: 14,
            wordBreak: 'break-all',
          }}
        >
          <Text size="xs" c="dimmed" mb={4}>
            {t(
              'paywall.waiting.errorOpenBrowser',
              "Couldn't open your browser. Please copy the link manually:",
            )}
          </Text>
          <Text size="xs" style={{ fontFamily: 'monospace', lineHeight: 1.5 }}>
            {checkoutUrl}
          </Text>
        </Box>
      )}

      {waitingError && (
        <Box
          style={{
            background: 'rgba(239, 68, 68, 0.08)',
            border: '1px solid rgba(239, 68, 68, 0.25)',
            borderRadius: 10,
            padding: '10px 14px',
            marginBottom: 14,
          }}
        >
          <Text size="xs" c="red.7" style={{ lineHeight: 1.5 }}>
            {waitingError}
          </Text>
        </Box>
      )}

      <Text size="xs" c="dimmed" ta="center" mb={18} style={{ lineHeight: 1.5 }}>
        {t(
          'paywall.waiting.hint',
          "If the payment page didn't open, click the button below to retry.",
        )}
      </Text>

      <Stack gap={10} mb={10}>
        <Button
          fullWidth
          size="md"
          radius="md"
          variant="light"
          leftSection={<OpenInNewIcon style={{ fontSize: 16 }} />}
          loading={openingBrowser}
          onClick={onReopenBrowser}
          disabled={!checkoutUrl}
        >
          {t('paywall.waiting.openInBrowser', 'Open Payment Page Again')}
        </Button>
        <Button
          fullWidth
          size="md"
          radius="md"
          loading={manualChecking}
          onClick={onManualCheck}
          styles={{
            root: {
              background: accentGradient,
              boxShadow: accentShadow,
              color: '#FFFFFF',
            },
          }}
        >
          {manualChecking
            ? t('paywall.waiting.checking', 'Checking…')
            : t('paywall.waiting.checkNow', "I've Paid · Check Status")}
        </Button>
        <Button
          fullWidth
          size="sm"
          radius="md"
          variant="subtle"
          color="gray"
          onClick={onBack}
        >
          {t('paywall.waiting.back', 'Back')}
        </Button>
      </Stack>
    </Box>
  );
}
