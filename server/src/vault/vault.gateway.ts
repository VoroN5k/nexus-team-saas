import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import {
  ConnectedSocket, MessageBody, OnGatewayConnection, OnGatewayDisconnect,
  SubscribeMessage, WebSocketGateway, WebSocketServer, WsException,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { QuorumReachedPayload, RotationQuorumPayload } from './vault.service';

interface AuthenticatedSocket extends Socket {
  userId: string;
  workspaceIds: string[];
}

export const VAULT_EVENTS = {
  // Client → Server
  SUBSCRIBE:   'vault:subscribe',
  UNSUBSCRIBE: 'vault:unsubscribe',

  // Server → Client (access flow)
  ACCESS_REQUESTED: 'vault:access_requested',
  SHARE_SUBMITTED:  'vault:share_submitted',
  QUORUM_REACHED:   'vault:quorum_reached',
  REQUEST_EXPIRED:  'vault:request_expired',
  REQUEST_DENIED:   'vault:request_denied',

  // Server → Client (rotation flow)
  ROTATION_REQUESTED:      'vault:rotation_requested',
  ROTATION_SHARE_SUBMITTED:'vault:rotation_share_submitted',
  ROTATION_QUORUM_REACHED: 'vault:rotation_quorum_reached',
  ROTATION_FINALIZED:      'vault:rotation_finalized',
  ROTATION_DENIED:         'vault:rotation_denied',

  ERROR: 'vault:error',
} as const;

@WebSocketGateway({
  namespace: '/vault',
  cors: {
    origin:      process.env.ALLOWED_ORIGINS?.split(',').map(o => o.trim()) ?? ['http://localhost:3000'],
    credentials: true,
  },
})
export class VaultGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  private readonly server!: Server;

  private readonly logger = new Logger(VaultGateway.name);

  constructor(
    private readonly jwt:    JwtService,
    private readonly config: ConfigService,
  ) {}

  async handleConnection(client: Socket): Promise<void> {
    try {
      const token  = this.extractToken(client);
      const secret = this.config.getOrThrow<string>('JWT_SECRET');
      const payload = this.jwt.verify<{ sub: string }>(token, { secret });

      (client as AuthenticatedSocket).userId       = payload.sub;
      (client as AuthenticatedSocket).workspaceIds = [];

      await client.join(this.userRoom(payload.sub));
      this.logger.log(`Socket connected: userId=${payload.sub} socketId=${client.id}`);
    } catch {
      this.logger.warn(`Rejected unauthenticated socket: ${client.id}`);
      client.emit(VAULT_EVENTS.ERROR, { message: 'Unauthorized — provide a valid Bearer token' });
      client.disconnect();
    }
  }

  handleDisconnect(client: Socket): void {
    const userId = (client as AuthenticatedSocket).userId;
    this.logger.log(`Socket disconnected: userId=${userId ?? 'unknown'} socketId=${client.id}`);
  }

  @SubscribeMessage(VAULT_EVENTS.SUBSCRIBE)
  handleSubscribe(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() payload: { workspaceId: string },
  ) {
    const { workspaceId } = payload;
    if (!workspaceId) throw new WsException('workspaceId is required');

    client.join(this.workspaceRoom(workspaceId));
    client.workspaceIds.push(workspaceId);
    this.logger.log(`userId=${client.userId} joined vault room for workspace=${workspaceId}`);

    return { event: VAULT_EVENTS.SUBSCRIBE, data: { workspaceId, joined: true } };
  }

  @SubscribeMessage(VAULT_EVENTS.UNSUBSCRIBE)
  handleUnsubscribe(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() payload: { workspaceId: string },
  ) {
    client.leave(this.workspaceRoom(payload.workspaceId));
    return { event: VAULT_EVENTS.UNSUBSCRIBE, data: { left: true } };
  }

  // Access flow emitters

  notifyAccessRequested(payload: {
    workspaceId: string; accessRequestId: string; vaultId: string; vaultName: string;
    requesterId: string; requesterName: string; reason?: string; holderIds: string[];
    expiresAt: Date; threshold: number; totalShares: number;
  }) {
    this.server.to(this.workspaceRoom(payload.workspaceId)).emit(VAULT_EVENTS.ACCESS_REQUESTED, {
      ...payload, expiresAt: payload.expiresAt.toISOString(),
    });
  }

  notifyShareSubmitted(payload: {
    workspaceId: string; accessRequestId: string; vaultId: string;
    submittedByName: string; submittedCount: number; threshold: number;
  }) {
    this.server.to(this.workspaceRoom(payload.workspaceId)).emit(VAULT_EVENTS.SHARE_SUBMITTED, payload);
  }

  notifyQuorumReached(payload: QuorumReachedPayload & { workspaceId: string }) {
    // Broadcast status-only to workspace
    this.server.to(this.workspaceRoom(payload.workspaceId)).emit(VAULT_EVENTS.SHARE_SUBMITTED, {
      workspaceId:     payload.workspaceId,
      accessRequestId: payload.accessRequestId,
      vaultId:         payload.vaultId,
      quorumReached:   true,
    });

    // Shares go only to the requester's private room
    this.server.to(this.userRoom(payload.requesterId)).emit(VAULT_EVENTS.QUORUM_REACHED, {
      accessRequestId: payload.accessRequestId,
      vaultId:         payload.vaultId,
      shares:          payload.shares,
    });

    this.logger.log(
      `Quorum reached for request=${payload.accessRequestId}, ` +
      `${payload.shares.length} shares → userId=${payload.requesterId}`,
    );
  }

  notifyRequestExpired(workspaceId: string, accessRequestId: string, vaultId: string) {
    this.server.to(this.workspaceRoom(workspaceId)).emit(VAULT_EVENTS.REQUEST_EXPIRED, { accessRequestId, vaultId });
  }

  notifyRequestDenied(workspaceId: string, accessRequestId: string, vaultId: string) {
    this.server.to(this.workspaceRoom(workspaceId)).emit(VAULT_EVENTS.REQUEST_DENIED, { accessRequestId, vaultId });
  }

  // Rotation flow emitters

  /**
   * Broadcast to all workspace members: someone needs their share re-encrypted.
   * Holders check if they're on the list and see the "Submit share for rotation" button.
   */
  notifyRotationRequested(payload: {
    workspaceId: string; rotationRequestId: string; vaultId: string; vaultName: string;
    requesterId: string; requesterName: string; holderIds: string[];
    expiresAt: Date; threshold: number;
  }) {
    this.server.to(this.workspaceRoom(payload.workspaceId)).emit(VAULT_EVENTS.ROTATION_REQUESTED, {
      ...payload, expiresAt: payload.expiresAt.toISOString(),
    });
    this.logger.log(
      `Rotation requested: vaultId=${payload.vaultId} requestId=${payload.rotationRequestId} ` +
      `requester=${payload.requesterId}`,
    );
  }

  notifyRotationShareSubmitted(payload: {
    workspaceId: string; rotationRequestId: string; vaultId: string;
    submittedCount: number; threshold: number;
  }) {
    this.server.to(this.workspaceRoom(payload.workspaceId))
      .emit(VAULT_EVENTS.ROTATION_SHARE_SUBMITTED, payload);
  }

  /**
   * Send the plaintext shares ONLY to the requester's private room.
   * They will reconstruct the secret, re-split, and call POST /finalize.
   */
  notifyRotationQuorumReached(payload: RotationQuorumPayload & { workspaceId: string }) {
    // Status-only to workspace
    this.server.to(this.workspaceRoom(payload.workspaceId)).emit(VAULT_EVENTS.ROTATION_SHARE_SUBMITTED, {
      workspaceId:       payload.workspaceId,
      rotationRequestId: payload.rotationRequestId,
      vaultId:           payload.vaultId,
      quorumReached:     true,
    });

    // Full payload to requester only
    this.server.to(this.userRoom(payload.requesterId)).emit(VAULT_EVENTS.ROTATION_QUORUM_REACHED, {
      rotationRequestId: payload.rotationRequestId,
      vaultId:           payload.vaultId,
      shares:            payload.shares,
      holderPublicKeys:  payload.holderPublicKeys,
      threshold:         payload.threshold,
      totalShares:       payload.totalShares,
    });

    this.logger.log(
      `Rotation quorum reached for request=${payload.rotationRequestId}, ` +
      `${payload.shares.length} shares → userId=${payload.requesterId}`,
    );
  }

  notifyRotationFinalized(workspaceId: string, vaultId: string, requesterId: string) {
    this.server.to(this.workspaceRoom(workspaceId)).emit(VAULT_EVENTS.ROTATION_FINALIZED, {
      vaultId, requesterId,
    });
  }

  notifyRotationDenied(workspaceId: string, rotationRequestId: string, vaultId: string) {
    this.server.to(this.workspaceRoom(workspaceId)).emit(VAULT_EVENTS.ROTATION_DENIED, {
      rotationRequestId, vaultId,
    });
  }

  // Private helpers

  private workspaceRoom(workspaceId: string): string { return `workspace:${workspaceId}:vault`; }
  private userRoom(userId: string):           string { return `user:${userId}:vault`; }

  private extractToken(client: Socket): string {
    const authHeader = client.handshake.headers['authorization'] as string | undefined;
    if (authHeader?.startsWith('Bearer ')) return authHeader.slice(7);

    const authObj = client.handshake.auth as Record<string, unknown>;
    if (typeof authObj?.token === 'string') return authObj.token;

    throw new WsException('Missing authentication token');
  }
}