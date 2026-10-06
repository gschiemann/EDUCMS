// A corrected engine gets one fresh attempt without erasing an older revision's
// failure record. Failed files remain blocked for 24 h within this revision.
export const CONTINUOUS_LOOP_REVISION = 4;

export function continuousGuardKey(hash: string, key: string): string {
  return `continuous:v${CONTINUOUS_LOOP_REVISION}:${hash}:${key}`;
}
