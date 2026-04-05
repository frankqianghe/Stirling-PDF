import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { OCRParameters, defaultParameters } from '@app/hooks/tools/ocr/useOCRParameters';
import { useToolOperation, ToolType, CustomProcessorResult } from '@app/hooks/tools/shared/useToolOperation';
import { submitOCRTask } from '@app/services/taskService';
import { useTaskContext } from '@app/contexts/TaskContext';

// --- Legacy helpers preserved for future use / automation ---

function getMimeType(filename: string): string {
  const ext = filename.toLowerCase().split('.').pop();
  switch (ext) {
    case 'pdf': return 'application/pdf';
    case 'txt': return 'text/plain';
    case 'zip': return 'application/zip';
    default: return 'application/octet-stream';
  }
}

async function extractZipFile(zipBlob: Blob): Promise<File[]> {
  const JSZip = await import('jszip');
  const zip = new JSZip.default();
  const zipContent = await zip.loadAsync(await zipBlob.arrayBuffer());
  const out: File[] = [];
  for (const [filename, file] of Object.entries(zipContent.files)) {
    if (!file.dir) {
      const content = await file.async('blob');
      out.push(new File([content], filename, { type: getMimeType(filename) }));
    }
  }
  return out;
}

function stripExt(name: string): string {
  const i = name.lastIndexOf('.');
  return i > 0 ? name.slice(0, i) : name;
}

export const buildOCRFormData = (parameters: OCRParameters, file: File): FormData => {
  const formData = new FormData();
  formData.append('fileInput', file);
  parameters.languages.forEach((lang) => formData.append('languages', lang));
  formData.append('ocrType', parameters.ocrType);
  formData.append('ocrRenderType', parameters.ocrRenderType);

  const options = parameters.additionalOptions || [];
  formData.append('sidecar', options.includes('sidecar').toString());
  formData.append('deskew', options.includes('deskew').toString());
  formData.append('clean', options.includes('clean').toString());
  formData.append('cleanFinal', options.includes('cleanFinal').toString());
  formData.append('removeImagesAfter', options.includes('removeImagesAfter').toString());
  return formData;
};

export const ocrResponseHandler = async (blob: Blob, originalFiles: File[], extractZipFiles: (blob: Blob) => Promise<File[]>): Promise<File[]> => {
  const headBuf = await blob.slice(0, 8).arrayBuffer();
  const head = new TextDecoder().decode(new Uint8Array(headBuf));

  if (head.startsWith('PK')) {
    const base = stripExt(originalFiles[0].name);
    try {
      const extractedFiles = await extractZipFiles(blob);
      if (extractedFiles.length > 0) return extractedFiles;
    } catch { /* ignore and try local extractor */ }
    try {
      const local = await extractZipFile(blob);
      if (local.length > 0) return local;
    } catch { /* fall through */ }
    return [new File([blob], `ocr_${base}.zip`, { type: 'application/zip' })];
  }

  if (!head.startsWith('%PDF')) {
    const textBuf = await blob.slice(0, 1024).arrayBuffer();
    const text = new TextDecoder().decode(new Uint8Array(textBuf));
    if (/error|exception|html/i.test(text)) {
      if (text.includes('OCR tools') && text.includes('not installed')) {
        throw new Error('OCR tools (OCRmyPDF or Tesseract) are not installed on the server. Use the standard or fat Docker image instead of ultra-lite, or install OCR tools manually.');
      }
      const title =
        text.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1] ||
        text.match(/<h1[^>]*>([^<]+)<\/h1>/i)?.[1] ||
        'Unknown error';
      throw new Error(`OCR service error: ${title}`);
    }
    throw new Error(`Response is not a valid PDF. Header: "${head}"`);
  }

  const originalName = originalFiles[0].name;
  return [new File([blob], originalName, { type: 'application/pdf' })];
};

// --- End legacy helpers ---

export const ocrOperationConfig = {
  toolType: ToolType.custom,
  customProcessor: async (_params: OCRParameters, _files: File[]): Promise<CustomProcessorResult> => {
    return { files: [], consumedAllInputs: false };
  },
  operationType: 'ocr',
  defaultParameters,
} as const;

export const useOCROperation = () => {
  const { t } = useTranslation();
  const { addTask } = useTaskContext();

  const customOCRProcessor = useCallback(async (
    _parameters: OCRParameters,
    selectedFiles: File[]
  ): Promise<CustomProcessorResult> => {
    for (const file of selectedFiles) {
      try {
        const task = await submitOCRTask(file);
        addTask(task);
      } catch (error) {
        console.warn(`Failed to submit OCR task for ${file.name}:`, error);
        throw error;
      }
    }

    return {
      files: [],
      consumedAllInputs: true,
    };
  }, [addTask]);

  return useToolOperation<OCRParameters>({
    ...ocrOperationConfig,
    customProcessor: customOCRProcessor,
    getErrorMessage: (error) => {
      if (error.message) return error.message;
      return t('ocr.error.failed', 'OCR operation failed');
    },
  });
};
