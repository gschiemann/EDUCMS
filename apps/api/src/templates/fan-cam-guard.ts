/**
 * The Fan Cam's words where students are on screen (K-12 sports launch, lane
 * B3, leftover b — 2026-09-27). The rule itself is shared with the builder:
 * packages/api-types/src/fan-cam.ts.
 *
 * Runs beside the INJ-003 URL gate on every write that persists zone config —
 * create (which import reuses), replace zones, restore a version — because
 * the builder's own check is only the first line: a title can also be typed
 * straight onto the canvas, or arrive in an imported file.
 *
 * The scan is pure and costs nothing. Only a save that actually carries a
 * refused word reads the tenant chain, to learn whether students are the
 * audience: a K-12 school, or a location that says its athletes include
 * minors — the student-privacy policy's own test (`applies`). Everywhere else
 * the operator's words stand. An unreadable chain refuses: that is the
 * direction a failure has to fall when the question is about children.
 */
import { HttpException, HttpStatus } from '@nestjs/common';
import {
  FAN_CAM_TITLE_NOT_SCHOOL_SAFE,
  unsafeFanCamTexts,
  type FanCamZoneLike,
} from '@cms/api-types';
import {
  loadPolicyChain,
  resolveStudentPrivacy,
  type StudentPrivacyDb,
} from '../sports/student-privacy';

export async function assertFanCamTextSchoolSafe(
  db: StudentPrivacyDb,
  tenantId: string,
  zones: ReadonlyArray<FanCamZoneLike> | null | undefined,
): Promise<void> {
  const refused = unsafeFanCamTexts(zones);
  if (refused.length === 0) return;
  let studentsOnScreen: boolean;
  try {
    studentsOnScreen = resolveStudentPrivacy(
      await loadPolicyChain(db, tenantId),
    ).applies;
  } catch {
    studentsOnScreen = true;
  }
  if (!studentsOnScreen) return;
  throw new HttpException(
    {
      code: FAN_CAM_TITLE_NOT_SCHOOL_SAFE,
      message: `A Fan Cam that says "${refused[0]}" isn't available where students are on screen. Pick a school-safe title such as FAN CAM, SPIRIT CAM or DANCE CAM.`,
      titles: refused,
    },
    HttpStatus.BAD_REQUEST,
  );
}
