/**
 * Persistence for the live AI model catalog (2026-09-22).
 *
 * The catalog itself is pure (ai-model-catalog.ts). This service is the only thing that reads or
 * writes its state row (`ai_catalog_state`, id 'singleton'):
 *
 *   * BOOT + every 5 minutes: load the row into the process-wide catalog, so every replica converges
 *     on what the leased sync or a super admin wrote without a restart.
 *   * LESSONS from live traffic (a model that rejected a parameter, a model the provider refused)
 *     are merged into the row, debounced, so the next boot and every other replica learn them too.
 *   * `update(mutator)` for the sync and Super Admin: read-modify-write with an optimistic version
 *     check, retried on a lost race — two writers can never silently erase each other.
 *
 * A missing table, a missing row or an unreadable document leaves the SEED catalog in charge —
 * which is a complete, verified lineup — and logs why. Nothing here can take AI down.
 */
import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { getCatalog, modelKey, onCatalogLesson, setCatalogState, type CatalogState } from './ai-model-catalog';

const ROW_ID = 'singleton';
const REFRESH_MS = 5 * 60_000;
const LESSON_FLUSH_MS = 5_000;

@Injectable()
export class AiCatalogStoreService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AiCatalogStoreService.name);
  private timer?: NodeJS.Timeout;
  private flushTimer?: NodeJS.Timeout;
  private unsubscribe?: () => void;
  private pending: Pick<CatalogState, 'learnedCaps' | 'failures'> = {};
  private loadedVersion = -1;

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit(): Promise<void> {
    this.unsubscribe = onCatalogLesson((lesson) => {
      const key = modelKey(lesson.provider, lesson.id);
      if (lesson.kind === 'capability') {
        this.pending.learnedCaps = {
          ...(this.pending.learnedCaps || {}),
          [key]: { ...(this.pending.learnedCaps?.[key] || {}), ...lesson.caps },
        };
      } else {
        this.pending.failures = {
          ...(this.pending.failures || {}),
          [key]: { at: new Date().toISOString(), error: lesson.error.slice(0, 300) },
        };
      }
      this.scheduleFlush();
    });
    if (process.env.NODE_ENV === 'test') return;
    await this.load();
    this.timer = setInterval(() => void this.load(), REFRESH_MS);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.unsubscribe?.();
  }

  /** Current persisted state (or {} when there is none). */
  async read(): Promise<{ state: CatalogState; version: number; updatedAt: Date | null }> {
    const row = (await this.prisma.client.aiCatalogState.findUnique({ where: { id: ROW_ID } })) as any;
    if (!row) return { state: {}, version: 0, updatedAt: null };
    const state = row.state && typeof row.state === 'object' ? (row.state as CatalogState) : {};
    return { state, version: Number(row.version) || 0, updatedAt: row.updatedAt ?? null };
  }

  /** Load the row into the process catalog. Never throws. */
  async load(): Promise<void> {
    try {
      const { state, version } = await this.read();
      if (version === this.loadedVersion) return;
      setCatalogState(state);
      this.loadedVersion = version;
      this.logger.log(`AI catalog loaded (version ${version}, ${getCatalog().list().length} models).`);
    } catch (e: any) {
      this.logger.warn(`AI catalog load failed — running on the seed lineup: ${e?.message}`);
    }
  }

  /**
   * Read-modify-write the state. The mutator gets a copy of the current document and returns the
   * next one. Optimistic: the write only lands if nobody else wrote since we read; on a lost race
   * the whole cycle re-runs against the fresh row (3 tries).
   */
  async update(mutator: (state: CatalogState) => CatalogState): Promise<CatalogState> {
    for (let attempt = 0; attempt < 3; attempt++) {
      const { state, version } = await this.read();
      const next = mutator(JSON.parse(JSON.stringify(state)) as CatalogState);
      if (version === 0) {
        try {
          await this.prisma.client.aiCatalogState.create({ data: { id: ROW_ID, state: next as any, version: 1 } });
          setCatalogState(next);
          this.loadedVersion = 1;
          return next;
        } catch {
          continue; // another writer created the row first — retry against it
        }
      }
      const res = await this.prisma.client.aiCatalogState.updateMany({
        where: { id: ROW_ID, version },
        data: { state: next as any, version: version + 1 },
      });
      if (res.count === 1) {
        setCatalogState(next);
        this.loadedVersion = version + 1;
        return next;
      }
    }
    throw new Error('AI catalog state changed underneath three consecutive writes — try again.');
  }

  private scheduleFlush(): void {
    if (process.env.NODE_ENV === 'test' || this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = undefined;
      void this.flushLessons();
    }, LESSON_FLUSH_MS);
    this.flushTimer.unref?.();
  }

  /** Merge pending lessons into the row. Exposed for the spec. */
  async flushLessons(): Promise<void> {
    const lessons = this.pending;
    this.pending = {};
    if (!lessons.learnedCaps && !lessons.failures) return;
    try {
      await this.update((s) => ({
        ...s,
        learnedCaps: { ...(s.learnedCaps || {}), ...(lessons.learnedCaps || {}) },
        failures: { ...(s.failures || {}), ...(lessons.failures || {}) },
      }));
    } catch (e: any) {
      this.logger.warn(`AI catalog lesson flush failed (kept in this process only): ${e?.message}`);
    }
  }
}
