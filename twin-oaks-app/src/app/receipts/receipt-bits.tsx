import { ReceiptIcon } from "@/components/Icons";

export function receiptStatusTone(status: string): string {
  switch (status) {
    case "CATEGORIZED":
      return "green";
    case "INBOX":
      return "amber";
    case "NEEDS_REVIEW":
    case "TAX_UNCERTAIN":
      return "red";
    case "SPLIT_PERSONAL":
      return "blue";
    default:
      return "stone";
  }
}

export function ReceiptThumb({
  filePath,
  mimeType,
  size = "h-14 w-14",
}: {
  filePath: string | null;
  mimeType: string | null;
  size?: string;
}) {
  if (filePath && mimeType?.startsWith("image/")) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={`/api/files/${filePath}`}
        alt="Receipt"
        className={`${size} shrink-0 rounded-xl border border-stone-200 object-cover`}
      />
    );
  }
  return (
    <div
      className={`${size} flex shrink-0 items-center justify-center rounded-xl border border-stone-200 bg-stone-50 text-stone-400`}
    >
      <ReceiptIcon className="h-6 w-6" />
    </div>
  );
}
