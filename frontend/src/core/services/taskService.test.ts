import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { downloadTaskOutput } from '@app/services/taskService';

const fetchMock = vi.fn();

describe('downloadTaskOutput', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('plexpdf_device_token', 'device-token');
    localStorage.setItem('stirling_device_id_fallback', 'device-id');
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockResolvedValue(new Response('converted'));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  test('uses authenticated task download endpoint when status omits output URL', async () => {
    await downloadTaskOutput('task id');

    expect(fetchMock).toHaveBeenCalledWith(
      'https://plexpdf.wenxstudio.ai/convert/tasks/task%20id/download',
      expect.objectContaining({
        headers: {
          Authorization: 'Bearer device-token',
          'X-Device-Id': 'device-id',
        },
        __plexpdfSkipFetchLog: true,
      }),
    );
  });

  test('does not forward auth headers to direct output URLs', async () => {
    await downloadTaskOutput('task-id', 'https://files.example.test/converted.pdf');

    expect(fetchMock).toHaveBeenCalledWith(
      'https://files.example.test/converted.pdf',
      { __plexpdfSkipFetchLog: true },
    );
  });
});
