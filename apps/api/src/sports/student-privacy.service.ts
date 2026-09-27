import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  STUDENT_PRIVACY_ATTESTATION_TEXT,
  STUDENT_PRIVACY_ATTESTATION_VERSION,
  isAcceptedStudentPrivacyVersion,
  studentPrivacyAppliesToVertical,
  type StudentPrivacyAction,
  type StudentPrivacyActor,
  type StudentPrivacyCategory,
  type StudentPrivacyCategoryView,
  type StudentPrivacySettings,
  type StudentPrivacyState,
} from '@cms/api-types';
import { PrismaService } from '../prisma/prisma.service';
import {
  loadPolicyChain,
  loadStudentPolicy,
  privacyStateOf,
  resolveStudentPrivacy,
  studentFlags,
  type PolicyChainNode,
  type StudentPolicy,
} from './student-privacy';

/**
 * Student information on public screens — the settings side (K-12 sports
 * launch, lane B3, 2026-09-27). The enforcement is ./student-privacy.ts; this
 * service is where a school's decision is recorded:
 *
 *   • the school's (or district's) attestation per category — names, photos —
 *     stored with who confirmed it, when, and which wording (version);
 *     revocable, and a revocation hides at once (the public board rebuilds at
 *     most one second later, with no cache to invalidate);
 *   • a school stricter than its district ("Hide at this school");
 *   • a non-K-12 tenant stating that it serves minors (the default-deny then
 *     applies to it too);
 *   • the per-student flags on a game's roster ("Directory opt-out — never
 *     display", "Photo release on file").
 *
 * Every change writes an immutable AuditLog row in the SAME transaction as the
 * change (K12-F34 convention), naming the actor.
 *
 * WHO MAY DO WHAT — a decision that SHOWS more of a student is a school's legal
 * decision, so only the school's own administrators make it; anything that
 * shows LESS is open to more people, because it can only protect a student:
 *   confirm an attestation ........ DISTRICT_ADMIN, SCHOOL_ADMIN — a real
 *                                    person (never an API key), against the
 *                                    CURRENT wording
 *   revoke / hide ................. + SUPER_ADMIN (VenueOS staff may only ever
 *                                    make it stricter)
 *   un-hide / serves-minors off ... DISTRICT_ADMIN, SCHOOL_ADMIN
 *   serves-minors on .............. + SUPER_ADMIN
 *   student opt-out ON, release OFF  anyone who edits the roster (+ CONTRIBUTOR)
 *   student opt-out OFF, release ON  DISTRICT_ADMIN, SCHOOL_ADMIN
 */

export interface PrivacyCaller {
  userId: string | null;
  role: string;
  apiKeyId?: string | null;
}

const SCHOOL_ADMINS: ReadonlySet<string> = new Set([
  'DISTRICT_ADMIN',
  'SCHOOL_ADMIN',
]);
const STRICTER_ONLY: ReadonlySet<string> = new Set([
  'DISTRICT_ADMIN',
  'SCHOOL_ADMIN',
  'SUPER_ADMIN',
]);
const ROSTER_EDITORS: ReadonlySet<string> = new Set([
  'DISTRICT_ADMIN',
  'SCHOOL_ADMIN',
  'SUPER_ADMIN',
  'CONTRIBUTOR',
]);

const CATEGORIES: ReadonlySet<string> = new Set(['names', 'photos']);
const ACTIONS: ReadonlySet<string> = new Set([
  'confirm',
  'revoke',
  'hide',
  'unhide',
]);

function isoOrNull(v: unknown): string | null {
  if (v instanceof Date) return v.toISOString();
  return typeof v === 'string' ? v : null;
}

@Injectable()
export class StudentPrivacyService {
  constructor(private readonly prisma: PrismaService) {}

  /** The policy a public output applies for this tenant (fail closed). */
  policyFor(tenantId: string): Promise<StudentPolicy> {
    return loadStudentPolicy(this.prisma.client, tenantId);
  }

  // ── settings ────────────────────────────────────────────────────────────

