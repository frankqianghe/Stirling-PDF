import React, { useCallback, useEffect, useState } from 'react';
import {
  Modal,
  Stack,
  Group,
  Text,
  Button,
  UnstyledButton,
  Box,
  Badge,
  List,
  ThemeIcon,
  Divider,
} from '@mantine/core';
import WorkspacePremiumIcon from '@mui/icons-material/WorkspacePremium';
import CheckIcon from '@mui/icons-material/Check';
import ShieldIcon from '@mui/icons-material/Shield';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { orderService } from '@app/services/orderService';
import { PaymentStatusPanel } from './PaymentStatusPanel';
import { useDesktopLicenseStatus } from '@app/hooks/useDesktopLicenseStatus';

const LIFETIME_FEATURES = [
  'Lifetime access, no subscription ever',
  'All 40+ PDF tools unlocked',
  'Offline processing — 100% private',
  'Unlimited file size & batch processing',
  'Free updates for life',
  'Priority email support',
];

const YEARLY_FEATURES = [
  'Annual subscription, cancel anytime',
  'All 40+ PDF tools unlocked',
  'Offline processing — 100% private',
  'Unlimited file size & batch processing',
  'Updates included during subscription',
  'Email support',
];

interface DesktopPaywallModalProps {
  opened: boolean;
  onClose: () => void;
  source?: string;
}

type PaywallView = 'plans' | 'status';

type MembershipView = 'free' | 'year' | 'lifetime';

