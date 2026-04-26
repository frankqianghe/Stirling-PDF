import { useContext } from 'react';
import { Button } from '@mantine/core';
import { useTranslation } from 'react-i18next';
import { Tooltip } from '@app/components/shared/Tooltip';
import { useBackendHealth } from '@app/hooks/useBackendHealth';
import { ToolWorkflowContext } from '@app/contexts/ToolWorkflowContext';
import { isBackendOptionalTool } from '@app/utils/backendOptionalTools';

export interface OperationButtonProps {
  onClick?: () => void;
  isLoading?: boolean;
  disabled?: boolean;
  loadingText?: string;
  submitText?: string;
  variant?: 'filled' | 'outline' | 'subtle';
  color?: string;
  fullWidth?: boolean;
  mt?: string;
  type?: 'button' | 'submit' | 'reset';
  'data-testid'?: string;
  'data-tour'?: string;
}

const OperationButton = ({
  onClick,
  isLoading = false,
  disabled = false,
  loadingText,
  submitText,
  variant = 'filled',
  color = 'blue',
  fullWidth = false,
  mt = 'md',
  type = 'button',
  'data-testid': dataTestId,
  'data-tour': dataTour
}: OperationButtonProps) => {
  const { t } = useTranslation();
  const { isHealthy, message: backendMessage } = useBackendHealth();
  // Optional context read — `OperationButton` is sometimes rendered
  // outside any tool flow (e.g. in tests), so we don't use the throwing
  // `useToolWorkflow()` hook here.
  const workflow = useContext(ToolWorkflowContext);
  const selectedToolKey = workflow?.selectedToolKey ?? null;
  const bypassBackendHealth = isBackendOptionalTool(selectedToolKey);
  const blockedByBackend = !isHealthy && !bypassBackendHealth;
  const combinedDisabled = disabled || blockedByBackend;
  const tooltipLabel = blockedByBackend
    ? (backendMessage ?? t('backendHealth.checking', 'Checking backend status...'))
    : null;

  const button = (
    <Button
      type={type}
      onClick={onClick}
      fullWidth={fullWidth}
      mr='md'
      ml='md'
      mt={mt}
      loading={isLoading}
      disabled={combinedDisabled}
      variant={variant}
      color={color}
      data-testid={dataTestId}
      data-tour={dataTour}
      style={{ minHeight: '2.5rem'  }}
    >
      {isLoading
        ? (loadingText || t("loading", "Loading..."))
        : (submitText || t("submit", "Submit"))
      }
    </Button>
  );

  if (tooltipLabel) {
    return (
      <Tooltip content={tooltipLabel} position="top" arrow>
        {button}
      </Tooltip>
    );
  }

  return button;
};

export default OperationButton;
