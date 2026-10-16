import { readNativeVideoDescriptor, type NativeVideoDescriptor } from './nativeSharedVideo';

/** Select native only for the bytes being committed, never a pending replacement. */
export function committedNativeVideo(
  raw: unknown,
  items: Array<{ asset?: { id?: string | null; fileHash?: string | null; fileUrl?: string | null } | null }>,
  emergency: boolean,
): NativeVideoDescriptor | null {
  if (emergency || !items.length) return null;
  const descriptor = readNativeVideoDescriptor(raw);
  if (!descriptor || !items.every(({ asset }) => asset?.id === descriptor.asset.id &&
      asset.fileHash === descriptor.asset.sha256 && asset.fileUrl === descriptor.asset.url)) return null;
  return descriptor;
}
