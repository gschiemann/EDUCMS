/**
 * Proves the load-bearing claim behind the global mutation-error toast:
 * TanStack Query v5 runs `MutationCache.onError` IN ADDITION to each
 * mutation's own `onError`, so every optimistic rollback in use-api.ts keeps
 * working — the operator just finally sees the failure.
 *
 * Runs against a REAL QueryClient (no React) so a react-query upgrade that
 * changed that behavior would fail here instead of silently double-reporting
 * or silently going quiet again.
 */
import { QueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { buildMutationCache } from '../mutation-error-cache';
import {
  BURST_ERROR_MESSAGE,
  FALLBACK_ERROR_MESSAGE,
  MUTATION_ERROR_TOAST_ID,
  OFFLINE_ERROR_MESSAGE,
} from '../mutation-error-toast';

jest.mock('sonner', () => ({
  toast: { error: jest.fn(), dismiss: jest.fn() },
}));

const toastError = toast.error as unknown as jest.Mock;
const toastDismiss = toast.dismiss as unknown as jest.Mock;

function makeClient() {
  return new QueryClient({
    mutationCache: buildMutationCache(),
    // Fail fast — no retry/backoff inside the test.
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  });
}

/** Run one mutation to rejection through the real client. */
async function runFailing(
  client: QueryClient,
  error: unknown,
  options: Record<string, unknown> = {},
) {
  const observerOptions = {
    mutationFn: async () => {
      throw error;
    },
    ...options,
  };
  await client
    .getMutationCache()
    .build(client, observerOptions as never)
    .execute(undefined as never)
    .catch(() => {
      /* the rejection is the point */
    });
}

beforeEach(() => {
  toastError.mockClear();
  toastDismiss.mockClear();
});

describe('global mutation-error toast', () => {
  it('fires ALONGSIDE the mutation\'s own onError (rollbacks stay intact)', async () => {
    const client = makeClient();
    const rollback = jest.fn();

    await runFailing(client, new Error('nope'), { onError: rollback });

    expect(rollback).toHaveBeenCalledTimes(1); // the optimistic rollback still ran
    expect(toastError).toHaveBeenCalledTimes(1); // …and the operator was told
  });

  it('shows plain English when the error carries nothing human-readable', async () => {
    const client = makeClient();
    await runFailing(client, new Error('API error: 500'));
    expect(toastError).toHaveBeenCalledWith(
      FALLBACK_ERROR_MESSAGE,
      expect.objectContaining({ duration: expect.any(Number) }),
    );
  });

  it("prefers the server's own sentence", async () => {
    const client = makeClient();
    const err: any = new Error('A screen with that name already exists.');
    err.status = 409;
    err.body = { message: 'A screen with that name already exists.' };
    await runFailing(client, err);
    expect(toastError).toHaveBeenCalledWith(
      'A screen with that name already exists.',
      expect.anything(),
    );
  });

  it('never leaks the raw API origin on a network failure', async () => {
    const client = makeClient();
    await runFailing(
      client,
      new Error("Can't reach the server at https://api.example.internal. The API may be restarting — please try again in a moment."),
    );
    expect(toastError).toHaveBeenCalledWith(OFFLINE_ERROR_MESSAGE, expect.anything());
  });

  it('stays silent for a surface that opts out', async () => {
    const client = makeClient();
    const inlineHandler = jest.fn();

    await runFailing(client, new Error('boom'), {
      meta: { suppressGlobalError: true },
      onError: inlineHandler,
    });

    expect(inlineHandler).toHaveBeenCalledTimes(1); // surface still handles it
    expect(toastError).not.toHaveBeenCalled(); // but we don't double-report
  });

  it('collapses an outage burst into ONE toast instead of a stack', async () => {
    const client = makeClient();

    for (let i = 0; i < 6; i++) {
      await runFailing(client, new Error("Can't reach the server at https://api.example.internal. x"));
    }

    // EVERY call reuses one toast id, so sonner replaces in place and the
    // operator never gets a wall of near-identical failures.
    const ids = new Set(toastError.mock.calls.map((c) => c[1].id));
    expect(ids).toEqual(new Set([MUTATION_ERROR_TOAST_ID]));
    // …and once several land at once the wording switches to the summary.
    expect(toastError.mock.calls.at(-1)![0]).toBe(BURST_ERROR_MESSAGE);
  });

  it('never calls toast.dismiss (a no-op in sonner 2.0.8 — verified in-browser)', async () => {
    const client = makeClient();
    for (let i = 0; i < 6; i++) await runFailing(client, new Error('boom'));
    expect(toastDismiss).not.toHaveBeenCalled();
  });

  it('keeps burst state per-client (no leakage between roots)', async () => {
    const a = makeClient();
    for (let i = 0; i < 5; i++) await runFailing(a, new Error('boom'));
    toastError.mockClear();

    const b = makeClient();
    await runFailing(b, new Error('boom'));
    // A fresh client starts clean: the first failure is its OWN toast.
    expect(toastError).toHaveBeenCalledTimes(1);
    expect(toastError.mock.calls[0][0]).toBe(FALLBACK_ERROR_MESSAGE);
  });
});
