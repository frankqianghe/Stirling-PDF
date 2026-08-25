import { MantineProvider } from '@mantine/core';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import TaskListPanel from '@app/components/tools/TaskListPanel';
import type { ConvertTask } from '@app/services/taskService';

const { mockInvoke, mockIsTauri, mockUseTaskContext } = vi.hoisted(() => ({
  mockInvoke: vi.fn(),
  mockIsTauri: vi.fn(() => true),
  mockUseTaskContext: vi.fn(),
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: mockInvoke,
  isTauri: mockIsTauri,
}));

vi.mock('@app/contexts/TaskContext', () => ({
  useTaskContext: () => mockUseTaskContext(),
}));

vi.mock('@app/services/taskLogService', () => ({
  getLastErrorReason: vi.fn(),
  openTaskLog: vi.fn(),
}));

const completedTask: ConvertTask = {
  id: 'task-1',
  fileName: 'source.docx',
  toFormat: 'pdf',
  status: 'completed',
  localPath: '/tmp/source.pdf',
  createdAt: '2026-08-25T00:00:00.000Z',
};

function renderPanel(tasks: ConvertTask[]) {
  mockUseTaskContext.mockReturnValue({
    tasks,
    removeTask: vi.fn(),
    updateTask: vi.fn(),
  });

  return render(
    <MantineProvider>
      <TaskListPanel />
    </MantineProvider>,
  );
}

describe('TaskListPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsTauri.mockReturnValue(true);
  });

  test('reveals completed output from its row action', async () => {
    renderPanel([completedTask]);

    fireEvent.click(screen.getByRole('button', { name: 'taskList.revealOutput' }));

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('plugin:opener|reveal_item_in_dir', {
        paths: ['/tmp/source.pdf'],
      });
    });
  });

  test('does not show reveal action for unfinished tasks', () => {
    renderPanel([{ ...completedTask, status: 'in_progress', outputUrl: undefined, localPath: undefined }]);

    expect(screen.queryByRole('button', { name: 'taskList.revealOutput' })).not.toBeInTheDocument();
  });

  test('shows reveal action when completed status has no output URL', () => {
    renderPanel([{ ...completedTask, localPath: undefined, outputUrl: undefined }]);

    expect(screen.getByRole('button', { name: 'taskList.revealOutput' })).toBeInTheDocument();
  });
});
