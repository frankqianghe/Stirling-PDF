import { useTranslation } from 'react-i18next';
import {
  useConfigNavSections as useCoreConfigNavSections,
  createConfigNavSections as createCoreConfigNavSections,
  ConfigNavSection,
  ConfigNavItem,
} from '@core/components/shared/config/configNavSections';
import ActivationSection from './configSections/ActivationSection';
import AboutSection from './configSections/AboutSection';

/**
 * Desktop settings navigation.
 *
 * Customized build: exposes General + Keyboard Shortcuts (inherited from
 * core) plus desktop-only "Activation" (manual License Key activation) and
 * "About" (version / update check / open log dir) entries. Other settings
 * remain on defaults and are not user-accessible.
 */
export const useConfigNavSections = (
  isAdmin: boolean = false,
  runningEE: boolean = false,
  loginEnabled: boolean = false
): ConfigNavSection[] => {
  const { t } = useTranslation();
  const sections = useCoreConfigNavSections(isAdmin, runningEE, loginEnabled);
  const activationItem: ConfigNavItem = {
    key: 'activation',
    label: t('settings.activation.navLabel', 'Activation'),
    icon: 'touch-app-rounded',
    component: <ActivationSection />,
  };
  const aboutItem: ConfigNavItem = {
    key: 'about',
    label: t('settings.about.navLabel', 'About'),
    icon: 'info-rounded',
    component: <AboutSection />,
  };
  return appendItems(sections, [activationItem, aboutItem]);
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
  const activationItem: ConfigNavItem = {
    key: 'activation',
    label: 'Activation',
    icon: 'touch-app-rounded',
    component: <ActivationSection />,
  };
  const aboutItem: ConfigNavItem = {
    key: 'about',
    label: 'About',
    icon: 'info-rounded',
    component: <AboutSection />,
  };
  return appendItems(sections, [activationItem, aboutItem]);
};

/**
 * Append the desktop-only items to the first ("Preferences") section so
 * they render right below "Keyboard Shortcuts". If core returned no
 * sections at all (degenerate case) we synthesize one.
 */
function appendItems(
  sections: ConfigNavSection[],
  extras: ConfigNavItem[]
): ConfigNavSection[] {
  if (sections.length === 0) {
    return [
      {
        title: 'Preferences',
        items: extras,
      },
    ];
  }
  return sections.map((section, index) => {
    if (index !== 0) return section;
    return {
      ...section,
      items: [...section.items, ...extras],
    };
  });
}
