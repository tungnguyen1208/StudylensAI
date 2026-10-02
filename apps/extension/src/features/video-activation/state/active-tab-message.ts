import type { ExtensionMessage } from '../../../shared/messaging/message-types';
import type { ActivationContext } from '../models/activation.types';

/**
 * The Side Panel is browser-global, but activation events are tab-scoped.
 * Only the active tab may update video state; global OFF remains authoritative.
 */
export function shouldApplyActiveTabMessage(
  activeContext: ActivationContext | null,
  message: ExtensionMessage,
): boolean {
  if (message.type === 'ACTIVATION_DISABLED') return true;
  if (!activeContext) return false;
  return message.tabId === activeContext.tabId;
}
