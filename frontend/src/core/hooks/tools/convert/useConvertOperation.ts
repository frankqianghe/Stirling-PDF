import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { ConvertParameters, defaultParameters } from '@app/hooks/tools/convert/useConvertParameters';
import { useToolOperation, ToolType, CustomProcessorResult } from '@app/hooks/tools/shared/useToolOperation';
import { submitConvertTask } from '@app/services/taskService';
import { useTaskContext } from '@app/contexts/TaskContext';
import { createTaskLogger, generateLogId } from '@app/services/taskLogService';

// Static configuration object (kept for automation compatibility)
export const convertOperationConfig = {
  toolType: ToolType.custom,
  customProcessor: async (_params: ConvertParameters, _files: File[]): Promise<CustomProcessorResult> => {
    return { files: [], consumedAllInputs: false };
  },
  operationType: 'convert',
  defaultParameters,
} as const;

export const useConvertOperation = () => {
  const { t } = useTranslation();
  const { addTask } = useTaskContext();

  const customConvertProcessor = useCallback(async (
    parameters: ConvertParameters,
    selectedFiles: File[]
  ): Promise<CustomProcessorResult> => {
    const { toExtension } = parameters;

    for (const file of selectedFiles) {
      const logger = createTaskLogger(generateLogId());
      logger.info(
        `=== Convert session started: file="${file.name}" -> ${toExtension} ===`,
      );
      try {
        const task = await submitConvertTask(file, toExtension, logger);
        // Always persist the logId so the UI can locate the file later.
        addTask({ ...task, logId: logger.id });
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        logger.error(`Submit failed: ${msg}`);
        console.warn(`Failed to submit convert task for ${file.name}:`, error);
        throw error;
      }
    }

    return {
      files: [],
      consumedAllInputs: true,
    };
  }, [addTask]);

  return useToolOperation<ConvertParameters>({
    ...convertOperationConfig,
    customProcessor: customConvertProcessor,
    getErrorMessage: (error) => {
      if (error.response?.data && typeof error.response.data === 'string') {
        return error.response.data;
      }
      if (error.message) {
        return error.message;
      }
      return t("convert.errorConversion", "An error occurred while converting the file.");
    },
  });
};
