import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useFileSelection } from "@app/contexts/FileContext";
import { useToolWorkflow } from "@app/contexts/ToolWorkflowContext";

import { createToolFlow } from "@app/components/tools/shared/createToolFlow";

import OCRSettings from "@app/components/tools/ocr/OCRSettings";
import AdvancedOCRSettings from "@app/components/tools/ocr/AdvancedOCRSettings";

import { useOCRParameters } from "@app/hooks/tools/ocr/useOCRParameters";
import { useOCROperation } from "@app/hooks/tools/ocr/useOCROperation";
import { loadTasks } from "@app/services/taskService";
import { BaseToolProps, ToolComponent } from "@app/types/tool";
import { useOCRTips } from "@app/components/tooltips/useOCRTips";
import { useAdvancedOCRTips } from "@app/components/tooltips/useAdvancedOCRTips";

const OCR = ({ onPreviewFile, onComplete, onError }: BaseToolProps) => {
  const { t } = useTranslation();
  const { selectedFiles } = useFileSelection();

  const ocrParams = useOCRParameters();
  const ocrOperation = useOCROperation();
  const ocrTips = useOCRTips();
  const advancedOCRTips = useAdvancedOCRTips();
  const { setLeftPanelView } = useToolWorkflow();

  // Toggle to show/hide Settings and Advanced panels (hidden for simplified UI)
  const showSettingsPanels = false;

  // Step expansion state management
  const [expandedStep, setExpandedStep] = useState<"files" | "settings" | "advanced" | null>("files");

  // Remote API is always available — no local endpoint check needed
  const endpointEnabled = true;
  const endpointLoading = false;

  const hasFiles = selectedFiles.length > 0;
  const hasResults = ocrOperation.files.length > 0 || ocrOperation.downloadUrl !== null;
  const hasValidSettings = ocrParams.validateParameters();

  useEffect(() => {
    ocrOperation.resetResults();
    onPreviewFile?.(null);
  }, [ocrParams.parameters]);

  useEffect(() => {
    if (selectedFiles.length > 0 && expandedStep === "files") {
      setExpandedStep(showSettingsPanels ? "settings" : null);
    }
  }, [selectedFiles.length, expandedStep]);

  // Collapse all steps when results appear
  useEffect(() => {
    if (hasResults) {
      setExpandedStep(null);
    }
  }, [hasResults]);

  const handleOCR = async () => {
    // Snapshot localStorage – executeOperation swallows errors internally, so
    // the only reliable signal of a successful submit is a new task entry.
    const tasksBefore = loadTasks().length;
    try {
      await ocrOperation.executeOperation(ocrParams.parameters, selectedFiles);
      if (loadTasks().length > tasksBefore) {
        setLeftPanelView('tasks');
      } else if (onError) {
        onError(t("ocr.error.failed", "OCR operation failed"));
      }
    } catch (error) {
      if (onError) {
        onError(error instanceof Error ? error.message : "OCR operation failed");
      }
    }
  };

  const handleThumbnailClick = (file: File) => {
    onPreviewFile?.(file);
    sessionStorage.setItem("previousMode", "ocr");
  };

  const handleSettingsReset = () => {
    ocrOperation.resetResults();
    onPreviewFile?.(null);
  };

  const handleUndo = async () => {
    await ocrOperation.undoOperation();
    onPreviewFile?.(null);
  };

  const settingsCollapsed = expandedStep !== "settings";

  const settingsSteps = showSettingsPanels ? [
    {
      title: t("ocr.settings.title", "Settings"),
      isCollapsed: !hasFiles || settingsCollapsed,
      onCollapsedClick: hasResults
        ? handleSettingsReset
        : () => {
            if (!hasFiles) return;
            setExpandedStep(expandedStep === "settings" ? null : "settings");
          },
      tooltip: ocrTips,
      content: (
        <OCRSettings
          parameters={ocrParams.parameters}
          onParameterChange={ocrParams.updateParameter}
          disabled={endpointLoading}
        />
      ),
    },
    {
      title: "Advanced",
      isCollapsed: expandedStep !== "advanced",
      onCollapsedClick: hasResults
        ? handleSettingsReset
        : () => {
            if (!hasFiles) return;
            setExpandedStep(expandedStep === "advanced" ? null : "advanced");
          },
      tooltip: advancedOCRTips,
      content: (
        <AdvancedOCRSettings
          advancedOptions={ocrParams.parameters.additionalOptions}
          ocrRenderType={ocrParams.parameters.ocrRenderType}
          onParameterChange={ocrParams.updateParameter}
          disabled={endpointLoading}
        />
      ),
    },
  ] : [];

  return createToolFlow({
    files: {
      selectedFiles,
      isCollapsed: hasResults,
    },
    steps: settingsSteps,
    executeButton: {
      text: t("ocr.operation.submit", "开始处理"),
      loadingText: t("loading"),
      onClick: handleOCR,
      isVisible: !hasResults,
      disabled: !hasFiles || !endpointEnabled,
    },
    review: {
      isVisible: hasResults,
      operation: ocrOperation,
      title: t("ocr.results.title", "OCR Results"),
      onFileClick: handleThumbnailClick,
      onUndo: handleUndo,
    },
  });
};

// Static method to get the operation hook for automation
OCR.tool = () => useOCROperation;

export default OCR as ToolComponent;
