/**
 * Context-change publication is best effort after local cancellation. The
 * in-content message bus delivers locally before its external relay, so a
 * relay exception must not wedge the replacement video. A newer transition
 * still wins through the current-generation predicate.
 */
export async function continueAfterContextPublish(
  publish: () => Promise<unknown>,
  isCurrent: () => boolean,
  continueReplacement: () => Promise<void>,
): Promise<void> {
  try {
    await publish();
  } catch {
    // External relay failure cannot resurrect old acquisition or block B.
  }
  if (isCurrent()) await continueReplacement();
}
