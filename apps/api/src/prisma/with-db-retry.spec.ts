import { isTransientDbError, withDbRetry } from './with-db-retry';

describe('isTransientDbError', () => {
  it('flags Prisma transient codes as transient', () => {
    expect(isTransientDbError({ code: 'P1001' })).toBe(true);
    expect(isTransientDbError({ code: 'P1002' })).toBe(true);
    expect(isTransientDbError({ code: 'P1008' })).toBe(true);
    expect(isTransientDbError({ code: 'P1017' })).toBe(true);
    expect(isTransientDbError({ code: 'P2024' })).toBe(true);
    expect(isTransientDbError({ code: 'P2034' })).toBe(true);
  });

  it('does NOT flag logic errors as transient', () => {
    // P2002 = unique constraint violation. Retrying would just fail again.
    expect(isTransientDbError({ code: 'P2002' })).toBe(false);
    // P2025 = record not found. Retry would not change the answer.
    expect(isTransientDbError({ code: 'P2025' })).toBe(false);
  });

  it('flags message hints for pgbouncer + connection errors', () => {
    expect(isTransientDbError({ message: 'Connection terminated unexpectedly' })).toBe(true);
    expect(isTransientDbError({ message: 'connection pool timeout' })).toBe(true);
    expect(isTransientDbError({ message: 'prepared statement "s2" already exists' })).toBe(true);
    expect(isTransientDbError({ message: 'cached plan must not change result type' })).toBe(true);
    expect(isTransientDbError({ message: 'ECONNRESET ...' })).toBe(true);
    expect(isTransientDbError({ message: 'ETIMEDOUT after 30s' })).toBe(true);
  });

  it('does NOT flag unrelated errors as transient', () => {
    expect(isTransientDbError({ message: 'Validation failed' })).toBe(false);
    expect(isTransientDbError({ message: 'Tenant not found' })).toBe(false);
    expect(isTransientDbError(null)).toBe(false);
    expect(isTransientDbError(undefined)).toBe(false);
    expect(isTransientDbError('plain string')).toBe(false);
    expect(isTransientDbError(42)).toBe(false);
  });
});

describe('withDbRetry', () => {
  const silentLogger = { warn: jest.fn() };

  it('returns immediately on success', async () => {
    const fn = jest.fn().mockResolvedValue('ok');
    const result = await withDbRetry(fn, { logger: silentLogger });
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries on transient error then succeeds', async () => {
    const transient = Object.assign(new Error('Connection terminated'), { code: 'P1002' });
    const fn = jest.fn()
      .mockRejectedValueOnce(transient)
      .mockResolvedValueOnce('ok');
    const result = await withDbRetry(fn, { logger: silentLogger, baseDelayMs: 5 });
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('does not retry on non-transient error', async () => {
    const logic = Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
    const fn = jest.fn().mockRejectedValue(logic);
    await expect(withDbRetry(fn, { logger: silentLogger, baseDelayMs: 5 })).rejects.toBe(logic);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('gives up after maxAttempts', async () => {
    const transient = Object.assign(new Error('ETIMEDOUT'), { code: 'P1008' });
    const fn = jest.fn().mockRejectedValue(transient);
    await expect(
      withDbRetry(fn, { logger: silentLogger, baseDelayMs: 5, maxAttempts: 3 }),
    ).rejects.toBe(transient);
    expect(fn).toHaveBeenCalledTimes(3);
  });
});
