import * as argon2 from 'argon2';

/**
 * Global crypto settings specifically aligning with AUTH_SESSION_SPEC.md 
 * Targets 45ms verification time standard
 */
export const cryptoPlatformConfig: argon2.Options = {
  type: argon2.argon2id,
  memoryCost: 65536, // 64MB
  timeCost: 3,       // Number of iterations
  parallelism: 4,
};