  async getSettings(
    tenantId: string,
    caller: PrivacyCaller,
  ): Promise<StudentPrivacySettings> {
    let chain: PolicyChainNode[];
    try {
      chain = await loadPolicyChain(this.prisma.client, tenantId);
    } catch {
      throw new NotFoundException('Location not found');
    }
    const resolved = resolveStudentPrivacy(chain);
    const self = chain[0];
    const actors = await this.actorsById(
      chain
        .flatMap((n) => [n.namesSetByUserId, n.photosSetByUserId])
        .filter((x): x is string => !!x),
    );
    const view = (cat: StudentPrivacyCategory): StudentPrivacyCategoryView => {
      const r = resolved[cat];
      const own = privacyStateOf(
        cat === 'names' ? self.namesState : self.photosState,
      );
      const ownVersion =
        cat === 'names'
          ? self.namesAttestationVersion
          : self.photosAttestationVersion;
      const src = r.sourceIndex >= 0 ? chain[r.sourceIndex] : null;
      const setBy = src
        ? cat === 'names'
          ? src.namesSetByUserId
          : src.photosSetByUserId
        : null;
      return {
        allowed: resolved.applies ? r.allowed : true,
        own,
        source:
          src && r.sourceState
            ? {
                level: r.sourceIndex === 0 ? 'self' : 'parent',
                tenantId: src.tenantId,
                tenantName: src.name ?? null,
                state: r.sourceState,
                setAt: isoOrNull(
                  cat === 'names' ? src.namesSetAt : src.photosSetAt,
                ),
                setBy: setBy
                  ? (actors.get(setBy) ?? {
                      id: setBy,
                      name: null,
                      email: null,
                    })
                  : null,
                version:
                  r.sourceState === 'ALLOW'
                    ? ((cat === 'names'
                        ? src.namesAttestationVersion
                        : src.photosAttestationVersion) ?? null)
                    : null,
              }
            : null,
        needsReconfirm:
          own === 'ALLOW' && !isAcceptedStudentPrivacyVersion(ownVersion),
      };
    };
    const k12Self = studentPrivacyAppliesToVertical(self.vertical);
    return {
      applies: resolved.applies,
      appliesBecause: resolved.appliesBecause,
      servesMinors: k12Self ? null : (self.servesMinors ?? null),
      names: view('names'),
      photos: view('photos'),
      attestation: {
        version: STUDENT_PRIVACY_ATTESTATION_VERSION,
        text: { ...STUDENT_PRIVACY_ATTESTATION_TEXT },
      },
      canChange:
        SCHOOL_ADMINS.has(caller.role) && !!caller.userId && !caller.apiKeyId,
    };
  }

  private async actorsById(
    ids: string[],
  ): Promise<Map<string, StudentPrivacyActor>> {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return new Map();
    // A display lookup of the people who made THIS chain's settings — the ids
    // come from our own policy rows, never from the request.
    const users = await this.prisma.client.user.findMany({
      where: { id: { in: unique } },
      select: { id: true, email: true, firstName: true, lastName: true },
    });
    return new Map(
      users.map((u) => {
        const name = [u.firstName, u.lastName].filter(Boolean).join(' ').trim();
        return [
          u.id,
          { id: u.id, name: name || null, email: u.email ?? null },
        ] as const;
      }),
    );
  }

