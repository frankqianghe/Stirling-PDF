import { useTranslation } from 'react-i18next';
import {
  useConfigNavSections as useCoreConfigNavSections,
  createConfigNavSections as createCoreConfigNavSections,
  ConfigNavSection,
} from '@core/components/shared/config/configNavSections';
import ActivationSection from './configSections/ActivationSection';

/**
 * Desktop settings navigation.
 *
 * Customized build: exposes General + Keyboard Shortcuts (inherited from
 * core) plus a desktop-only "Activation" entry for manual License Key
 * activation. Other settings remain on defaults and are not user-accessible.
 */
export const useConfigNavSections = (
  isAdmin: boolean = false,
  runningEE: boolean = false,
  loginEnabled: boolean = false
): ConfigNavSection[] => {
  const { t } = useTranslation();
  const sections = useCoreConfigNavSections(isAdmin, runningEE, loginEnabled);
  return appendActivationItem(sections, t('settings.activation.navLabel', 'Activation'));
};

/**
 * Deprecated: Use useConfigNavSections hook instead
 */
export const createConfigNavSections = (
  isAdmin: boolean = false,
  runningEE: boolean = false,
  loginEnabled: boolean = false
): ConfigNavSection[] => {
  const sections = createCoreConfigNavSections(isAdmin, runningEE, loginEnabled);
  return appendActivationItem(sections, 'Activation');
};

function appendActivationItem(
  sections: ConfigNavSection[],
  label: string
): ConfigNavSection[] {
  const activationItem = {
    key: 'activation' as const,
    label,
    icon: 'touch-app-rounded',
    component: <ActivationSection />,
  };

  if (sections.length === 0) {
    return [
      {
        title: 'Preferences',
        items: [activationItem],
      },
    ];
  }

  // Append to the first (Preferences) section so "Activation" renders right
  // below "Keyboard Shortcuts".
  return sections.map((section, index) => {
    if (index !== 0) return section;
    return {
      ...section,
      items: [...section.items, activationItem],
    };
  });
}
