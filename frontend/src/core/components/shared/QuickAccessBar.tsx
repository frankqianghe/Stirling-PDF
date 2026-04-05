import React, { useState, useRef, forwardRef, useEffect, useMemo } from "react";
import { Stack, Divider, Indicator } from "@mantine/core";
import { useTranslation } from 'react-i18next';
import { useNavigate, useLocation } from 'react-router-dom';
import LocalIcon from '@app/components/shared/LocalIcon';
import { useRainbowThemeContext } from "@app/components/shared/RainbowThemeProvider";
import { useFilesModalContext } from '@app/contexts/FilesModalContext';
import { useToolWorkflow } from '@app/contexts/ToolWorkflowContext';
import { useNavigationState, useNavigationActions } from '@app/contexts/NavigationContext';
import { useSidebarNavigation } from '@app/hooks/useSidebarNavigation';
import { handleUnlessSpecialClick } from '@app/utils/clickHandlers';
import { ButtonConfig } from '@app/types/sidebar';
import '@app/components/shared/quickAccessBar/QuickAccessBar.css';
import AllToolsNavButton from '@app/components/shared/AllToolsNavButton';
import ActiveToolButton from "@app/components/shared/quickAccessBar/ActiveToolButton";
import AppConfigModal from '@app/components/shared/AppConfigModal';
import { useAppConfig } from '@app/contexts/AppConfigContext';
import { useLicenseAlert } from "@app/hooks/useLicenseAlert";
import { useTaskContext } from '@app/contexts/TaskContext';
import QuickAccessButton from '@app/components/shared/quickAccessBar/QuickAccessButton';

import {
  isNavButtonActive,
  getNavButtonStyle,
  getActiveNavButton,
} from '@app/components/shared/quickAccessBar/QuickAccessBar';

