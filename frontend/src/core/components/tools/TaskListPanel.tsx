import React, { useEffect, useMemo, useRef, useState } from 'react';
import { isTauri } from '@tauri-apps/api/core';
import {
  Stack,
  Text,
  Group,
  Badge,
  ScrollArea,
  Box,
  ActionIcon,
  Modal,
  Button,
  Progress,
  Tooltip,
  Menu,
} from '@mantine/core';
import { useTranslation } from 'react-i18next';
import LocalIcon from '@app/components/shared/LocalIcon';
import { useTaskContext } from '@app/contexts/TaskContext';
import {
  downloadTaskOutput,
  type TaskStatus,
  type ConvertTask,
} from '@app/services/taskService';
import {
  getLastErrorReason,
  openTaskLog,
} from '@app/services/taskLogService';

type DisplayStatus = 'success' | 'processing' | 'failed';

const STATUS_STYLE: Record<DisplayStatus, { color: string; icon: string }> = {
  success: { color: 'green', icon: 'check-circle-rounded' },
  processing: { color: 'blue', icon: 'progress-activity' },
  failed: { color: 'red', icon: 'cancel-rounded' },
};

function mapStatus(status: TaskStatus): DisplayStatus {
  if (status === 'completed') return 'success';
  if (status === 'in_progress') return 'processing';
  return 'failed';
}

function getDownloadFileName(task: ConvertTask): string {
  const baseName = task.fileName.replace(/\.[^.]+$/, '');
  return `${baseName}.${task.toFormat}`;
}

interface ContextMenuState {
  task: ConvertTask;
  x: number;
  y: number;
}

