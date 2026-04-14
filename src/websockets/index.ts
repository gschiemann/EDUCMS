import { Server, Socket } from 'socket.io';
import { Server as HttpServer } from 'http';
import { v4 as uuidv4 } from 'uuid';
import redisClient from '../db/redis';

// Types mapping explicitly to WEBSOCKET_CONTRACTS.md
interface HelloPayload {
  token: string;
  stateHash: string;
  activeOverrideId: string | null;
  sdkVersion: string;
}

export function initializeWebSockets(httpServer: HttpServer): Server {
  const io = new Server(httpServer, {
    cors: {
      origin: '*', // Device network boundaries handled via WAF/TLS
      methods: ['GET', 'POST']
    }
  });

  io.on('connection', (socket: Socket) => {
    console.log(`[WSS] Connection established. Socket ID: ${socket.id}`);

    // Require HELLO packet within 5 seconds or disconnect
    const helloTimeout = setTimeout(() => {
      console.warn(`[WSS] Disconnecting ${socket.id}: HELLO timeout`);
      socket.disconnect(true);
    }, 5000);

    socket.on('HELLO', async (payload: HelloPayload, ackCallback) => {
      clearTimeout(helloTimeout);
      
      try {
        // Validate payload (Mock auth according to requirements)
        if (!payload.token || !payload.token.startsWith('eyJ')) {
          socket.emit('AUTH_FAIL', { code: 401, reason: 'INVALID_TOKEN' });
          return socket.disconnect(true);
        }

        // Simulating decoding token to get device UUID. 
        // Real implementation hooks into JSON Web Key verification
        const deviceId = 'device-' + payload.token.substring(0, 8); 

        // Join room specific to this device for targeted emergency overrides
        socket.join(`device_${deviceId}`);
        
        // Also join a generic "all_devices" fanout room
        socket.join('all_devices');

        // Store active session in Redis for cross-node tracking
        await redisClient.setEx(`wss_session:${deviceId}`, 300, socket.id);

        console.log(`[WSS] Authenticated device ${deviceId}`);
        
        // Return required AUTH_OK schema
        socket.emit('AUTH_OK', {
          deviceId,
          expiresAt: Math.floor(Date.now() / 1000) + 3600
        });

      } catch (error) {
        socket.emit('AUTH_FAIL', { code: 500, reason: 'INTERNAL_ERROR' });
        socket.disconnect(true);
      }
    });

    socket.on('HEARTBEAT', async (payload) => {
       // Typically aggregate metrics here. 
       // For now, extend the redis session TTL
       // Note: To match production architecture exactly, we'd lookup deviceId by socket id
       // but omitted for simplicity
    });

    socket.on('ACK', (payload) => {
      console.log(`[WSS] Received client ACK for event: ${payload.receivedEventId} with status: ${payload.status}`);
      // Audit log the compliance
    });

    socket.on('disconnect', () => {
      console.log(`[WSS] Socket disconnected: ${socket.id}`);
    });
  });

  return io;
}

/**
 * Triggers a completely out-of-band standard REST Override to all connected sockets
 */
export async function fanoutEmergencyOverride(io: Server, payload: any) {
    const overrideId = payload.overrideId || uuidv4();
    io.to('all_devices').emit('OVERRIDE', {
      overrideId,
      severity: payload.severity || 'CRITICAL',
      mediaUrl: payload.mediaUrl,
      textBlob: payload.textBlob,
      expiresAt: Math.floor(Date.now() / 1000) + 3600
    });
    
    // Log to audit table
    console.log(`[WSS] Triggered Critical OVERRIDE fanout: ${overrideId}`);
}
