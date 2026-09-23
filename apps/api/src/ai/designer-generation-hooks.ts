/**
 * designer-generation-hooks.ts — the contract between the AI Designer's
 * generation and whoever runs it (2026-09-23).
 *
 * A generation is about to become a multi-minute pipeline (draw → render →
 * review → revise), and it is about to run inside a background job that shows
 * progress and can be cancelled. Both sides meet here, so the job runner and
 * the pipeline can be built in parallel and still agree:
 *
 *   - the PIPELINE calls `onProgress` at each stage boundary and checks
 *     `signal.aborted` between stages (never mid-request: an in-flight model
 *     call finishes or times out on its own budget);
 *   - the RUNNER supplies both and persists what it hears.
 *
 * Pure types + one helper. No Nest, no I/O.
 */

export type DesignerStage =
  | 'drawing'
  | 'binding'
  | 'rendering'
  | 'reviewing'
  | 'revising'
  | 'done';

export interface DesignerProgress {
  stage: DesignerStage;
  /** 1-based candidate this stage applies to; absent = the whole batch. */
  candidate?: number;
  /** How many candidates the batch is drawing. */
  of?: number;
  /** Optional operator-facing detail (already translated by the web; keep it short). */
  message?: string;
}

export interface DesignerGenerationHooks {
  onProgress?: (progress: DesignerProgress) => void;
  signal?: AbortSignal;
}

/** Thrown by the pipeline when the runner's signal is aborted between stages. */
export class DesignerGenerationCancelled extends Error {
  readonly code = 'AI_DESIGN_CANCELLED' as const;
  constructor() {
    super('The board generation was cancelled.');
    this.name = 'DesignerGenerationCancelled';
  }
}

/** Check the signal between stages; a no-op without one. */
export function throwIfCancelled(hooks?: DesignerGenerationHooks): void {
  if (hooks?.signal?.aborted) throw new DesignerGenerationCancelled();
}
