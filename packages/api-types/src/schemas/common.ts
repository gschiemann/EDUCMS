import { z } from 'zod';

export const ScopeType = z.enum(['tenant', 'group', 'device']);
export type ScopeType = z.infer<typeof ScopeType>;

export const Severity = z.enum(['LOW', 'MODERATE', 'HIGH', 'CRITICAL']);
export type Severity = z.infer<typeof Severity>;

export const OverrideIncidentType = z.enum(['lockdown', 'weather', 'evacuate']);
export type OverrideIncidentType = z.infer<typeof OverrideIncidentType>;

export const Id = z.string().trim().min(1).max(128);
export const Cuid = z
  .string()
  .trim()
  .regex(/^[a-z0-9_]+$/i, 'Invalid identifier characters')
  .min(1)
  .max(128);

export const NonEmptyString = z.string().trim().min(1);
export const BoundedText = (max: number) => z.string().trim().max(max);
export const UrlString = z.string().trim().url().max(2048);

export const EpochSecondsOrIso = z.union([
  z.number().int().positive(),
  z.string().trim().datetime({ offset: true }),
]);
