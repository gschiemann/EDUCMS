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
  PURGE_CACHE = "PURGE_CACHE",
  // 2026-05-24 — operator can flip a kiosk between landscape /
  // portrait / auto from the dashboard without climbing a ladder.
  // Player APK calls setRequestedOrientation; CSS transform fallback
  // for stubborn ROMs that ignore the Android API.
  ORIENTATION_CHANGE = "ORIENTATION_CHANGE"
}

export interface BaseSocketMessage {
  type: WsEventType;
  idempotencyKey: string;
  timestamp: number;
}

export interface HelloEvent extends BaseSocketMessage {
  type: WsEventType.HELLO;
  payload: {
    token: string;
    stateHash: string;
    activeOverrideId: string | null;
    sdkVersion: string;
  };
}

export interface AuthOkEvent extends BaseSocketMessage {
  type: WsEventType.AUTH_OK;
  payload: {
    deviceId: string;
    expiresAt: number;
  };
}

export interface AuthFailEvent extends BaseSocketMessage {
  type: WsEventType.AUTH_FAIL;
  payload: {
    code: number;
    reason: string;
  };
}

export interface HeartbeatEvent extends BaseSocketMessage {
  type: WsEventType.HEARTBEAT;
  payload: {
    metrics: {
      cpu: number;
      mem: number;
      temp: number;
    }
  };
}

export interface PublishAvailableEvent extends BaseSocketMessage {
  type: WsEventType.PUBLISH_AVAILABLE;
  payload: {
    publishId: string;
    playlistVersion: number;
    critical: boolean;
  };
}

export interface OverrideEvent extends BaseSocketMessage {
  type: WsEventType.OVERRIDE;
  payload: {
    overrideId: string;
    severity: "CRITICAL" | "WEATHER" | "INFO";
    mediaUrl?: string;
    textBlob: string;
    expiresAt: number;
  };
}

export interface AllClearEvent extends BaseSocketMessage {
  type: WsEventType.ALL_CLEAR;
  payload: {
    overrideId: string;
    clearedBy: string;
  };
}

export interface PurgeCacheEvent extends BaseSocketMessage {
  type: WsEventType.PURGE_CACHE;
  payload: {
    purgeAll: boolean;
    assetIds: string[];
  };
}

export type ScreenOrientation = "LANDSCAPE" | "PORTRAIT" | "AUTO";

export interface OrientationChangeEvent extends BaseSocketMessage {
  type: WsEventType.ORIENTATION_CHANGE;
  payload: {
    /** Target orientation. Player APK maps this to
     *  ActivityInfo.SCREEN_ORIENTATION_{LANDSCAPE,PORTRAIT,UNSPECIFIED}.
     *  AUTO restores the device-sensor-decides behavior. */
    orientation: ScreenOrientation;
    /** Optional reason / actor (audit + player-side info card). */
    reason?: string;
  };
}

export type WebSocketMessage =
  | HelloEvent
  | AuthOkEvent
  | AuthFailEvent
  | HeartbeatEvent
  | PublishAvailableEvent
  | OverrideEvent
  | AllClearEvent
  | PurgeCacheEvent
  | OrientationChangeEvent;
