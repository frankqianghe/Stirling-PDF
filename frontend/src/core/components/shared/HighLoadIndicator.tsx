import React from 'react';
import { Box, Group, Tooltip, ActionIcon, Text, Switch } from '@mantine/core';
import { useTranslation } from 'react-i18next';
import { TbBolt, TbX } from 'react-icons/tb';
import { usePreferences } from '@app/contexts/PreferencesContext';

interface HighLoadIndicatorProps {
  showToggle?: boolean;
  compact?: boolean;
}

/**
 * 高负载模式指示器
 * 在处理超大PDF时显示，提醒用户系统已优化处理以保护稳定性
 */
export const HighLoadIndicator: React.FC<HighLoadIndicatorProps> = ({ 
  showToggle = true,
  compact = false 
}) => {
  const { t } = useTranslation();
  const { preferences, setPreference } = usePreferences();
  
  // 从偏好设置中获取高负载模式状态
  const highLoadModeEnabled = preferences?.highLoadModeEnabled ?? true;

  const handleToggle = (checked: boolean) => {
    setPreference?.('highLoadModeEnabled', checked);
  };

  if (compact) {
    return (
      <Tooltip
        label={t(
          'highLoadMode.tooltip',
          '已启用高负载模式保护，优化处理以避免系统卡顿'
        )}
        position="bottom"
      >
        <ActionIcon
          variant="subtle"
          color="orange"
          size="sm"
        >
          <TbBolt size={16} />
        </ActionIcon>
      </Tooltip>
    );
  }

  return (
    <Box
      sx={(theme) => ({
        backgroundColor: theme.colorScheme === 'dark' 
          ? 'rgba(255, 152, 0, 0.1)' 
          : 'rgba(255, 152, 0, 0.08)',
        borderRadius: theme.radius.sm,
        padding: '8px 12px',
        border: `1px solid ${theme.colors.orange[6]}40`,
      })}
    >
      <Group spacing="xs" position="apart">
        <Group spacing="xs">
          <TbBolt size={18} color="var(--mantine-color-orange-6)" />
          <Text size="sm" color="orange.7">
            {t(
              'highLoadMode.title',
              '⚡ 高负载模式'
            )}
          </Text>
          <Text size="xs" color="dimmed">
            {t(
              'highLoadMode.description',
              '已优化处理以保护系统稳定性'
            )}
          </Text>
        </Group>
        
        {showToggle && (
          <Tooltip
            label={t(
              'highLoadMode.toggleTooltip',
              '关闭后可能导致处理超大PDF时系统变慢'
            )}
            position="left"
          >
            <Switch
              size="sm"
              checked={highLoadModeEnabled}
              onChange={(e) => handleToggle(e.currentTarget.checked)}
              label={t('highLoadMode.enabled', '保护')}
              labelPosition="left"
              color="orange"
            />
          </Tooltip>
        )}
      </Group>
    </Box>
  );
};

export default HighLoadIndicator;
