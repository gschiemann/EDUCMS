# Shared Types & Monorepo Plan

To physically synchronize the APIs, WebSockets, Frontend, and Backend layers, all TypeScript logic must draw from a single, strongly-typed source of truth package within the monorepo architecture. 

## 1. Monorepo Package Architecture (Turborepo)
```
/packages
   /api-types       (Interfaces for Request/Response payloads based on OpenAPI)
   /ws-events       (Typings for Realtime specs based on WEBSOCKET_CONTRACTS.md)
   /auth-core       (RBAC Enum logic mapping to RBAC_MATRIX.md)
```

## 2. API Types Strategy (`/packages/api-types`)
Using automated OpenAPI-to-TypeScript generators, generate strict interfaces defining:
*   **Asset Lifecycle Models:** `AssetStatus` (e.g. `PENDING`, `READY`, `INVALID`)
*   **Manifest Models:** `ManifestResponse`, `PlaylistDefinition`, `ScheduleWindow`
*   **Emergency Payloads:** Form inputs mapping exactly to the Override capabilities.

If OpenAPI generates a `ManifestResponse`, both the Next.js Frontend and the Node.js API utilize exactly this object.

## 3. WebSocket Event Registry (`/packages/ws-events`)
Define discriminated unions based on the WebSocket JSON Contracts:

```typescript
// Shared across Node Server & potential Frontend Dashboard previews
export enum WsEventType {
  HELLO = "HELLO",
  AUTH_OK = "AUTH_OK",
  AUTH_FAIL = "AUTH_FAIL",
  HEARTBEAT = "HEARTBEAT",
  PUBLISH_AVAILABLE = "PUBLISH_AVAILABLE",
  OVERRIDE = "OVERRIDE",
  ALL_CLEAR = "ALL_CLEAR",
  ACK = "ACK",
  STATE_RESYNC_REQUIRED = "STATE_RESYNC_REQUIRED",
  DEVICE_REVOKED = "DEVICE_REVOKED",
  PURGE_CACHE = "PURGE_CACHE", // Assuming GAP_REPORT dictates this addition
}

export interface BaseSocketMessage {
  type: WsEventType;
  idempotencyKey: string;
  timestamp: number;
}

export interface OverrideEvent extends BaseSocketMessage {
  type: WsEventType.OVERRIDE;
  payload: {
    overrideId: string;
    severity: "CRITICAL" | "WEATHER" | "INFO";
    mediaUrl?: string; // Optional depending on strict UI
    textBlob: string;
    expiresAt: number;
  }
}
// Further typings omitted.
```

## 4. Android Kotlin Equivalents
While the web stack utilizes the TS Monorepo, the Kotlin environment (Android spec) cannot inherently consume TS interfaces.

**Solution:** Use **JSON Schema** or **Protobuf** as a bridge, or run a CI automation tool at the root of the Monorepo (like `quicktype`) that monitors `/packages/ws-events` and `/packages/api-types` to automatically output synchronized Kotlin Data Classes upon commits to the `main` branch. This enforces that the Android `ANDROID_SPEC.md` player parses events exactly identical to what Node generates.

## 5. Security & RBAC Enforcement 
All RBAC levels defined in `RBAC_MATRIX.md` will become a static TS enum linked to the `@school-cms/auth-core` package. Backend middleware and Frontend route guards will import strictly from this package to prevent mistyping `"Super Admin"` as `"SuperAdmin"`.
