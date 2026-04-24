/**
 * Paywall gate (core stub).
 *
 * In core/web builds we don't enforce a paywall at all — every tool is freely
 * available. The desktop build provides a real implementation under
 * `desktop/utils/paywallGate.ts` that is auto-shadowed when resolving
 * `@app/utils/paywallGate`.
 */

import { type ToolId } from '@app/types/toolId';

export function isToolPaywalled(_toolId: ToolId): boolean {
  return false;
}

export function triggerPaywall(_toolId: ToolId): void {
  // No-op in core builds.
}
