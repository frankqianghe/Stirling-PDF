/**
 * Paywall gate (desktop override).
 *
 * Decides whether selecting a given tool should be intercepted by the
 * desktop paywall instead of opening the tool. Free-plan users hitting any
 * tool listed in `PAYWALLED_TOOL_IDS` will get the checkout modal opened
 * via the existing `plexpdf-open-paywall` CustomEvent that
 * `PaywallTopEntry` already listens for.
 *
 * The plan is read synchronously from localStorage (cached by
 * deviceRegisterService) so we can intercept inside synchronous click
 * handlers without flicker.
 */

import { type ToolId } from '@app/types/toolId';
import { deviceRegisterService } from '../services/deviceRegisterService';

/**
 * Tools that require a paid plan on desktop. Free users clicking any of
 * these get the paywall instead of entering the tool.
 *
 * NOTE: keep this list in sync with the product spec. Adding a tool here
 * is the only change required to gate it.
 */
export const PAYWALLED_TOOL_IDS: ReadonlySet<ToolId> = new Set<ToolId>([
  'pdfTextEditor',
  'merge',
  'compare',
  'compress',
  'convert',
  'ocr',
  'extractPages',
  'extractImages',
  'removeImage',
  'addText',
  'addImage',
]);

export function isToolPaywalled(toolId: ToolId): boolean {
  if (!PAYWALLED_TOOL_IDS.has(toolId)) return false;
  // Only free-plan users are gated; year/lifetime users go straight in.
  return deviceRegisterService.getCachedPlan() === 'free';
}

export function triggerPaywall(toolId: ToolId): void {
  try {
    window.dispatchEvent(
      new CustomEvent('plexpdf-open-paywall', {
        detail: { source: 'tool-gate', toolId },
      }),
    );
  } catch (err) {
    console.error('[paywallGate] failed to dispatch open-paywall event', err);
  }
}
