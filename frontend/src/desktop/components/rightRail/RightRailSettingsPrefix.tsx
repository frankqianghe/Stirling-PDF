import React, { useCallback, useState } from 'react';
import { ActionIcon } from '@mantine/core';
import WorkspacePremiumIcon from '@mui/icons-material/WorkspacePremium';
import { useTranslation } from 'react-i18next';
import { useDesktopLicenseStatus } from '@app/hooks/useDesktopLicenseStatus';
import { Tooltip } from '@app/components/shared/Tooltip';
import { useRightRailTooltipSide } from '@app/hooks/useRightRailTooltipSide';
import { useSidebarContext } from '@app/contexts/SidebarContext';
import { DesktopPaywallModal } from './DesktopPaywallModal';

interface RightRailSettingsPrefixProps {
  className?: string;
}

/**
 * Desktop override – shows a VIP / paid-license status icon above the theme
 * toggle button in the right rail.
 *
 * - Gold crown  : VIP licence activated on this device (non-interactive)
 * - Grey crown  : free / no licence – clicking opens the paywall modal
 */
export function RightRailSettingsPrefix(_props: RightRailSettingsPrefixProps) {
  const { t } = useTranslation();
  const { isVip, loading } = useDesktopLicenseStatus();
  const { sidebarRefs } = useSidebarContext();
  const { position: tooltipPosition, offset: tooltipOffset } = useRightRailTooltipSide(sidebarRefs);
  const [paywallOpen, setPaywallOpen] = useState(false);

  const handleClick = useCallback(() => {
    setPaywallOpen(true);
  }, []);

  if (loading) return null;

  const tooltipLabel = isVip
    ? t('rightRail.vipActive', 'VIP – License active')
    : t('rightRail.vipUpgrade', 'Upgrade to VIP');

  const iconColor = isVip ? '#F59E0B' : 'var(--right-rail-icon)';

  const button = (
    <ActionIcon
      variant="subtle"
      radius="md"
      className="right-rail-icon"
      onClick={handleClick}
      aria-label={tooltipLabel}
      style={{ cursor: 'pointer' }}
    >
      <WorkspacePremiumIcon
        sx={{
          fontSize: '1.5rem',
          color: iconColor,
          filter: isVip
            ? 'drop-shadow(0 0 4px rgba(245,158,11,0.6))'
            : undefined,
        }}
      />
    </ActionIcon>
  );

  const portalTarget =
    typeof document !== 'undefined' ? document.body : undefined;

  return (
    <>
      <Tooltip
        content={tooltipLabel}
        position={tooltipPosition}
        offset={tooltipOffset}
        arrow
        portalTarget={portalTarget}
      >
        <div className="right-rail-tooltip-wrapper">{button}</div>
      </Tooltip>

      <DesktopPaywallModal
        opened={paywallOpen}
        onClose={() => setPaywallOpen(false)}
        source="vip-icon"
      />
    </>
  );
}
