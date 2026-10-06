/** Both timestamps come from the server. Device clock skew is irrelevant.
 * A completed check must not be replayed on every web-player reload.
 * This never clears the privileged server-side APK push or claims an install.
 */
export function otaCheckAnswered(state: unknown, answerAt: unknown, requestedAt: unknown): boolean {
  if (state !== 'UP_TO_DATE' || typeof answerAt !== 'string' || typeof requestedAt !== 'string') return false;
  const answer = Date.parse(answerAt), request = Date.parse(requestedAt);
  return Number.isFinite(answer) && Number.isFinite(request) && answer >= request;
}
