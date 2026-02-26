import { useConfigNavSections as useCoreConfigNavSections, createConfigNavSections as createCoreConfigNavSections, ConfigNavSection } from '@core/components/shared/config/configNavSections';

/**
 * Proprietary settings navigation.
 *
 * Customized build: only expose General + Keyboard Shortcuts.
 * Other settings remain on defaults and are not user-accessible.
 */
export const useConfigNavSections = (
  isAdmin: boolean = false,
  runningEE: boolean = false,
  loginEnabled: boolean = false
): ConfigNavSection[] => {
  return useCoreConfigNavSections(isAdmin, runningEE, loginEnabled);
};

/**
 * Deprecated: Use useConfigNavSections hook instead
 */
export const createConfigNavSections = (
  isAdmin: boolean = false,
  runningEE: boolean = false,
  loginEnabled: boolean = false
): ConfigNavSection[] => {
  return createCoreConfigNavSections(isAdmin, runningEE, loginEnabled);
};

// Re-export types for convenience
export type { ConfigNavSection, ConfigNavItem, ConfigColors } from '@core/components/shared/config/configNavSections';