  /**
   * Confirm / revoke / hide / un-hide one category at the caller's location.
   * `version` must be the wording the admin was shown when confirming.
   */
  async setCategory(
    tenantId: string,
    caller: PrivacyCaller,
    categoryRaw: string,
    actionRaw: unknown,
    version?: unknown,
  ): Promise<StudentPrivacySettings> {
    if (!CATEGORIES.has(categoryRaw))
      throw new NotFoundException('Unknown setting');
    if (typeof actionRaw !== 'string' || !ACTIONS.has(actionRaw)) {
      throw new BadRequestException(
        'action must be one of confirm, revoke, hide, unhide',
      );
    }
    const category = categoryRaw as StudentPrivacyCategory;
    const action = actionRaw as StudentPrivacyAction;

    if (action === 'confirm') {
      if (
        !SCHOOL_ADMINS.has(caller.role) ||
        !caller.userId ||
        caller.apiKeyId
      ) {
        throw new ForbiddenException({
          code: 'STUDENT_PRIVACY_ADMIN_ONLY',
          message:
            "Only your school's or district's administrator can confirm this.",
        });
      }
      if (version !== STUDENT_PRIVACY_ATTESTATION_VERSION) {
        throw new ConflictException({
          code: 'STUDENT_PRIVACY_WORDING_CHANGED',
          message:
            'The wording you confirmed has changed. Reload the page and read it again.',
        });
      }
    } else if (action === 'unhide') {
      if (!SCHOOL_ADMINS.has(caller.role)) {
        throw new ForbiddenException({
          code: 'STUDENT_PRIVACY_ADMIN_ONLY',
          message:
            "Only your school's or district's administrator can change this.",
        });
      }
    } else if (!STRICTER_ONLY.has(caller.role)) {
      throw new ForbiddenException({
        code: 'STUDENT_PRIVACY_ADMIN_ONLY',
        message: 'Administrators only.',
      });
    }

    await this.prisma.client.$transaction(async (tx) => {
      const current = await tx.studentPrivacyPolicy.findUnique({
        where: { tenantId },
      });
      const before = privacyStateOf(
        category === 'names' ? current?.namesState : current?.photosState,
      );
      let next: StudentPrivacyState | null;
      if (action === 'confirm') next = 'ALLOW';
      else if (action === 'hide') next = 'HIDE';
      else if (action === 'revoke') next = before === 'ALLOW' ? null : before;
      else next = before === 'HIDE' ? null : before; // unhide
      const setAt = next ? new Date() : null;
      const setBy = next ? caller.userId : null;
      const version =
        next === 'ALLOW' ? STUDENT_PRIVACY_ATTESTATION_VERSION : null;
      const data =
        category === 'names'
          ? {
              namesState: next,
              namesSetAt: setAt,
              namesSetByUserId: setBy,
              namesAttestationVersion: version,
            }
          : {
              photosState: next,
              photosSetAt: setAt,
              photosSetByUserId: setBy,
              photosAttestationVersion: version,
            };
      await tx.studentPrivacyPolicy.upsert({
        where: { tenantId },
        create: { tenantId, ...data },
        update: data,
      });
      await tx.auditLog.create({
        data: {
          tenantId,
          userId: caller.userId,
          action: `STUDENT_PRIVACY_${category.toUpperCase()}_${action.toUpperCase()}`,
          targetType: 'Tenant',
          targetId: tenantId,
          details: JSON.stringify({
            category,
            action,
            before,
            after: next,
            // What was agreed to, word for word (confirm only).
            ...(action === 'confirm'
              ? {
                  version: STUDENT_PRIVACY_ATTESTATION_VERSION,
                  text: STUDENT_PRIVACY_ATTESTATION_TEXT[category],
                }
              : {}),
            actor: { role: caller.role, apiKeyId: caller.apiKeyId ?? null },
          }),
        },
      });
    });
    return this.getSettings(tenantId, caller);
  }

  /** A non-K-12 tenant says whether its athletes include minors. */
  async setServesMinors(
    tenantId: string,
    caller: PrivacyCaller,
    value: unknown,
  ): Promise<StudentPrivacySettings> {
    if (typeof value !== 'boolean')
      throw new BadRequestException('servesMinors must be true or false');
    if (
      value ? !STRICTER_ONLY.has(caller.role) : !SCHOOL_ADMINS.has(caller.role)
    ) {
      throw new ForbiddenException({
        code: 'STUDENT_PRIVACY_ADMIN_ONLY',
        message: 'Administrators only.',
      });
    }
    // ten-ok: the caller's own tenant row, read for its vertical only.
    const tenant = await this.prisma.client.tenant.findUnique({
      where: { id: tenantId },
      select: { vertical: true },
    });
    if (!tenant) throw new NotFoundException('Location not found');
    if (studentPrivacyAppliesToVertical(tenant.vertical)) {
      throw new BadRequestException({
        code: 'STUDENT_PRIVACY_ALWAYS_ON_FOR_SCHOOLS',
        message: 'Student privacy is always on for a school.',
      });
    }
    await this.prisma.client.$transaction(async (tx) => {
      const current = await tx.studentPrivacyPolicy.findUnique({
        where: { tenantId },
      });
      await tx.studentPrivacyPolicy.upsert({
        where: { tenantId },
        create: { tenantId, servesMinors: value },
        update: { servesMinors: value },
      });
      await tx.auditLog.create({
        data: {
          tenantId,
          userId: caller.userId,
          action: 'STUDENT_PRIVACY_SERVES_MINORS_SET',
          targetType: 'Tenant',
          targetId: tenantId,
          details: JSON.stringify({
            before: current?.servesMinors ?? null,
            after: value,
            actor: { role: caller.role, apiKeyId: caller.apiKeyId ?? null },
          }),
        },
      });
    });
    return this.getSettings(tenantId, caller);
  }