export function DesktopPaywallModal({
  opened,
  onClose,
  source = 'unknown',
}: DesktopPaywallModalProps) {
  const [view, setView] = useState<PaywallView>('plans');
  const [currentOrderId, setCurrentOrderId] = useState<string | null>(null);
  const { plan, planExpiresAt } = useDesktopLicenseStatus();

  useEffect(() => {
    let unlisten: (() => void) | undefined;

    listen<string | null>('checkout-back-to-status', (event) => {
      const orderId = event.payload || orderService.getLastOrderId();
      if (orderId) {
        setCurrentOrderId(orderId);
        setView('status');
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
      setCurrentOrderId(null);
    }
  }, [opened]);

  const openCheckout = useCallback(
    async (plan: 'lifetime' | 'yearly') => {
      try {
        const createPlan = plan === 'yearly' ? 'year' : 'buyout';
        const order = await orderService.createOrder(createPlan);

        console.log('[Paywall] Order created:', {
          plan: createPlan,
          order_id: order.orderId,
          checkout_url: order.checkoutUrl,
          source,
        });

        setCurrentOrderId(order.orderId);

        await invoke('open_checkout_webview', {
          url: order.checkoutUrl,
          orderId: order.orderId,
        });
      } catch (err) {
        console.error('[Paywall] create order / open checkout failed:', err);
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

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={null}
      size={840}
      centered
      padding={0}
      withCloseButton={false}
      radius="lg"
      overlayProps={{ blur: 4, backgroundOpacity: 0.55 }}
      styles={{
        body: { padding: 0 },
        content: {
          background: 'var(--mantine-color-dark-7, #1A1D27)',
          border: '1px solid rgba(255,255,255,0.08)',
        },
      }}
    >
      {view === 'status' && currentOrderId ? (
        <PaymentStatusPanel orderId={currentOrderId} onDone={handleDone} />
      ) : (
        <Stack gap={0}>
          <Stack align="center" pt={40} pb={24} px={32} gap={12}>
            <UnstyledButton
              onClick={onClose}
              style={{
                position: 'absolute',
                top: 16,
                right: 16,
                width: 32,
                height: 32,
                borderRadius: '50%',
                background: 'rgba(255,255,255,0.08)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--mantine-color-dimmed)',
                fontSize: 18,
                lineHeight: 1,
                cursor: 'pointer',
                zIndex: 10,
                border: '1px solid rgba(255,255,255,0.10)',
                transition: 'background 0.15s',
              }}
              aria-label="Close"
            >
              ×
            </UnstyledButton>

            <Box
              style={{
                fontSize: 52,
                filter: 'drop-shadow(0 0 16px rgba(245,158,11,0.6))',
                animation: 'paywallFloat 3s ease-in-out infinite',
              }}
            >
              <WorkspacePremiumIcon
                sx={{ fontSize: '3.2rem', color: '#F59E0B' }}
              />
            </Box>
            <Text
              size="xl"
              fw={800}
              style={{
                background:
                  'linear-gradient(135deg, #FCD34D 0%, #F59E0B 50%, #D97706 100%)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                backgroundClip: 'text',
                letterSpacing: '-0.3px',
              }}
            >
              Unlock PlexPDF VIP
            </Text>
            <Text size="sm" c="dimmed" ta="center" maw={440}>
              Get unlimited access to all PDF tools, offline processing, and
              priority support — forever.
            </Text>
          </Stack>

          <Group
            align="stretch"
            gap={0}
            px={24}
            pb={24}
            style={{ flexWrap: 'nowrap' }}
          >
            {membershipView === 'free' ? (
              <>
                <PlanCard
                  recommended
                  badgeLabel="⭐ Best Value"
                  planName="Lifetime Plan"
                  description="Pay once, use forever. No recurring charges — ever."
                  price="$49"
                  period="one-time payment"
                  features={LIFETIME_FEATURES}
                  accentColor="#F59E0B"
                  accentBg="rgba(245,158,11,0.08)"
                  buttonLabel="Get Lifetime Access"
                  buttonColor="yellow"
                  onBuy={() => openCheckout('lifetime')}
                />

                <PlanCard
                  badgeLabel="🔄 Annual"
                  planName="Yearly Plan"
                  description="Full access with yearly billing. Cancel anytime."
                  price="$19"
                  period="/ year · $1.58 / month"
                  features={YEARLY_FEATURES}
                  accentColor="#3B82F6"
                  accentBg="rgba(59,130,246,0.06)"
                  buttonLabel="Start Yearly Plan"
                  buttonColor="blue"
                  savingsNote="Save 61% vs monthly"
                  onBuy={() => openCheckout('yearly')}
                />
              </>
            ) : membershipView === 'year' ? (
              <Box style={{ width: '100%' }}>
                <Stack gap={12} mb={16}>
                  <Text fw={800} size="lg" c="yellow">
                    You are currently a Yearly VIP member
                  </Text>
                  <Text size="sm" c="dimmed">
                    Your yearly membership expires at: {yearExpiryText}
                  </Text>
                </Stack>
                <PlanCard
                  recommended
                  badgeLabel="⬆ Upgrade"
                  planName="Lifetime Plan"
                  description="Upgrade now and never worry about renewals."
                  price="$49"
                  period="one-time payment"
                  features={LIFETIME_FEATURES}
                  accentColor="#F59E0B"
                  accentBg="rgba(245,158,11,0.08)"
                  buttonLabel="Upgrade to Lifetime"
                  buttonColor="yellow"
                  onBuy={() => openCheckout('lifetime')}
                />
              </Box>
            ) : (
              <Box style={{ width: '100%' }}>
                <Stack align="center" py={40} gap={10}>
                  <Text fw={900} size="xl" c="yellow">
                    Thank you for being a Lifetime VIP member!
                  </Text>
                  <Text size="sm" c="dimmed" ta="center" maw={520}>
                    Your account already has permanent premium access. We truly appreciate your support.
                  </Text>
                </Stack>
              </Box>
            )}
          </Group>

          <Divider color="rgba(255,255,255,0.06)" />
          <Stack align="center" py={16} gap={8}>
            <UnstyledButton
              onClick={onClose}
              style={{
                fontSize: 13,
                color: 'var(--mantine-color-dimmed)',
                textDecoration: 'underline',
                textDecorationColor: 'transparent',
                cursor: 'pointer',
                transition: 'color 0.15s',
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLButtonElement).style.color =
                  'var(--mantine-color-text)';
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLButtonElement).style.color =
                  'var(--mantine-color-dimmed)';
              }}
            >
              Continue with Free Version
            </UnstyledButton>
            <Group gap={6}>
              <ShieldIcon sx={{ fontSize: '0.9rem', color: 'rgba(156,163,175,0.5)' }} />
              <Text size="xs" c="dimmed">
                Payments secured by Lemon Squeezy · 30-day money-back guarantee
              </Text>
            </Group>
          </Stack>
        </Stack>
      )}

      <style>{`
        @keyframes paywallFloat {
          0%, 100% { transform: translateY(0); }
          50%       { transform: translateY(-5px); }
        }
      `}</style>
    </Modal>
  );
}

interface PlanCardProps {
  recommended?: boolean;
  badgeLabel: string;
  planName: string;
  description: string;
  price: string;
  period: string;
  features: string[];
  accentColor: string;
  accentBg: string;
  buttonLabel: string;
  buttonColor: 'yellow' | 'blue';
  savingsNote?: string;
  onBuy: () => void;
}

function PlanCard({
  recommended,
  badgeLabel,
  planName,
  description,
  price,
  period,
  features,
  accentColor,
  accentBg,
  buttonLabel,
  buttonColor,
  savingsNote,
  onBuy,
}: PlanCardProps) {
  return (
    <Box
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        background: recommended
          ? `linear-gradient(160deg, ${accentBg} 0%, rgba(0,0,0,0) 60%)`
          : 'transparent',
        border: recommended
          ? `1px solid ${accentColor}55`
          : '1px solid rgba(255,255,255,0.06)',
        borderRadius: 16,
        padding: '24px 20px 20px',
        margin: '0 8px',
        position: 'relative',
        boxShadow: recommended
          ? `0 0 32px ${accentColor}18`
          : undefined,
      }}
    >
      <Badge
        size="sm"
        variant="light"
        color={buttonColor}
        mb={12}
        style={{ alignSelf: 'flex-start' }}
      >
        {badgeLabel}
      </Badge>

      <Text fw={700} size="lg" mb={4} style={{ color: 'var(--mantine-color-text)' }}>
        {planName}
      </Text>
      <Text size="xs" c="dimmed" mb={20} lh={1.5}>
        {description}
      </Text>

      <Group gap={4} align="baseline" mb={4}>
        <Text size="xs" c="dimmed">$</Text>
        <Text
          fw={800}
          style={{ fontSize: 40, lineHeight: 1, letterSpacing: '-1px' }}
        >
          {price.replace('$', '')}
        </Text>
      </Group>
      <Text size="xs" c="dimmed" mb={20}>
        {period}
      </Text>

      <List
        spacing={8}
        mb={24}
        style={{ flex: 1 }}
        icon={
          <ThemeIcon
            size={18}
            radius="xl"
            color={buttonColor}
            variant="light"
          >
            <CheckIcon style={{ fontSize: 10 }} />
          </ThemeIcon>
        }
      >
        {features.map((f) => (
          <List.Item key={f}>
            <Text size="sm" c="dimmed" lh={1.4}>
              {f}
            </Text>
          </List.Item>
        ))}
      </List>

      <Button
        fullWidth
        color={buttonColor}
        size="md"
        radius="md"
        onClick={onBuy}
        fw={700}
      >
        {buttonLabel}
      </Button>

      {savingsNote ? (
        <Text size="xs" c="teal" ta="center" mt={8} fw={600}>
          {savingsNote}
        </Text>
      ) : (
        <Box style={{ height: 28 }} />
      )}
    </Box>
  );
}
