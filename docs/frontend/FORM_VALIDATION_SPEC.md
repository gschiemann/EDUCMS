# Form Validation & Sanitization Spec

Robust client-side validation paired with server-side parity is critical for system integrity and contributor safety.

## Validation Mirroring Server Sanitization
Zod schemas constructed on the frontend must perfectly represent the backend DTO logic.
- Enforce strict typing, string length boundaries, and array size limitations at the browser level prior to API transmission.

## Announcement Text Sanitization
Non-technical school staff will frequently copy-paste formatted text directly from Microsoft Word or similar rich-text editors into the announcement builder.
- **Preview Phase:** The frontend must process the raw HTML string using `DOMPurify` to strip XSS vectors before rendering a live preview.
- **Submit Phase:** The Zod schema explicitly intercepts the input string array. It transforms to restricted HTML tags or converts the unified content into a safe structured JSON (e.g., TipTap/ProseMirror format) before sending the payload—ensuring that what is submitted exactly models what the device rendering engine expects.

## The Asset Upload Flow
A robust, error-tolerant pipeline for media uploads:
1. **Selection:** User drops files; the frontend executes an initial Zod schema validation against `File.type` (MIME validation), resolution metadata, and maximum file size `File.size`.
2. **Presigned Setup:** Frontend dynamically requests a short-lived, secure S3 presigned POST URL from the backend.
3. **Progress Tracking:** The UI `<progress>` element handles Axios/XHR `onUploadProgress` events in real-time.
4. **Completion Synchronization:** Upon confirmed chunk success against S3, a secondary generic mutation signals the backend API to officially catalog the asset in the school's library.

## Schema Implementation Example

```typescript
import { z } from "zod";
import DOMPurify from "dompurify";

export const AnnouncementSchema = z.object({
  title: z.string().min(5, "Title must be at least 5 characters").max(100),
  bodyText: z.string()
    .max(5000, "Content exceeds character limit")
    .transform((htmlString) => DOMPurify.sanitize(htmlString)), // Immediate Frontend Sanitization
  priority: z.enum(["low", "normal", "high"]),
  expiresAt: z.date().min(new Date(), "Schedule expiration must exist in the future"),
});

export type AnnouncementFormValues = z.infer<typeof AnnouncementSchema>;
```
