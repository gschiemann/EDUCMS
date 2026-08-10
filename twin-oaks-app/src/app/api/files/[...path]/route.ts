import { readUpload } from "@/lib/storage";

const CONTENT_TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".heic": "image/heic",
  ".heif": "image/heif",
  ".pdf": "application/pdf",
};

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const { path } = await params;
  // Storage keys are single flat UUID filenames — anything deeper is invalid.
  const key = path.length === 1 ? path[0] : "";
  const buf = key ? await readUpload(key) : null;
  if (!buf) return new Response("Not found", { status: 404 });

  const ext = key.slice(key.lastIndexOf(".")).toLowerCase();
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": CONTENT_TYPES[ext] ?? "application/octet-stream",
      "Cache-Control": "private, max-age=31536000, immutable",
    },
  });
}