const QuickAccessBar = forwardRef<HTMLDivElement>((_, ref) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const { isRainbowMode } = useRainbowThemeContext();
  const { openFilesModal, isFilesModalOpen } = useFilesModalContext();
  const { handleReaderToggle, selectedToolKey, leftPanelView, toolRegistry, readerMode, toolAvailability, setLeftPanelView } = useToolWorkflow();
  const { hasUnsavedChanges } = useNavigationState();
  const { actions: navigationActions } = useNavigationActions();
  const { getToolNavigation } = useSidebarNavigation();
  const { config } = useAppConfig();
  const licenseAlert = useLicenseAlert();
  const { taskBadge } = useTaskContext();
  const [configModalOpen, setConfigModalOpen] = useState(false);
  const [activeButton, setActiveButton] = useState<string>('tools');
  const scrollableRef = useRef<HTMLDivElement>(null);

  // Open modal if URL is at /settings/*
  useEffect(() => {
    const isSettings = location.pathname.startsWith('/settings');
    setConfigModalOpen(isSettings);
  }, [location.pathname]);

  useEffect(() => {
    if (leftPanelView === 'tasks') {
      setActiveButton('tasks');
    } else {
      const next = getActiveNavButton(selectedToolKey, readerMode);
      setActiveButton(next);
    }
  }, [leftPanelView, selectedToolKey, toolRegistry, readerMode]);

  const handleFilesButtonClick = () => {
    openFilesModal();
  };

  // Helper function to render navigation buttons with URL support
  const renderNavButton = (config: ButtonConfig, index: number, shouldGuardNavigation = false) => {
    const isActive = isNavButtonActive(config, activeButton, isFilesModalOpen, configModalOpen, selectedToolKey, leftPanelView);

    // Check if this button has URL navigation support
    const navProps = config.type === 'navigation' && config.id === 'read'
      ? getToolNavigation(config.id)
      : null;

    const handleClick = (e?: React.MouseEvent) => {
      // If there are unsaved changes and this button should guard navigation, show warning modal
      if (shouldGuardNavigation && hasUnsavedChanges) {
        e?.preventDefault();
        navigationActions.requestNavigation(() => {
          config.onClick();
        });
        return;
      }
      if (navProps && e) {
        handleUnlessSpecialClick(e, config.onClick);
      } else {
        config.onClick();
      }
    };

    const buttonStyle = getNavButtonStyle(config, activeButton, isFilesModalOpen, configModalOpen, selectedToolKey, leftPanelView);

    // Render navigation button with conditional URL support
    return (
      <div
        key={config.id}
        style={{ marginTop: index === 0 ? '0.5rem' : "0rem" }}
      >
        <QuickAccessButton
          icon={config.icon}
          label={config.name}
          isActive={isActive}
          onClick={handleClick}
          href={navProps?.href}
          ariaLabel={config.name}
          backgroundColor={buttonStyle.backgroundColor}
          color={buttonStyle.color}
          component={navProps ? 'a' : 'button'}
          dataTestId={`${config.id}-button`}
          dataTour={`${config.id}-button`}
          badge={config.badge}
        />
      </div>
    );
  };

  const mainButtons: ButtonConfig[] = useMemo(() => [
    {
      id: 'read',
      name: t("quickAccess.reader", "Reader"),
      icon: <LocalIcon icon="menu-book-rounded" width="1.25rem" height="1.25rem" />,
      size: 'md' as const,
      isRound: false,
      type: 'navigation' as const,
      onClick: () => {
        setActiveButton('read');
        handleReaderToggle();
      }
    },
  ].filter(button => {
    // Filter out buttons for disabled tools
    // 'read' is always available (viewer mode)
    if (button.id === 'read') return true;
    // Check if tool is actually available (not just present in registry)
    const availability = toolAvailability[button.id as keyof typeof toolAvailability];
    return availability?.available !== false;
  }), [t, setActiveButton, handleReaderToggle, toolAvailability]);

  const middleButtons: ButtonConfig[] = [
    {
      id: 'files',
      name: t("quickAccess.files", "Files"),
      icon: <LocalIcon icon="folder-rounded" width="1.25rem" height="1.25rem" />,
      isRound: true,
      size: 'md',
      type: 'modal',
      onClick: handleFilesButtonClick
    },
  ];
  //TODO: Activity
  //{
  //  id: 'activity',
  //  name: t("quickAccess.activity", "Activity"),
  //  icon: <LocalIcon icon="vital-signs-rounded" width="1.25rem" height="1.25rem" />,
  //  isRound: true,
  //  size: 'lg',
  //  type: 'navigation',
  //  onClick: () => setActiveButton('activity')
  //},

  // Determine if settings button should be hidden
  // Hide when login is disabled AND showSettingsWhenNoLogin is false
  const shouldHideSettingsButton =
    config?.enableLogin === false &&
    config?.showSettingsWhenNoLogin === false;

  const taskBadgeNode = taskBadge ? (
    <div
      style={{
        minWidth: 16,
        height: 16,
        borderRadius: 8,
        backgroundColor:
          taskBadge.type === 'count'
            ? 'var(--mantine-color-blue-6)'
            : taskBadge.type === 'success'
              ? 'var(--mantine-color-green-6)'
              : 'var(--mantine-color-red-6)',
        color: '#fff',
        fontSize: 10,
        fontWeight: 700,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '0 4px',
        lineHeight: 1,
        boxShadow: '0 0 0 2px var(--bg-muted)',
      }}
    >
      {taskBadge.type === 'count'
        ? taskBadge.count
        : taskBadge.type === 'success'
          ? '✓'
          : '✕'}
    </div>
  ) : undefined;

  const bottomButtons: ButtonConfig[] = [
    {
      id: 'tasks',
      name: t("quickAccess.tasks", "任务"),
      icon: <LocalIcon icon="task-alt-rounded" width="1.25rem" height="1.25rem" />,
      size: 'md' as const,
      type: 'navigation' as const,
      onClick: () => {
        setActiveButton('tasks');
        setLeftPanelView('tasks');
      },
      badge: taskBadgeNode,
    },
    ...(shouldHideSettingsButton ? [] : [{
      id: 'config',
      name: t("quickAccess.settings", "Settings"),
      icon: <LocalIcon icon="settings-rounded" width="1.25rem" height="1.25rem" />,
      size: 'md' as const,
      type: 'modal' as const,
      onClick: () => {
        navigate('/settings/overview');
        setConfigModalOpen(true);
      }
    } as ButtonConfig])
  ];

  return (
    <div
      ref={ref}
      data-sidebar="quick-access"
      data-tour="quick-access-bar"
      className={`h-screen flex flex-col w-16 quick-access-bar-main ${isRainbowMode ? 'rainbow-mode' : ''}`}
    >
      {/* Fixed header outside scrollable area */}
      <div className="quick-access-header">
        <ActiveToolButton activeButton={activeButton} setActiveButton={setActiveButton} />
        <AllToolsNavButton activeButton={activeButton} setActiveButton={setActiveButton} />

      </div>


      {/* Scrollable content area */}
      <div
        ref={scrollableRef}
        className="quick-access-bar flex-1"
        onWheel={(e) => {
          // Prevent the wheel event from bubbling up to parent containers
          e.stopPropagation();
        }}
      >
        <div className="scrollable-content">
          {/* Main navigation section */}
          <Stack gap="lg" align="stretch">
            {mainButtons.map((config, index) => (
              <React.Fragment key={config.id}>
                {renderNavButton(config, index, config.id === 'read')}
              </React.Fragment>
            ))}
          </Stack>

          {/* Middle section */}
          {middleButtons.length > 0 && (
            <>
              <Divider
                size="xs"
                className="content-divider"
              />
              <Stack gap="lg" align="stretch">
                {middleButtons.map((config, index) => (
                  <React.Fragment key={config.id}>
                    {renderNavButton(config, index)}
                  </React.Fragment>
                ))}
              </Stack>
            </>
          )}

          {/* Spacer to push bottom buttons to bottom */}
          <div className="spacer" />

          {/* Bottom section */}
          <Stack gap="lg" align="stretch">
            {bottomButtons.map((buttonConfig, index) => {
              const buttonNode = renderNavButton(buttonConfig, index);
              const shouldShowSettingsBadge =
                buttonConfig.id === 'config' &&
                licenseAlert.active &&
                licenseAlert.audience === 'admin';

              return (
                <React.Fragment key={buttonConfig.id}>
                  {shouldShowSettingsBadge ? (
                    <Indicator
                      inline
                      size={12}
                      color="orange"
                      position="top-end"
                      offset={4}
                    >
                      {buttonNode}
                    </Indicator>
                  ) : (
                    buttonNode
                  )}
                </React.Fragment>
              );
            })}
          </Stack>
        </div>
      </div>

      <AppConfigModal
        opened={configModalOpen}
        onClose={() => setConfigModalOpen(false)}
      />
    </div>
  );
});

QuickAccessBar.displayName = 'QuickAccessBar';

export default QuickAccessBar;