export default function TaskListPanel() {
  const { t } = useTranslation();
  const { tasks, removeTask, updateTask } = useTaskContext();
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; fileName: string } | null>(null);
  const [downloadProgress, setDownloadProgress] = useState<Record<string, number>>({});
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [failureReasons, setFailureReasons] = useState<Record<string, string>>({});
  const downloadingRef = useRef<Set<string>>(new Set());

  const statusLabels = useMemo<Record<DisplayStatus, string>>(() => ({
    success: t('taskList.statusSuccess', 'Converted'),
    processing: t('taskList.statusProcessing', 'Processing'),
    failed: t('taskList.statusFailed', 'Failed'),
  }), [t]);

  // Hydrate failure reasons for tasks that failed without a populated `failureReason`
  // (e.g. legacy entries from before logging was introduced).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const updates: Record<string, string> = {};
      for (const task of tasks) {
        if (task.status !== 'failed') continue;
        if (failureReasons[task.id] !== undefined) continue;
        if (task.failureReason) {
          updates[task.id] = task.failureReason;
          continue;
        }
        if (task.logId) {
          const reason = await getLastErrorReason(task.logId);
          if (reason) updates[task.id] = reason;
        }
      }
      if (!cancelled && Object.keys(updates).length > 0) {
        setFailureReasons(prev => ({ ...prev, ...updates }));
      }
    })();
    return () => { cancelled = true; };
  }, [tasks, failureReasons]);

  const handleConfirmDelete = () => {
    if (deleteTarget) {
      removeTask(deleteTarget.id);
      setDeleteTarget(null);
    }
  };

  async function openFileFolder(filePath: string) {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('plugin:opener|reveal_item_in_dir', { paths: [filePath] });
  }

  async function handleTaskClick(task: ConvertTask) {
    if (task.status !== 'completed') return;
    if (downloadingRef.current.has(task.id)) return;

    if (!isTauri()) {
      if (task.outputUrl) window.open(task.outputUrl, '_blank');
      return;
    }

    try {
      const { downloadDir, join } = await import('@tauri-apps/api/path');

      if (task.localPath) {
        try {
          await openFileFolder(task.localPath);
          return;
        } catch {
          // file may have been deleted, fall through to re-download
        }
      }

      const dlDir = await downloadDir();
      const fileName = getDownloadFileName(task);
      const savePath = await join(dlDir, fileName);

      downloadingRef.current.add(task.id);
      setDownloadProgress(prev => ({ ...prev, [task.id]: 0 }));

      try {
        const response = await downloadTaskOutput(task.id, task.outputUrl);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        const contentLength = Number(response.headers.get('Content-Length') || 0);
        const reader = response.body!.getReader();
        const chunks: Uint8Array[] = [];
        let received = 0;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
          received += value.length;
          if (contentLength > 0) {
            setDownloadProgress(prev => ({
              ...prev,
              [task.id]: Math.round((received / contentLength) * 100),
            }));
          } else {
            setDownloadProgress(prev => ({
              ...prev,
              [task.id]: Math.min(95, (prev[task.id] || 0) + 2),
            }));
          }
        }

        const allData = new Uint8Array(received);
        let pos = 0;
        for (const chunk of chunks) {
          allData.set(chunk, pos);
          pos += chunk.length;
        }

        const { writeFile } = await import('@tauri-apps/plugin-fs');
        await writeFile(savePath, allData);

        updateTask(task.id, { localPath: savePath });
        setDownloadProgress(prev => ({ ...prev, [task.id]: 100 }));

        await openFileFolder(savePath);

        setTimeout(() => {
          setDownloadProgress(prev => {
            const { [task.id]: _, ...rest } = prev;
            return rest;
          });
        }, 1500);
      } finally {
        downloadingRef.current.delete(task.id);
      }
    } catch (err) {
      console.error('[TaskList] Download failed:', err);
      setDownloadProgress(prev => {
        const { [task.id]: _, ...rest } = prev;
        return rest;
      });
      if (task.outputUrl) window.open(task.outputUrl, '_blank');
    }
  }

  function handleContextMenu(e: React.MouseEvent, task: ConvertTask) {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ task, x: e.clientX, y: e.clientY });
  }

  async function handleOpenLog(task: ConvertTask) {
    setContextMenu(null);
    if (!task.logId) {
      console.warn('[TaskList] Task has no logId, nothing to open:', task.id);
      return;
    }
    try {
      await openTaskLog(task.logId);
    } catch (err) {
      console.error('[TaskList] Failed to open task log:', err);
    }
  }

  function failureLabel(task: ConvertTask): string {
    const reason =
      task.failureReason ||
      failureReasons[task.id] ||
      t('taskList.unknownError', 'Unknown error. Right-click to open log file for details.');
    return reason;
  }

  return (
    <>
      <style>{`@keyframes spin{0%{transform:rotate(0deg)}100%{transform:rotate(360deg)}}`}</style>
      <ScrollArea h="100%" p="sm">
        <Stack gap={0}>
          <Group px="sm" py="xs" mb="xs">
            <LocalIcon icon="task-alt-rounded" width="1.1rem" height="1.1rem" />
            <Text size="sm" fw={600}>{t('taskList.title', 'Task List')}</Text>
            <Badge size="sm" variant="light" color="gray" ml="auto">
              {tasks.length}
            </Badge>
          </Group>

          {tasks.length === 0 && (
            <Text size="sm" c="dimmed" ta="center" py="xl">
              {t('taskList.empty', 'No conversion tasks')}
            </Text>
          )}

          {tasks.map((task) => {
            const displayStatus = mapStatus(task.status);
            const statusCfg = STATUS_STYLE[displayStatus];
            const statusLabel = statusLabels[displayStatus];
            const progress = downloadProgress[task.id];
            const isDownloading = progress !== undefined;
            const isFailed = displayStatus === 'failed';
            const canRevealOutput = task.status === 'completed' && isTauri();
            const revealOutputLabel = t('taskList.revealOutput', 'Show converted file in folder');

            const badge = (
              <Badge
                size="sm"
                variant="light"
                color={statusCfg.color}
                style={isFailed ? { cursor: 'help' } : undefined}
                leftSection={
                  <LocalIcon
                    icon={statusCfg.icon}
                    width="0.75rem"
                    height="0.75rem"
                    style={displayStatus === 'processing' ? {
                      animation: 'spin 1.2s linear infinite',
                    } : undefined}
                  />
                }
              >
                {statusLabel}
              </Badge>
            );

            return (
              <Box
                key={task.id}
                px="sm"
                py="xs"
                style={{
                  borderRadius: 'var(--mantine-radius-sm)',
                  transition: 'background-color 0.15s ease',
                  cursor: task.status === 'completed' && (isTauri() || task.outputUrl) ? 'pointer' : 'default',
                }}
                className="hover:bg-[var(--bg-hover)]"
                onClick={() => handleTaskClick(task)}
                onContextMenu={(e) => handleContextMenu(e, task)}
              >
                <Group justify="space-between" wrap="nowrap" gap="xs">
                  <Group
                    gap="xs"
                    wrap="nowrap"
                    style={{ flex: 1, minWidth: 0 }}
                  >
                    <LocalIcon
                      icon="picture-as-pdf"
                      width="1rem"
                      height="1rem"
                      style={{ flexShrink: 0, color: 'var(--mantine-color-red-6)' }}
                    />
                    <Text
                      size="sm"
                      truncate="end"
                      style={{ flex: 1, minWidth: 0 }}
                    >
                      {task.fileName}
                    </Text>
                  </Group>

                  <Group gap={4} wrap="nowrap" style={{ flexShrink: 0 }}>
                    {isFailed ? (
                      <Tooltip
                        multiline
                        w={280}
                        withArrow
                        label={
                          <Stack gap={4}>
                            <Text size="xs" fw={600}>
                              {t('taskList.failureTooltipTitle', 'Failure reason')}
                            </Text>
                            <Text size="xs">{failureLabel(task)}</Text>
                            <Text size="xs" c="dimmed">
                              {t('taskList.openLogHint', 'Right-click → Open log file for full details.')}
                            </Text>
                          </Stack>
                        }
                      >
                        {badge}
                      </Tooltip>
                    ) : (
                      badge
                    )}

                    {canRevealOutput && (
                      <Tooltip label={revealOutputLabel} withArrow>
                        <ActionIcon
                          size="sm"
                          variant="subtle"
                          color="gray"
                          loading={isDownloading}
                          aria-label={revealOutputLabel}
                          onClick={(e) => {
                            e.stopPropagation();
                            void handleTaskClick(task);
                          }}
                        >
                          <LocalIcon icon="folder-open-rounded" width="0.875rem" height="0.875rem" />
                        </ActionIcon>
                      </Tooltip>
                    )}

                    <ActionIcon
                      size="sm"
                      variant="subtle"
                      color="gray"
                      onClick={(e) => {
                        e.stopPropagation();
                        setDeleteTarget({ id: task.id, fileName: task.fileName });
                      }}
                    >
                      <LocalIcon icon="delete-rounded" width="0.875rem" height="0.875rem" />
                    </ActionIcon>
                  </Group>
                </Group>

                {isDownloading && (
                  <Progress
                    value={progress}
                    size="xs"
                    mt={6}
                    color={progress >= 100 ? 'green' : 'blue'}
                    animated={progress < 100}
                  />
                )}
              </Box>
            );
          })}
        </Stack>
      </ScrollArea>

      <Modal
        opened={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        title={t('taskList.deleteTitle', 'Delete task')}
        centered
        size="sm"
      >
        <Text size="sm" mb="lg">
          {t('taskList.deleteConfirmPrefix', 'Are you sure you want to delete the task')}{' '}
          <Text span fw={600}>"{deleteTarget?.fileName}"</Text>
          {t('taskList.deleteConfirmSuffix', '?')}
        </Text>
        <Group justify="flex-end" gap="sm">
          <Button variant="default" onClick={() => setDeleteTarget(null)}>
            {t('taskList.cancel', 'Cancel')}
          </Button>
          <Button color="red" onClick={handleConfirmDelete}>
            {t('taskList.delete', 'Delete')}
          </Button>
        </Group>
      </Modal>

      {contextMenu && (
        <Menu
          opened
          onClose={() => setContextMenu(null)}
          position="bottom-start"
          withinPortal
          shadow="md"
          width={200}
        >
          <Menu.Target>
            {/* Invisible anchor positioned at the cursor. */}
            <div
              style={{
                position: 'fixed',
                top: contextMenu.y,
                left: contextMenu.x,
                width: 1,
                height: 1,
                pointerEvents: 'none',
              }}
            />
          </Menu.Target>
          <Menu.Dropdown>
            <Menu.Item
              leftSection={<LocalIcon icon="article-rounded" width="1rem" height="1rem" />}
              disabled={!contextMenu.task.logId}
              onClick={() => handleOpenLog(contextMenu.task)}
            >
              {t('taskList.openLog', 'Open log file')}
            </Menu.Item>
            <Menu.Divider />
            <Menu.Item
              leftSection={<LocalIcon icon="delete-rounded" width="1rem" height="1rem" />}
              color="red"
              onClick={() => {
                setDeleteTarget({ id: contextMenu.task.id, fileName: contextMenu.task.fileName });
                setContextMenu(null);
              }}
            >
              {t('taskList.delete', 'Delete')}
            </Menu.Item>
          </Menu.Dropdown>
        </Menu>
      )}
    </>
  );
}
