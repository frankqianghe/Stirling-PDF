import { useRef, useState } from 'react';
import { Stack, Text, Group, Badge, ScrollArea, Box, ActionIcon, Modal, Button, Progress } from '@mantine/core';
import LocalIcon from '@app/components/shared/LocalIcon';
import { useTaskContext } from '@app/contexts/TaskContext';
import { type TaskStatus, type ConvertTask } from '@app/services/taskService';

type DisplayStatus = 'success' | 'processing' | 'failed';

const STATUS_CONFIG: Record<DisplayStatus, { label: string; color: string; icon: string }> = {
  success: { label: '转换成功', color: 'green', icon: 'check-circle-rounded' },
  processing: { label: '处理中', color: 'blue', icon: 'progress-activity' },
  failed: { label: '转换失败', color: 'red', icon: 'cancel-rounded' },
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

export default function TaskListPanel() {
  const { tasks, removeTask, updateTask } = useTaskContext();
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; fileName: string } | null>(null);
  const [downloadProgress, setDownloadProgress] = useState<Record<string, number>>({});
  const downloadingRef = useRef<Set<string>>(new Set());

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

  function isTauriEnv(): boolean {
    return typeof window !== 'undefined' &&
      (typeof (window as Record<string, unknown>).__TAURI_INTERNALS__ !== 'undefined');
  }

  async function handleTaskClick(task: ConvertTask) {
    if (task.status !== 'completed' || !task.outputUrl) return;
    if (downloadingRef.current.has(task.id)) return;

    if (!isTauriEnv()) {
      window.open(task.outputUrl, '_blank');
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
        const response = await fetch(task.outputUrl);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        const contentLength = Number(response.headers.get('Content-Length') || 0);
        const reader = response.body!.getReader();
        const chunks: Uint8Array[] = [];
        let received = 0;

        // eslint-disable-next-line no-constant-condition
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
      window.open(task.outputUrl, '_blank');
    }
  }

  return (
    <>
      <style>{`@keyframes spin{0%{transform:rotate(0deg)}100%{transform:rotate(360deg)}}`}</style>
      <ScrollArea h="100%" p="sm">
        <Stack gap={0}>
          <Group px="sm" py="xs" mb="xs">
            <LocalIcon icon="task-alt-rounded" width="1.1rem" height="1.1rem" />
            <Text size="sm" fw={600}>任务列表</Text>
            <Badge size="sm" variant="light" color="gray" ml="auto">
              {tasks.length}
            </Badge>
          </Group>

          {tasks.length === 0 && (
            <Text size="sm" c="dimmed" ta="center" py="xl">
              暂无转换任务
            </Text>
          )}

          {tasks.map((task) => {
            const displayStatus = mapStatus(task.status);
            const statusCfg = STATUS_CONFIG[displayStatus];
            const progress = downloadProgress[task.id];
            const isDownloading = progress !== undefined;

            return (
              <Box
                key={task.id}
                px="sm"
                py="xs"
                style={{
                  borderRadius: 'var(--mantine-radius-sm)',
                  transition: 'background-color 0.15s ease',
                  cursor: task.status === 'completed' && task.outputUrl ? 'pointer' : 'default',
                }}
                className="hover:bg-[var(--bg-hover)]"
                onClick={() => handleTaskClick(task)}
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
                    <Badge
                      size="sm"
                      variant="light"
                      color={statusCfg.color}
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
                      {statusCfg.label}
                    </Badge>

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
        title="删除任务"
        centered
        size="sm"
      >
        <Text size="sm" mb="lg">
          确定要删除任务 <Text span fw={600}>"{deleteTarget?.fileName}"</Text> 吗？
        </Text>
        <Group justify="flex-end" gap="sm">
          <Button variant="default" onClick={() => setDeleteTarget(null)}>
            取消
          </Button>
          <Button color="red" onClick={handleConfirmDelete}>
            删除
          </Button>
        </Group>
      </Modal>
    </>
  );
}
