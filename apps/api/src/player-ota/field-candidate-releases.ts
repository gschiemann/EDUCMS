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
> = {
  // Signed CI run 37979383254, source 583ccf14. Private mirror read back and
  // verified; release certificate e45adf50…3d1897 matches the installed fleet.
  '1.1.25-field.1': {
    versionName: '1.1.25-field.1',
    versionCode: 10125,
    sha256: 'b4d83b39a8732b8a8a513a7016091ea7ad6caec4f033a28f5bf8f73cc23b4dcd',
    size: 2353191,
    sourceUrl: 'https://github.com/gschiemann/EDUCMS/actions/runs/37979383254',
  },
  // Signed CI run 38233912481, source 8cf68fae (native video protocol 3).
  // Private mirror read back and verified; release certificate
  // e45adf50…3d1897 matches the installed fleet. Test units only (owner
  // 2026-10-12: VisionCore, M43, L55VEC), one at a time.
  '1.1.30-field.1': {
    versionName: '1.1.30-field.1',
    versionCode: 10130,
    sha256: '4a530a4c4fa3c7bbfd9d6a8dd2cc285ce6afb13fed271d78bf30f4f56301b77f',
    size: 2387599,
    sourceUrl: 'https://github.com/gschiemann/EDUCMS/actions/runs/38233912481',
  },
};
