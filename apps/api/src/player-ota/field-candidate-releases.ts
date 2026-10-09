/** Immutable provenance records for explicitly enabled private field artifacts.
 * Populated only after signed CI artifact/hash/certificate verification. These
 * entries never participate in the stable GitHub release catalogue.
 */
export interface FieldCandidateRelease {
  versionName: string;
  versionCode: number;
  sha256: string;
  size: number;
  sourceUrl: string;
}
export const FIELD_CANDIDATE_RELEASES: Readonly<
  Record<string, FieldCandidateRelease>
> = {};
