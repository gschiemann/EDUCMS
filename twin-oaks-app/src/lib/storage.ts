// File storage abstraction. Dev: local disk under UPLOAD_DIR.
// Production follow-up: swap the internals for object storage (e.g. Supabase
// Storage) without touching callers — the app only deals in storage keys.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

const UPLOAD_DIR = process.env.UPLOAD_DIR || "var/uploads";

function uploadRoot(): string {
  return path.resolve(process.cwd(), UPLOAD_DIR);
}

const EXT_BY_MIME: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/heic": ".heic",
  "image/heif": ".heif",
  "image/webp": ".webp",
  "application/pdf": ".pdf",
};

export async function saveUpload(file: File): Promise<{
  storageKey: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
}> {
  const bytes = Buffer.from(await file.arrayBuffer());
  const ext =
    EXT_BY_MIME[file.type] ?? path.extname(file.name).slice(0, 10) ?? "";
  const storageKey = `${crypto.randomUUID()}${ext}`;
  await mkdir(uploadRoot(), { recursive: true });
  await writeFile(path.join(uploadRoot(), storageKey), bytes);
  return {
    storageKey,
    fileName: file.name || storageKey,
    mimeType: file.type || "application/octet-stream",
    fileSize: bytes.byteLength,
  };
}

// Storage keys are server-generated UUID filenames; reject anything else so
// the file-serving route can never traverse outside the upload dir.
export function isSafeStorageKey(key: string): boolean {
  return /^[A-Za-z0-9-]+(\.[A-Za-z0-9]{1,10})?$/.test(key);
}

export async function readUpload(storageKey: string): Promise<Buffer | null> {
  if (!isSafeStorageKey(storageKey)) return null;
  try {
    return await readFile(path.join(uploadRoot(), storageKey));
  } catch {
    return null;
  }
}
