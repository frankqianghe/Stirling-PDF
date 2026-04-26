import { ToolId } from '@app/types/toolId';

/**
 * Tools that DO NOT require the bundled local JRE backend to be ready
 * before the user can launch them.
 *
 * - `convert` and `ocr` go through the remote PlexPDF cloud server
 *   (see `taskService.ts`), so they work the moment the network is up.
 * - All other tools listed in the registry with non-empty `endpoints`
 *   talk to the in-process Java backend and therefore have to wait for
 *   the JRE/`backend-spawn` to become healthy.
 *
 * The desktop product previously gated *every* tool with a fullscreen
 * loading overlay until the backend was ready; we now let users into
 * the app immediately and gate only the JRE-dependent tools at the
 * tile / submit-button level using this allow-list.
 */
export const BACKEND_OPTIONAL_TOOL_IDS: ReadonlySet<ToolId> = new Set<ToolId>([
  'convert',
  'ocr',
]);

export function isBackendOptionalTool(toolId: ToolId | null | undefined): boolean {
  if (!toolId) return false;
  return BACKEND_OPTIONAL_TOOL_IDS.has(toolId);
}