  // ── per-student flags ─────────────────────────────────────────────────────

  /**
   * Set a roster student's "Directory opt-out" and/or "Photo release on file".
   * A row linked to a persistent athlete writes the athlete too, so the flag
   * follows the student into every game. Returns the flags the public view now
   * applies.
   */
  async setStudentFlags(
    tenantId: string,
    gameId: string,
    playerId: string,
    caller: PrivacyCaller,
    body: unknown,
  ): Promise<{
    playerId: string;
    directoryOptOut: boolean;
    photoRelease: boolean;
    linked: boolean;
  }> {
    const b =
      body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
    const optOut =
      typeof b.directoryOptOut === 'boolean' ? b.directoryOptOut : undefined;
    const release =
      typeof b.photoRelease === 'boolean' ? b.photoRelease : undefined;
    if (optOut === undefined && release === undefined) {
      throw new BadRequestException(
        'Send directoryOptOut and/or photoRelease (true or false).',
      );
    }
    if (!ROSTER_EDITORS.has(caller.role)) {
      throw new ForbiddenException({
        code: 'STUDENT_PRIVACY_ADMIN_ONLY',
        message: 'Not allowed.',
      });
    }
    // Showing MORE of a student (clearing an opt-out, recording a release) is
    // the school administrators' call; protecting a student is anyone's.
    const permissive = optOut === false || release === true;
    if (permissive && !SCHOOL_ADMINS.has(caller.role)) {
      throw new ForbiddenException({
        code: 'STUDENT_PRIVACY_ADMIN_ONLY',
        message:
          "Only your school's administrator can record a photo release or clear an opt-out.",
      });
    }

    const game = await this.prisma.client.game.findFirst({
      where: { id: gameId, tenantId },
      select: { id: true },
    });
    if (!game) throw new NotFoundException('Game not found');
    const player = await this.prisma.client.rosterPlayer.findFirst({
      where: { id: playerId, gameId, tenantId },
      select: {
        id: true,
        personId: true,
        directoryOptOut: true,
        photoRelease: true,
      },
    });
    if (!player) throw new NotFoundException('Player not found');

    const data: { directoryOptOut?: boolean; photoRelease?: boolean } = {};
    if (optOut !== undefined) data.directoryOptOut = optOut;
    if (release !== undefined) data.photoRelease = release;

    const result = await this.prisma.client.$transaction(async (tx) => {
      const row = await tx.rosterPlayer.update({
        where: { id: playerId, tenantId },
        data,
        select: {
          id: true,
          personId: true,
          directoryOptOut: true,
          photoRelease: true,
        },
      });
      let person: { directoryOptOut: boolean; photoRelease: boolean } | null =
        null;
      if (row.personId) {
        person = await tx.sportsPerson.update({
          where: { id: row.personId, tenantId },
          data,
          select: { directoryOptOut: true, photoRelease: true },
        });
      }
      await tx.auditLog.create({
        data: {
          tenantId,
          userId: caller.userId,
          action: 'SPORTS_STUDENT_PRIVACY_FLAGS_SET',
          targetType: 'RosterPlayer',
          targetId: playerId,
          details: JSON.stringify({
            gameId,
            personId: row.personId ?? null,
            before: {
              directoryOptOut: player.directoryOptOut,
              photoRelease: player.photoRelease,
            },
            after: data,
            actor: { role: caller.role, apiKeyId: caller.apiKeyId ?? null },
          }),
        },
      });
      return { row, person };
    });
    const flags = studentFlags({ ...result.row, person: result.person });
    return {
      playerId,
      directoryOptOut: flags.optOut,
      photoRelease: flags.photoRelease,
      linked: !!result.row.personId,
    };
  }
}
