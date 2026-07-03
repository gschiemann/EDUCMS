import { Injectable, Logger, BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import * as argon2 from 'argon2';
import { randomBytes, createHash } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AuthService } from '../auth/auth.service';
import { assertCallerCanAssignRole } from '../auth/role-assignment';
import { EmailService } from '../email/email.service';
import { SampleDataService } from '../sample-data/sample-data.service';
import { AppRole } from '@cms/database';
import { isVertical } from '@cms/api-types';

export const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000;     // 1 hour
export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;    // 7 days

const ALLOWED_INVITE_ROLES: string[] = [
  AppRole.DISTRICT_ADMIN,
  AppRole.SCHOOL_ADMIN,
  AppRole.CONTRIBUTOR,
  AppRole.RESTRICTED_VIEWER,
];

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function generateToken(): string {
  return randomBytes(32).toString('base64url');
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function validatePassword(password: string): void {
  if (!password || password.length < 8) {
    throw new BadRequestException('Password must be at least 8 characters.');
  }
  if (password.length > 200) {
    throw new BadRequestException('Password is too long.');
  }
}

@Injectable()
export class OnboardingService {
  private readonly logger = new Logger(OnboardingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly authService: AuthService,
    private readonly emailService: EmailService,
    private readonly sampleData: SampleDataService,
  ) {}

  /**
   * District self-signup: creates a Tenant + first DISTRICT_ADMIN User, then auto-logs them in.
   */
  async signup(input: {
    districtName: string;
    slug?: string;
    adminEmail: string;
    password: string;
    vertical?: string;
    // 2026-05-25 — auth-Phase-1: collect identity at signup so the
    // first admin has a real profile (first name shown on dashboard
    // greeting, last name on user-list rows) and so the 2FA setup
    // path later has a phone to fall back on for SMS recovery codes.
    // All three are optional — legacy callers + the "just paste an
    // email and go" path still work.
    firstName?: string;
    lastName?: string;
    phone?: string;
    address?: string;
    latitude?: number;
    longitude?: number;
  }) {
    const districtName = (input.districtName || '').trim();
    const rawSlug = slugify(input.slug || districtName);
    const email = (input.adminEmail || '').trim().toLowerCase();
    const firstName = (input.firstName || '').trim().slice(0, 80) || null;
    const lastName = (input.lastName || '').trim().slice(0, 80) || null;
    const address = (input.address || '').trim().slice(0, 500) || null;
    // 2026-05-25 — lat/lng come from the client-side autocomplete
    // pick. Bounds-checked against world ranges so a broken payload
    // can't write garbage coords. Only stored when BOTH are present
    // (a single coord without its pair is meaningless).
    const lat =
      typeof input.latitude === 'number' && input.latitude >= -90 && input.latitude <= 90
        ? input.latitude
        : null;
    const lon =
      typeof input.longitude === 'number' && input.longitude >= -180 && input.longitude <= 180
        ? input.longitude
        : null;
    const coordsValid = lat !== null && lon !== null;
    // Strip all non-digit chars except a leading +. Normalize at the
    // edge so downstream code never has to parse "(213) 555-1234" vs
    // "+1-213-555-1234". Empty after normalization → null.
    const phoneRaw = (input.phone || '').trim();
    const phoneNormalized = phoneRaw
      ? (phoneRaw.startsWith('+') ? '+' : '') + phoneRaw.replace(/\D/g, '')
      : '';
    const phone = phoneNormalized.length >= 5 ? phoneNormalized.slice(0, 32) : null;

    if (!districtName) throw new BadRequestException('Organization name is required.');
    if (!rawSlug) throw new BadRequestException('Slug is required.');
    if (!isValidEmail(email)) throw new BadRequestException('A valid admin email is required.');
    validatePassword(input.password);

    // VenueOS multi-vertical signup. Default K12 preserves the original
    // pilot behavior; new signups pass a vertical explicitly via the
    // picker. Validated against the canonical VERTICALS list
    // (packages/api-types/src/verticals.ts) — the single source of
    // truth, so adding a vertical there is the only change required.
    const requestedVertical = (input.vertical || 'K12').toUpperCase();
    if (!isVertical(requestedVertical)) {
      throw new BadRequestException('Invalid vertical.');
    }

    const [existingTenant, existingUser] = await Promise.all([
      this.prisma.client.tenant.findUnique({ where: { slug: rawSlug } }),
      this.prisma.client.user.findUnique({ where: { email } }),
    ]);
    if (existingTenant) throw new ConflictException('That slug is already taken.');
    if (existingUser) throw new ConflictException('An account with that email already exists.');

    const passwordHash = await this.authService.hashPassword(input.password);

    const { tenant, user } = await this.prisma.client.$transaction(async (tx) => {
      const tenant = await tx.tenant.create({
        data: {
          name: districtName,
          slug: rawSlug,
          vertical: requestedVertical,
          address,
          ...(coordsValid ? { latitude: lat, longitude: lon } : {}),
        } as any,
      });
      const user = await tx.user.create({
        data: {
          tenantId: tenant.id,
          email,
          passwordHash,
          role: AppRole.DISTRICT_ADMIN,
          status: 'ACTIVE',
          firstName,
          lastName,
          phone,
        } as any,
      });
      await tx.auditLog.create({
        data: {
          tenantId: tenant.id,
          userId: user.id,
          action: 'TENANT_SIGNUP',
          targetType: 'Tenant',
          targetId: tenant.id,
          // Audit-log redaction: never persist the phone in plaintext
          // in the audit details (it's PII; the value lives on User.phone
          // exactly once). Email + slug are already in the row and safe
          // to repeat for forensics.
          details: JSON.stringify({
            email,
            slug: rawSlug,
            hasPhone: !!phone,
            hasFirstName: !!firstName,
            hasLastName: !!lastName,
          }),
        },
      });
      return { tenant, user };
    });

    // email-fix #2 (2026-07-03): sendWelcome runs AFTER the Tenant +
    // DISTRICT_ADMIN User are already committed above. A throw here
    // (unset RESEND_API_KEY in prod, or a flaky Resend call) used to 500
    // this whole request even though the account was already created —
    // the applicant would be stranded (a retry hits "account already
    // exists"). Guard it: on failure, log a warning and continue — the
    // email_logs FAILED row from EmailService's own #enqueue is the
    // durable record, and signup must succeed regardless of mail delivery.
    try {
      await this.emailService.sendWelcome({ to: user.email, districtName: tenant.name, tenantSlug: tenant.slug });
    } catch (e: any) {
      this.logger.warn(
        `signup(${tenant.id}): sendWelcome failed, continuing signup anyway: ${e?.message ?? e}`,
      );
    }

    // Auto-seed vertical-appropriate sample data so new tenants land on
    // a populated dashboard rather than a blank slate. Non-blocking:
    // failures are swallowed inside seedForNewTenant — signup always
    // completes. Idempotent: SampleDataService checks for existing
    // connections before inserting, so a retry is always safe.
    void this.sampleData.seedForNewTenant(tenant.id, user.id, requestedVertical);

    return this.authService.login(user);
  }

  /**
   * Create a password-reset token. Always returns `{ ok: true }` even if the email
   * is unknown — we do not leak account existence. ALSO returns
   * `emailConfigured: false` when outbound mail isn't wired (2026-05-23
   * launch audit P0 — previously the UI said "check your inbox" even
   * when no email was ever sent, locking users out). The flag is
   * deployment-level info, not per-account, so it's safe to return
   * unconditionally without enabling email enumeration.
   */
  async requestPasswordReset(email: string): Promise<{ ok: true; emailConfigured: boolean }> {
    const emailConfigured = this.emailService.isConfigured();
    const normalized = (email || '').trim().toLowerCase();
    if (!isValidEmail(normalized)) {
      return { ok: true, emailConfigured }; // silently ignore to avoid enumeration
    }

    const user = await this.prisma.client.user.findUnique({ where: { email: normalized } });
    if (!user) {
      return { ok: true, emailConfigured };
    }

    const token = generateToken();
    const tokenHash = hashToken(token);
    const expiresAt = new Date(Date.now() + PASSWORD_RESET_TTL_MS);

    await this.prisma.client.passwordResetToken.create({
      data: { userId: user.id, tokenHash, expiresAt },
    });

    await this.emailService.sendPasswordReset({ to: user.email, resetToken: token });
    return { ok: true, emailConfigured };
  }

  async completePasswordReset(input: { token: string; newPassword: string }) {
    validatePassword(input.newPassword);
    if (!input.token) throw new BadRequestException('Reset token is required.');

    const tokenHash = hashToken(input.token);
    const record = await this.prisma.client.passwordResetToken.findUnique({
      where: { tokenHash },
      include: { user: true },
    });
    if (!record) throw new BadRequestException('Invalid or expired reset link.');
    if (record.usedAt) throw new BadRequestException('This reset link has already been used.');
    if (record.expiresAt.getTime() < Date.now()) {
      throw new BadRequestException('This reset link has expired.');
    }

    const passwordHash = await this.authService.hashPassword(input.newPassword);

    await this.prisma.client.$transaction(async (tx) => {
      await tx.user.update({ where: { id: record.userId }, data: { passwordHash } });
      await tx.passwordResetToken.update({
        where: { id: record.id },
        data: { usedAt: new Date() },
      });
      await tx.auditLog.create({
        data: {
          tenantId: record.user.tenantId,
          userId: record.userId,
          action: 'PASSWORD_RESET_COMPLETED',
          targetType: 'User',
          targetId: record.userId,
        },
      });
    });

    return { ok: true };
  }

  /**
   * Invite a new user by email. Admin enters email + role → a placeholder user (INVITED)
   * is created and a tokenized link is emailed. The recipient completes the signup via
   * `/accept-invite/[token]`.
   */
  async createInvite(input: {
    inviterId: string;
    tenantId: string;
    email: string;
    role: string;
    // 2026-05-11 — capture display name at invite time so the new
    // user's dashboard greeting reads correctly from their first
    // login, instead of guessing from the email prefix.
    firstName?: string;
    lastName?: string;
  }) {
    const email = (input.email || '').trim().toLowerCase();
    const role = input.role;
    if (!isValidEmail(email)) throw new BadRequestException('A valid email is required.');
    if (!ALLOWED_INVITE_ROLES.includes(role)) {
      throw new BadRequestException(`Role must be one of: ${ALLOWED_INVITE_ROLES.join(', ')}`);
    }
    // Name validation — same 80-char cap as PUT /users/me + nullable.
    const trimName = (v: unknown): string | null => {
      if (typeof v !== 'string') return null;
      const t = v.trim();
      if (!t) return null;
      if (t.length > 80) throw new BadRequestException('Name too long (max 80 characters)');
      return t;
    };
    const firstName = trimName(input.firstName);
    const lastName = trimName(input.lastName);

    const inviter = await this.prisma.client.user.findUnique({ where: { id: input.inviterId } });
    if (!inviter) throw new NotFoundException('Inviter not found.');

    // auth audit — a caller may only invite a role strictly below their
    // own rank. ALLOWED_INVITE_ROLES above is a coarse is-this-a-real-
    // role gate; THIS is the privilege-escalation guard (a SCHOOL_ADMIN
    // must not be able to invite a DISTRICT_ADMIN).
    assertCallerCanAssignRole(inviter.role, role);

    const tenant = await this.prisma.client.tenant.findUnique({ where: { id: input.tenantId } });
    if (!tenant) throw new NotFoundException('Tenant not found.');

    // Audit fix #7: cross-tenant invite injection guard. Without this, a
    // DISTRICT_ADMIN from Tenant A could invite a user into Tenant B by
    // crafting the request body. SUPER_ADMIN is allowed cross-tenant by
    // design; DISTRICT_ADMIN may invite into their own district OR a child
    // school of their district; everyone else is locked to their own
    // tenant.
    if (inviter.role !== 'SUPER_ADMIN' && inviter.tenantId !== input.tenantId) {
      // Allow DISTRICT_ADMIN to invite into a child school of their district.
      if (inviter.role === 'DISTRICT_ADMIN') {
        const targetTenant = tenant.parentId === inviter.tenantId ? tenant : null;
        if (!targetTenant) {
          throw new BadRequestException("You can only invite users into tenants in your district.");
        }
      } else {
        throw new BadRequestException("You can only invite users into your own tenant.");
      }
    }

    const existing = await this.prisma.client.user.findUnique({ where: { email } });
    if (existing && existing.status === 'ACTIVE') {
      throw new ConflictException('A user with that email already exists.');
    }

    const token = generateToken();
    const tokenHash = hashToken(token);
    const expiresAt = new Date(Date.now() + INVITE_TTL_MS);

    // Placeholder password hash — the recipient sets the real one at accept time.
    const placeholderHash = await this.authService.hashPassword(generateToken());

    const invite = await this.prisma.client.$transaction(async (tx) => {
      let placeholderUser = existing;
      if (!placeholderUser) {
        placeholderUser = await tx.user.create({
          data: {
            tenantId: input.tenantId,
            email,
            passwordHash: placeholderHash,
            role,
            status: 'INVITED',
            firstName,
            lastName,
          } as any,
        });
      } else if (firstName || lastName) {
        // Existing INVITED row + admin re-sends invite with names —
        // update so the new info isn't dropped. Don't overwrite a
        // non-null DB value with null though.
        const patch: any = {};
        if (firstName != null) patch.firstName = firstName;
        if (lastName != null) patch.lastName = lastName;
        if (Object.keys(patch).length > 0) {
          placeholderUser = await tx.user.update({
            where: { id: placeholderUser.id },
            data: patch,
          });
        }
      }
      const invite = await tx.userInvite.create({
        data: {
          tenantId: input.tenantId,
          email,
          role,
          tokenHash,
          invitedById: input.inviterId,
          userId: placeholderUser.id,
          expiresAt,
        },
      });
      await tx.auditLog.create({
        data: {
          tenantId: input.tenantId,
          userId: input.inviterId,
          action: 'USER_INVITED',
          targetType: 'User',
          targetId: placeholderUser.id,
          details: JSON.stringify({ email, role }),
        },
      });
      return invite;
    });

    await this.emailService.sendUserInvite({
      to: email,
      inviterEmail: inviter.email,
      tenantName: tenant.name,
      role,
      inviteToken: token,
    });

    // Email dispatch is a stub in most deployments (no SMTP/Resend/SendGrid
    // wired up yet). Return the accept URL to the caller so the admin can
    // copy + send it manually — otherwise invited users never learn they
    // were invited. Once a transactional email provider is configured,
    // the UI can hide the "copy link" panel based on EMAIL_PROVIDER env.
    const baseUrl =
      process.env.PUBLIC_WEB_URL ||
      process.env.NEXT_PUBLIC_WEB_URL ||
      process.env.ALLOWED_ORIGINS?.split(',')[0]?.trim() ||
      '';
    const acceptUrl = baseUrl ? `${baseUrl.replace(/\/$/, '')}/accept-invite/${token}` : `/accept-invite/${token}`;

    return {
      id: invite.id,
      email,
      role,
      expiresAt,
      acceptUrl,
      emailDelivered: !!process.env.EMAIL_PROVIDER,
    };
  }

  /**
   * Admin creates a user with a password directly — skips the email-invite
   * round-trip entirely. Useful while no transactional email provider is
   * wired up, or for environments where the admin wants to hand the
   * credentials over in-person / via Slack. Same RBAC + cross-tenant
   * rules as createInvite.
   */
  async createUserDirect(input: {
    inviterId: string;
    tenantId: string;
    email: string;
    role: string;
    password: string;
    firstName?: string;
    lastName?: string;
  }) {
    const email = (input.email || '').trim().toLowerCase();
    const role = input.role;
    if (!isValidEmail(email)) throw new BadRequestException('A valid email is required.');
    if (!ALLOWED_INVITE_ROLES.includes(role)) {
      throw new BadRequestException(`Role must be one of: ${ALLOWED_INVITE_ROLES.join(', ')}`);
    }
    validatePassword(input.password);
    // 2026-05-11 — display names captured at create time (same
    // cap/null-as-empty rules as PUT /users/me).
    const trimName = (v: unknown): string | null => {
      if (typeof v !== 'string') return null;
      const t = v.trim();
      if (!t) return null;
      if (t.length > 80) throw new BadRequestException('Name too long (max 80 characters)');
      return t;
    };
    const firstName = trimName(input.firstName);
    const lastName = trimName(input.lastName);

    const inviter = await this.prisma.client.user.findUnique({ where: { id: input.inviterId } });
    if (!inviter) throw new NotFoundException('Inviter not found.');
    // auth audit — same role-rank escalation guard as createInvite.
    assertCallerCanAssignRole(inviter.role, role);
    const tenant = await this.prisma.client.tenant.findUnique({ where: { id: input.tenantId } });
    if (!tenant) throw new NotFoundException('Tenant not found.');

    // Same cross-tenant guard as createInvite.
    if (inviter.role !== 'SUPER_ADMIN' && inviter.tenantId !== input.tenantId) {
      if (inviter.role === 'DISTRICT_ADMIN') {
        if (tenant.parentId !== inviter.tenantId) {
          throw new BadRequestException("You can only add users to tenants in your district.");
        }
      } else {
        throw new BadRequestException("You can only add users to your own tenant.");
      }
    }

    const existing = await this.prisma.client.user.findUnique({ where: { email } });
    if (existing && existing.status === 'ACTIVE') {
      throw new ConflictException('A user with that email already exists.');
    }

    const passwordHash = await this.authService.hashPassword(input.password);

    const user = await this.prisma.client.$transaction(async (tx) => {
      let u = existing;
      if (u) {
        const patch: any = { role, status: 'ACTIVE', passwordHash, tenantId: input.tenantId };
        if (firstName != null) patch.firstName = firstName;
        if (lastName != null) patch.lastName = lastName;
        u = await tx.user.update({
          where: { id: u.id },
          data: patch,
        });
      } else {
        u = await tx.user.create({
          data: {
            tenantId: input.tenantId,
            email,
            passwordHash,
            role,
            status: 'ACTIVE',
            firstName,
            lastName,
          } as any,
        });
      }
      await tx.auditLog.create({
        data: {
          tenantId: input.tenantId,
          userId: input.inviterId,
          action: 'USER_CREATED_DIRECT',
          targetType: 'User',
          targetId: u.id,
          details: JSON.stringify({ email, role, method: 'admin-set-password' }),
        },
      });
      return u;
    });

    return {
      id: user.id,
      email: user.email,
      role: user.role,
      status: user.status,
      createdAt: user.createdAt,
    };
  }

  async getInvitePreview(token: string) {
    if (!token) throw new BadRequestException('Invite token is required.');
    const tokenHash = hashToken(token);
    const invite = await this.prisma.client.userInvite.findUnique({
      where: { tokenHash },
      include: { tenant: { select: { name: true, slug: true } } },
    });
    if (!invite) throw new NotFoundException('Invalid invite link.');
    if (invite.acceptedAt) throw new BadRequestException('This invitation has already been accepted.');
    if (invite.expiresAt.getTime() < Date.now()) {
      throw new BadRequestException('This invitation has expired.');
    }
    return {
      email: invite.email,
      role: invite.role,
      tenantName: invite.tenant.name,
      expiresAt: invite.expiresAt,
    };
  }

  async acceptInvite(input: { token: string; password: string }) {
    validatePassword(input.password);
    if (!input.token) throw new BadRequestException('Invite token is required.');

    const tokenHash = hashToken(input.token);
    const invite = await this.prisma.client.userInvite.findUnique({
      where: { tokenHash },
      include: { user: true },
    });
    if (!invite) throw new BadRequestException('Invalid invite link.');
    if (invite.acceptedAt) throw new BadRequestException('This invitation has already been accepted.');
    if (invite.expiresAt.getTime() < Date.now()) {
      throw new BadRequestException('This invitation has expired.');
    }
    if (!invite.userId) {
      throw new BadRequestException('Invite is missing its target user.');
    }

    const passwordHash = await this.authService.hashPassword(input.password);

    const user = await this.prisma.client.$transaction(async (tx) => {
      const user = await tx.user.update({
        where: { id: invite.userId! },
        data: { passwordHash, status: 'ACTIVE' },
      });
      await tx.userInvite.update({
        where: { id: invite.id },
        data: { acceptedAt: new Date() },
      });
      await tx.auditLog.create({
        data: {
          tenantId: invite.tenantId,
          userId: user.id,
          action: 'INVITE_ACCEPTED',
          targetType: 'User',
          targetId: user.id,
        },
      });
      return user;
    });

    return this.authService.login(user);
  }
}
