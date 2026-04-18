import { Box } from '@mantine/core';
import { PaywallTopEntry } from '@app/components/PaywallTopEntry';

/**
 * Desktop override – renders the Lifetime Access paywall entry at the
 * bottom-right corner of the Workbench, floating above the Footer.
 * Parent Workbench is `position: relative`, so this absolute-positioned
 * container sits inside its own content area.
 *
 * The underlying <PaywallTopEntry /> handles visibility (free-plan users only).
 */
export function WorkbenchCornerExtensions() {
  return (
    <Box
      style={{
        position: 'absolute',
        bottom: 'calc(var(--footer-height, 2rem) + 12px)',
        right: 14,
        zIndex: 50,
        pointerEvents: 'none',
      }}
    >
      <Box style={{ pointerEvents: 'auto' }}>
        <PaywallTopEntry />
      </Box>
    </Box>
  );
}
