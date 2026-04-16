import { useEffect, useState } from 'react';
import { Alert, Box, Button, Loader, Stack, Text, ThemeIcon } from '@mantine/core';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import HourglassTopIcon from '@mui/icons-material/HourglassTop';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import { orderService, OrderStatus } from '@app/services/orderService';

interface PaymentStatusPanelProps {
  orderId: string;
  onDone: () => void;
}

export function PaymentStatusPanel({ orderId, onDone }: PaymentStatusPanelProps) {
  const [status, setStatus] = useState<OrderStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: number | null = null;

    const poll = async () => {
      try {
        const next = await orderService.getOrderStatus(orderId);
        if (cancelled) return;

        setStatus(next);
        setError(null);
        setLoading(false);

        if (!next.paid) {
          timer = window.setTimeout(poll, 2000);
        }
      } catch (err) {
        if (cancelled) return;
        setLoading(false);
        setError(err instanceof Error ? err.message : 'Failed to query payment status');
        timer = window.setTimeout(poll, 2000);
      }
    };

    poll();

    return () => {
      cancelled = true;
      if (timer !== null) {
        window.clearTimeout(timer);
      }
    };
  }, [orderId]);

  const paid = status?.paid === true;
  const displayStatus = status?.statusFormatted || 'Querying payment status...';

  return (
    <Stack align="center" px={36} pt={40} pb={32} gap={18}>
      <ThemeIcon
        size={72}
        radius="xl"
        color={paid ? 'teal' : error ? 'red' : 'blue'}
        variant="light"
      >
        {paid ? (
          <CheckCircleIcon sx={{ fontSize: '2.2rem' }} />
        ) : error ? (
          <ErrorOutlineIcon sx={{ fontSize: '2.2rem' }} />
        ) : (
          <HourglassTopIcon sx={{ fontSize: '2.2rem' }} />
        )}
      </ThemeIcon>

      <Stack gap={6} align="center">
        <Text size="xl" fw={800} ta="center">
          {paid ? 'Payment Successful' : 'Checking Payment Status'}
        </Text>
        <Text size="sm" c="dimmed" ta="center">
          Order ID: {orderId}
        </Text>
      </Stack>

      <Box
        style={{
          width: '100%',
          maxWidth: 460,
          borderRadius: 16,
          padding: 20,
          background: 'rgba(255,255,255,0.04)',
          border: '1px solid rgba(255,255,255,0.08)',
        }}
      >
        <Stack gap={12} align="center">
          {loading && !status ? <Loader size="sm" color="blue" /> : null}
          <Text fw={700} ta="center">
            {paid ? 'Your VIP access is now active.' : displayStatus}
          </Text>
          {!paid ? (
            <Text size="sm" c="dimmed" ta="center">
              We are polling the server every 2 seconds. Please complete the payment in the checkout window, then come back here.
            </Text>
          ) : (
            <Text size="sm" c="dimmed" ta="center">
              You can now close this dialog and continue using PlexPDF VIP features.
            </Text>
          )}
        </Stack>
      </Box>

      {error ? (
        <Alert color="red" variant="light" title="Query failed" maw={460}>
          {error}
        </Alert>
      ) : null}

      <Button size="md" radius="md" color={paid ? 'teal' : 'gray'} onClick={onDone}>
        {paid ? 'Done' : 'Close'}
      </Button>
    </Stack>
  );
}
