/**
 * Student information on PUBLIC screens — the shared contract (K-12 sports
 * launch, lane B3, 2026-09-27).
 *
 * Greg: "follow the laws, dont show any kids without some legal approval from
 * someone". Design: docs/research/2026-09-24-k12-sports-launch-program/
 * 03-STUDENT-PRIVACY-DESIGN.md. In short: at a K-12 school (or any tenant that
 * says it serves minors) a public output — scoreboard, ribbon, scorebug, the
 * public athlete page — shows NO student names and NO photos until an admin
 * confirms the school's policy. Names need the directory-information
 * attestation; a photo additionally needs the photo-release attestation AND a
 * per-student "Photo release on file"; a family's directory opt-out hides that
 * student's name and photo whatever else is set. Teams, jersey numbers, scores
 * and stats by number are not student names and keep showing.
 *
 * This is NOT legal advice: the product makes the SCHOOL's decision explicit,
 * recorded and default-deny. The attestation TEXT is versioned — an admin
 * confirms a specific wording, the version is stored beside who confirmed it
 * and when, and a future wording that asks for more can retire older versions
 * (drop them from ACCEPTED_…) so every school confirms again.
 */

export type StudentPrivacyCategory = 'names' | 'photos';

/** A tenant's own setting for one category. `null` = inherit from the parent. */
export type StudentPrivacyState = 'ALLOW' | 'HIDE';

/** The wording an admin confirms today. Bump when the text changes. */
export const STUDENT_PRIVACY_ATTESTATION_VERSION = '2026-09-27';

/**
 * Versions whose confirmation still counts. Remove a version here (and bump the
 * current one) when a new wording must be re-confirmed: every school that
 * confirmed the old wording drops back to HIDDEN, and the dashboard asks again.
 */
export const ACCEPTED_STUDENT_PRIVACY_ATTESTATION_VERSIONS: readonly string[] = [
  STUDENT_PRIVACY_ATTESTATION_VERSION,
];

/**
 * The canonical (English) text of each attestation, as confirmed. The API
 * stores it in the audit row, so the record says exactly what was agreed to;
 * the dashboard shows the translated wording of the same version.
 */
export const STUDENT_PRIVACY_ATTESTATION_TEXT: Readonly<Record<StudentPrivacyCategory, string>> = Object.freeze({
  names:
    "Our annual FERPA notice designates athletes' names and participation in officially recognized sports as " +
    'directory information, and we record every family\'s directory-information opt-out in VenueOS before a ' +
    "student's name is shown on a public screen.",
  photos:
    'We have a signed photo / media release on file for every student we mark "Photo release on file" in ' +
    "VenueOS, and only those students' photos may be shown on a public screen.",
});

/** Is `version` a confirmation that still counts? */
export function isAcceptedStudentPrivacyVersion(version: unknown): boolean {
  return typeof version === 'string' && ACCEPTED_STUDENT_PRIVACY_ATTESTATION_VERSIONS.includes(version);
}

/** Does the student-privacy default-deny apply to a tenant on this vertical by itself? */
export function studentPrivacyAppliesToVertical(vertical: unknown): boolean {
  return typeof vertical === 'string' && vertical.trim().toUpperCase() === 'K12';
}

/** Who made a setting, as the API reports it. */
export interface StudentPrivacyActor {
  id: string;
  name: string | null;
  email: string | null;
}

/** Where the effective answer for one category comes from. */
export interface StudentPrivacySource {
  /** `self` = this location's own setting; `parent` = inherited (district). */
  level: 'self' | 'parent';
  tenantId: string;
  tenantName: string | null;
  state: StudentPrivacyState;
  setAt: string | null;
  setBy: StudentPrivacyActor | null;
  /** The attestation wording confirmed (ALLOW only). */
  version: string | null;
}

export interface StudentPrivacyCategoryView {
  /** The effective answer: may this category show on public screens now? */
  allowed: boolean;
  /** This location's own setting (null = nothing decided here). */
  own: StudentPrivacyState | null;
  /** The setting that decided `allowed` (null = nobody decided: default deny). */
  source: StudentPrivacySource | null;
  /** This location's own ALLOW was confirmed against a wording no longer accepted. */
  needsReconfirm: boolean;
}

/** `GET /api/v1/sports/student-privacy`. */
export interface StudentPrivacySettings {
  /** True at a K-12 school or a tenant that serves minors: default deny is on. */
  applies: boolean;
  appliesBecause: 'k12' | 'serves-minors' | null;
  /** This location's own "we serve minors" answer (non-K-12 only; null = not stated). */
  servesMinors: boolean | null;
  names: StudentPrivacyCategoryView;
  photos: StudentPrivacyCategoryView;
  attestation: {
    version: string;
    text: Record<StudentPrivacyCategory, string>;
  };
  /** May the CALLER change these settings (and confirm the attestations)? */
  canChange: boolean;
}

/** `PUT /api/v1/sports/student-privacy/:category`. */
export type StudentPrivacyAction = 'confirm' | 'revoke' | 'hide' | 'unhide';
