import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';

/**
 * WSSP: WebSocket Signing Protocol utility functions.
 * Mitigates Replay Attacks and Event Forgery (Release Blocker RT-01).
 */

export interface WsMessagePayload {
  eventId: string;
  timestamp: number;
  type: string;
  payload: any;
  signature?: string;
}

export class WebSocketSigner {
  private deviceSecret: string;

  constructor(deviceSecret: string) {
    if (!deviceSecret) throw new Error("DeviceSecret is required for WSSP");
    this.deviceSecret = deviceSecret;
  }

  /**
   * Generates a fully signed WSSP envelope.
   */
  public signMessage(type: string, payload: any): WsMessagePayload {
    const eventId = uuidv4();
    const timestamp = Date.now();
    
    // Construct the canonical string: `${eventId}:${timestamp}:${type}:${payload}`
    const canonicalString = `${eventId}:${timestamp}:${type}:${JSON.stringify(payload)}`;
    
    // Generate HMAC SHA-256
    const signature = crypto
      .createHmac('sha256', this.deviceSecret)
      .update(canonicalString)
      .digest('hex');

    return {
      eventId,
      timestamp,
      type,
      payload,
      signature
    };
  }

  /**
   * Utility to verify a message on the backend / receiver side if needed.
   * On device side, this will be replicated in Kotlin.
   */
  public verifyMessage(message: WsMessagePayload): boolean {
    if (!message.signature) return false;
    
    // Verify timestamp (10 seconds tolerance)
    const now = Date.now();
    if (now - message.timestamp > 10000) {
      console.warn("WSSP Verification Failed: Stale message (Replay Attack?)");
      return false;
    }

    // Verify signature
    const canonicalString = `${message.eventId}:${message.timestamp}:${message.type}:${JSON.stringify(message.payload)}`;
    const expectedSignature = crypto
      .createHmac('sha256', this.deviceSecret)
      .update(canonicalString)
      .digest('hex');

    return crypto.timingSafeEqual(
      Buffer.from(expectedSignature),
      Buffer.from(message.signature)
    );
  }
}
