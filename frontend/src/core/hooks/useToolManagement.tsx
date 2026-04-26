import { useState, useCallback, useMemo } from 'react';
import { useToolRegistry } from "@app/contexts/ToolRegistryContext";
import { usePreferences } from '@app/contexts/PreferencesContext';
import { getAllEndpoints, type ToolRegistryEntry, type ToolRegistry } from "@app/data/toolsTaxonomy";
import { useMultipleEndpointsEnabled } from "@app/hooks/useEndpointConfig";
import { useBackendHealth } from '@app/hooks/useBackendHealth';
import { FileId } from '@app/types/file';
import { ToolId } from "@app/types/toolId";
import type { EndpointDisableReason } from '@app/types/endpointAvailability';
import { BACKEND_OPTIONAL_TOOL_IDS } from '@app/utils/backendOptionalTools';

export type ToolDisableCause =
  | 'disabledByAdmin'
  | 'missingDependency'
  | 'backendNotReady'
  | 'unknown';

export interface ToolAvailabilityInfo {
  available: boolean;
  reason?: ToolDisableCause;
}

export type ToolAvailabilityMap = Partial<Record<ToolId, ToolAvailabilityInfo>>;

interface ToolManagementResult {
  selectedTool: ToolRegistryEntry | null;
  toolSelectedFileIds: FileId[];
  toolRegistry: Partial<ToolRegistry>;
  setToolSelectedFileIds: (fileIds: FileId[]) => void;
  getSelectedTool: (toolKey: ToolId | null) => ToolRegistryEntry | null;
  toolAvailability: ToolAvailabilityMap;
}

export const useToolManagement = (): ToolManagementResult => {
  const [toolSelectedFileIds, setToolSelectedFileIds] = useState<FileId[]>([]);

  // Build endpoints list from registry entries with fallback to legacy mapping
  const { allTools } = useToolRegistry();
  const baseRegistry = allTools;
  const { preferences } = usePreferences();

  const allEndpoints = useMemo(() => getAllEndpoints(baseRegistry), [baseRegistry]);
  const { endpointStatus, endpointDetails, loading: endpointsLoading } = useMultipleEndpointsEnabled(allEndpoints);
  const { isHealthy: backendHealthy } = useBackendHealth();

  const isToolAvailable = useCallback((toolKey: string): boolean => {
    // Keep tools enabled during loading (optimistic UX)
    if (endpointsLoading) return true;

    const tool = baseRegistry[toolKey as ToolId];
    const endpoints = tool?.endpoints || [];

    // Tools without endpoints are always available
    if (endpoints.length === 0) return true;

    // Backend (bundled JRE) gating: while the local backend is still
    // booting we disable JRE-dependent tools at the tile level. Tools
    // that go to the remote PlexPDF cloud (convert, ocr — see
    // `BACKEND_OPTIONAL_TOOL_IDS`) bypass this check and stay clickable.
    if (!backendHealthy && !BACKEND_OPTIONAL_TOOL_IDS.has(toolKey as ToolId)) {
      return false;
    }

    // Check if at least one endpoint is enabled
    // If endpoint is not in status map, assume enabled (optimistic fallback)
    return endpoints.some((endpoint: string) => endpointStatus[endpoint] !== false);
  }, [endpointsLoading, endpointStatus, baseRegistry, backendHealthy]);

  const deriveToolDisableReason = useCallback((toolKey: ToolId): ToolDisableCause => {
    const tool = baseRegistry[toolKey];
    if (!tool) {
      return 'unknown';
    }
    const endpoints = tool.endpoints || [];

    // Backend-not-ready takes precedence: if the JRE isn't up yet and
    // this tool depends on it, we want the user to see "Backend
    // starting up..." rather than a misleading "disabled by admin".
    if (
      !backendHealthy &&
      endpoints.length > 0 &&
      !BACKEND_OPTIONAL_TOOL_IDS.has(toolKey)
    ) {
      return 'backendNotReady';
    }

    const disabledReasons: EndpointDisableReason[] = endpoints
      .filter(endpoint => endpointStatus[endpoint] === false)
      .map(endpoint => endpointDetails[endpoint]?.reason ?? 'CONFIG');

    if (disabledReasons.some(reason => reason === 'DEPENDENCY')) {
      return 'missingDependency';
    }
    if (disabledReasons.some(reason => reason === 'CONFIG')) {
      return 'disabledByAdmin';
    }
    if (disabledReasons.length > 0) {
      return 'unknown';
    }
    return 'unknown';
  }, [baseRegistry, endpointDetails, endpointStatus, backendHealthy]);

  const toolAvailability = useMemo(() => {
    if (endpointsLoading) {
      return {};
    }
    const availability: ToolAvailabilityMap = {};
    (Object.keys(baseRegistry) as ToolId[]).forEach(toolKey => {
      const available = isToolAvailable(toolKey);
      availability[toolKey] = available
        ? { available: true }
        : { available: false, reason: deriveToolDisableReason(toolKey) };
    });
    return availability;
  }, [baseRegistry, deriveToolDisableReason, endpointsLoading, isToolAvailable]);

  const toolRegistry: Partial<ToolRegistry> = useMemo(() => {
    const availableToolRegistry: Partial<ToolRegistry> = {};
    (Object.keys(baseRegistry) as ToolId[]).forEach(toolKey => {
      const baseTool = baseRegistry[toolKey];
      if (!baseTool) return;
      const availabilityInfo = toolAvailability[toolKey];
      const isAvailable = availabilityInfo ? availabilityInfo.available !== false : true;
      // Backend-not-ready is transient — show the tool greyed out so the
      // user sees it light up when the JRE finishes booting, instead of
      // having tools pop in/out of the picker.
      const isTransientUnavailable = availabilityInfo?.reason === 'backendNotReady';

      // Check if tool is "coming soon" (has no component and no link)
      const isComingSoon = !baseTool.component && !baseTool.link && toolKey !== 'read' && toolKey !== 'multiTool';

      if (
        preferences.hideUnavailableTools &&
        !isTransientUnavailable &&
        (!isAvailable || isComingSoon)
      ) {
        return;
      }
      availableToolRegistry[toolKey] = {
        ...baseTool,
        name: baseTool.name,
        description: baseTool.description,
      };
    });
    return availableToolRegistry;
  }, [baseRegistry, preferences.hideUnavailableTools, toolAvailability]);

  const getSelectedTool = useCallback((toolKey: ToolId | null): ToolRegistryEntry | null => {
    return toolKey ? toolRegistry[toolKey] || null : null;
  }, [toolRegistry]);

  return {
    selectedTool: getSelectedTool(null), // This will be unused, kept for compatibility
    toolSelectedFileIds,
    toolRegistry,
    setToolSelectedFileIds,
    getSelectedTool,
    toolAvailability,
  };
};
