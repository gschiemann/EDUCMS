import { Injectable, Logger } from '@nestjs/common';
import * as crypto from 'crypto';

export interface WsMessagePayload {
  eventId: string;
  timestamp: number;
  type: string;
  payload: any;
  signature?: string;
}

@Injectable()
export class WebsocketSignerService {
  private readonly logger = new Logger(WebsocketSignerService.name);
  
  // In production, inject this from ConfigService
  private readonly deviceSecret = process.env.DEVICE_SECRET_KEY || 'default_secure_device_secret_123!';

  public signMessage(type: string, payload: any): WsMessagePayload {
    const eventId = crypto.randomUUID();
    const timestamp = Date.now();
    
    // Canonical string: `${eventId}:${timestamp}:${type}:${payload}`
    const canonicalString = `${eventId}:${timestamp}:${type}:${JSON.stringify(payload)}`;
    
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

  public verifyMessage(message: WsMessagePayload): boolean {
    if (!message.signature) return false;
    
    const now = Date.now();
    if (now - message.timestamp > 10000) {
      this.logger.warn(`Stale message detected from event ${message.eventId}`);
      return false;
    }

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
