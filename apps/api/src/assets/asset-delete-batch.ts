import { HttpException, HttpStatus } from '@nestjs/common';

export type AssetDeleteResult =
  | { id: string; deleted: true }
  | { id: string; deleted: false; code: string; message: string };

/** A process-wide limit for this controller, including concurrent batches. */
export class AssetDeleteBatch {
  private active = 0;
  private waiters: Array<() => void> = [];

  private async slot<T>(task: () => Promise<T>): Promise<T> {
    if (this.active >= 2)
      await new Promise<void>((resolve) => this.waiters.push(resolve));
    else this.active++;
    try {
      return await task();
    } finally {
      const next = this.waiters.shift();
      if (next) next();
      else this.active--;
    }
  }

  async run(
    ids: unknown,
    remove: (id: string) => Promise<unknown>,
  ): Promise<AssetDeleteResult[]> {
    if (
      !Array.isArray(ids) ||
      ids.length === 0 ||
      ids.length > 20 ||
      ids.some((id) => typeof id !== 'string' || !id.trim() || id.length > 160)
    ) {
      throw new HttpException(
        {
          code: 'INVALID_ASSET_SELECTION',
          message: 'Select between 1 and 20 files per batch.',
        },
        HttpStatus.BAD_REQUEST,
      );
    }
    const unique = [...new Set(ids as string[])];
    return Promise.all(
      unique.map((id) =>
        this.slot(async (): Promise<AssetDeleteResult> => {
          try {
            await remove(id);
            return { id, deleted: true };
          } catch (error) {
            if (error instanceof HttpException) {
              const body = error.getResponse();
              if (body && typeof body === 'object') {
                const response = body as { code?: unknown; message?: unknown };
                return {
                  id,
                  deleted: false,
                  code:
                    typeof response.code === 'string'
                      ? response.code
                      : 'ASSET_DELETE_FAILED',
                  message:
                    typeof response.message === 'string'
                      ? response.message
                      : 'The file was kept.',
                };
              }
            }
            return {
              id,
              deleted: false,
              code: 'ASSET_DELETE_FAILED',
              message: 'Could not delete this file. Refresh and try again.',
            };
          }
        }),
      ),
    );
  }
}

export function folderSubtreeIds(
  folders: Array<{ id: string; parentId: string | null }>,
  root: string,
): string[] {
  const ids = new Set([root]);
  for (let changed = true; changed; ) {
    changed = false;
    for (const folder of folders) {
      if (folder.parentId && ids.has(folder.parentId) && !ids.has(folder.id)) {
        ids.add(folder.id);
        changed = true;
      }
    }
  }
  return [...ids];
}
