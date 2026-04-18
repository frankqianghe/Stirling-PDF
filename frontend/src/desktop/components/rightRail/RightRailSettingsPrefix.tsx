interface RightRailSettingsPrefixProps {
  className?: string;
}

/**
 * Desktop override – previously rendered a VIP gold-crown indicator for paid
 * users. That indicator is no longer needed (activation state can be seen on
 * the Settings → Activation page), so this is now a no-op that simply shadows
 * the core stub.
 */
export function RightRailSettingsPrefix(_props: RightRailSettingsPrefixProps) {
  return null;
}
