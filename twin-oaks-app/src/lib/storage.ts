// File storage abstraction — callers only deal in storage keys/URLs.
//
// Two backends, auto-selected:
//   - Vercel Blob when BLOB_READ_WRITE_TOKEN is set (production on Vercel).
//     saveUpload returns the blob's full https URL as the storage key.
//     Blob URLs are unguessable-random; true private object storage is a
//     planned upgrade (docs/ROADMAP.md).
//   - Local disk under UPLOAD_DIR otherwise (dev). saveUpload returns a flat
//     UUID filename served by /api/files/[key] (behind the login gate).

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
  const mimeType = file.type || "application/octet-stream";
  const fileName = file.name || "upload";
  const generatedName = `${crypto.randomUUID()}${ext}`;

  if (process.env.BLOB_READ_WRITE_TOKEN) {
    const { put } = await import("@vercel/blob");
    const blob = await put(`receipts/${generatedName}`, bytes, {
      access: "public",
      contentType: mimeType,
    });
    return { storageKey: blob.url, fileName, mimeType, fileSize: bytes.byteLength };
  }

  await mkdir(uploadRoot(), { recursive: true });
  await writeFile(path.join(uploadRoot(), generatedName), bytes);
  return { storageKey: generatedName, fileName, mimeType, fileSize: bytes.byteLength };
}

// Resolve a stored key to something an <img src> / link can use.
export function fileSrc(storageKey: string): string {
  return storageKey.startsWith("http") ? storageKey : `/api/files/${storageKey}`;
}

// Local-disk keys are single flat server-generated filenames; reject anything
// else so the file-serving route can never traverse outside the upload dir.
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
