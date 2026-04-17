import { z } from 'zod';
import {
  ScopeType,
  Severity,
  OverrideIncidentType,
  Id,
  BoundedText,
  UrlString,
  EpochSecondsOrIso,
} from './common';

export const OverridePayloadSchema = z
  .object({
    overrideId: Id.optional(),
    type: OverrideIncidentType.optional(),
    severity: Severity.default('CRITICAL'),
    mediaUrl: UrlString.optional(),
    textBlob: BoundedText(5000).optional(),
    expiresAt: EpochSecondsOrIso.optional(),
    playlistId: Id.optional(),
  })
  .strict();
export type OverridePayload = z.infer<typeof OverridePayloadSchema>;

export const TriggerEmergencyInputSchema = z
  .object({
    scopeType: ScopeType,
    scopeId: Id,
    overridePayload: OverridePayloadSchema,
  })
  .strict();
export type TriggerEmergencyInput = z.infer<typeof TriggerEmergencyInputSchema>;

export const ClearEmergencyInputSchema = z
  .object({
    scopeType: ScopeType,
    scopeId: Id,
  })
  .strict();
export type ClearEmergencyInput = z.infer<typeof ClearEmergencyInputSchema>;
