"use server";

import { revalidatePath } from "next/cache";

interface UploadResult {
  url: string;
  assetId: string;
}

/**
 * Upload a file to the API using multipart form data.
 * In local mode this goes directly to the NestJS multer endpoint.
 * In production, swap this for presigned S3 URL flow.
 */
export async function uploadAsset(formData: FormData): Promise<UploadResult> {
  const API_URL = process.env.INTERNAL_API_URL || 'http://localhost:8080';

  const res = await fetch(`${API_URL}/api/v1/assets/upload`, {
    method: 'POST',
    body: formData,
    // Note: Don't set Content-Type header — fetch will auto-set multipart boundary
  });

  if (!res.ok) {
    throw new Error(`Upload failed: ${res.status}`);
  }

  const data = await res.json();
  
  revalidatePath('/assets');
  
  return data;
}

/**
 * Legacy presigned URL flow — kept for backward compatibility.
 */
export async function requestPresignedUrl(payload: {
  filename: string;
  contentType: string;
  size: number;
}): Promise<{ url: string; assetId: string }> {
  const API_URL = process.env.INTERNAL_API_URL || 'http://localhost:8080';

  const res = await fetch(`${API_URL}/api/v1/assets/presign`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    throw new Error(`Failed to get presigned URL: ${res.status}`);
  }

  revalidatePath('/assets');
  return res.json();
}
