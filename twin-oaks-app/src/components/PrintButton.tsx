"use client";

import { btnPrimaryCls } from "@/components/ui";

export default function PrintButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className={`${btnPrimaryCls} print:hidden`}
    >
      Print / Save PDF
    </button>
  );
}
