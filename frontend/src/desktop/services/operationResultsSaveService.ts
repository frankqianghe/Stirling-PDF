import type { FileId } from '@app/types/fileContext';
import type { OperationSaveContext } from '@core/services/operationResultsSaveService';
import { downloadFromUrl, DownloadResult } from '@app/services/downloadService';
import { showSaveDialog, saveToLocalPath, saveMultipleFilesWithPrompt } from '@app/services/localFileSaveService';

export type { OperationSaveContext };

function extractDirectory(filePath: string): string | undefined {
  const lastSep = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'));
  return lastSep > 0 ? filePath.substring(0, lastSep) : undefined;
}

export async function saveOperationResults(context: OperationSaveContext): Promise<DownloadResult | null> {
  if (!context.downloadUrl) return null;

  if (context.outputFileIds && context.outputFileIds.length > 0) {
    const filesToSave: Array<{ fileId: string; file: File; defaultDir?: string }> = [];
    for (const fileId of context.outputFileIds) {
      const file = context.getFile(fileId as FileId);
      const stub = context.getStub(fileId as FileId);
      if (!file) continue;
      filesToSave.push({
        fileId,
        file,
        defaultDir: stub?.localFilePath ? extractDirectory(stub.localFilePath) : undefined
      });
    }

    if (filesToSave.length === 0) return null;

    if (filesToSave.length === 1) {
      const { fileId, file, defaultDir } = filesToSave[0];
      const savePath = await showSaveDialog(file.name, defaultDir);
      if (!savePath) return { cancelled: true };

      const writeResult = await saveToLocalPath(file, savePath);
      if (!writeResult.success) {
        throw new Error(writeResult.error || 'Failed to save file');
      }
      context.markSaved(fileId as FileId, savePath);
      return { savedPath: savePath };
    }

    const result = await saveMultipleFilesWithPrompt(
      filesToSave.map(f => f.file),
      filesToSave[0].defaultDir
    );
    if (result.cancelledByUser) return { cancelled: true };
    if (!result.success) throw new Error(result.error || 'Failed to save files');
    return { savedPath: 'multiple' };
  }

  const result = await downloadFromUrl(
    context.downloadUrl,
    context.downloadFilename || 'download',
    context.downloadLocalPath || undefined
  );

  if (context.outputFileIds && result.savedPath) {
    for (const fileId of context.outputFileIds) {
      context.markSaved(fileId as FileId, result.savedPath);
    }
  }

  return result;
}
