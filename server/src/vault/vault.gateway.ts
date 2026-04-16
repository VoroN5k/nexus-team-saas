import { Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import { ConnectedSocket, MessageBody, OnGatewayConnection, OnGatewayDisconnect, SubscribeMessage, WebSocketGateway, WebSocketServer, WsException } from "@nestjs/websockets";
import { Server, Socket } from "socket.io";
import { QuorumReachedPayload } from "./vault.service";

interface AuthenticatedSocket extends Socket {
    userId: string;
    workspaceIds: string[];
}

export const VAULT_EVENTS = {
    // Client → Server
  SUBSCRIBE:        'vault:subscribe',     // join a workspace vault room
  UNSUBSCRIBE:      'vault:unsubscribe',
 
  // Server → Client
  ACCESS_REQUESTED: 'vault:access_requested', // broadcast to all holders
  SHARE_SUBMITTED:  'vault:share_submitted',   // update progress counter
  QUORUM_REACHED:   'vault:quorum_reached',    // send shares to requester ONLY
  REQUEST_EXPIRED:  'vault:request_expired',
  REQUEST_DENIED:   'vault:request_denied',
  ERROR:            'vault:error',
} as const;

// GATEWAY
@WebSocketGateway({
  namespace:   '/vault',
  cors: {
    origin:      process.env.ALLOWED_ORIGINS?.split(',').map(o => o.trim())
                 ?? ['http://localhost:3000'],
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
      const token = this.extractToken(client);
      const secret = this.config.getOrThrow<string>('JWT_SECRET');
 
      const payload = this.jwt.verify<{ sub: string }>(token, { secret });
 
      // Attach identity to socket for use in handlers
      (client as AuthenticatedSocket).userId       = payload.sub;
      (client as AuthenticatedSocket).workspaceIds = [];
 
      // Each user joins their own private room so quorum payloads
      // can be targeted to them alone (not broadcast to the workspace)
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

  // Subscription 
 
  /**
   * Client joins the real-time room for a specific workspace vault channel.
   * The server emits vault events only to members of the relevant workspace room.
   *
   * Payload: { workspaceId: string }
   */
  @SubscribeMessage(VAULT_EVENTS.SUBSCRIBE)
  handleSubscribe(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() payload: { workspaceId: string },
  ) {
    const { workspaceId } = payload;
 
    if (!workspaceId) {
      throw new WsException('workspaceId is required');
    }
 
    const room = this.workspaceRoom(workspaceId);
    client.join(room);
    client.workspaceIds.push(workspaceId);
 
    this.logger.log(
      `userId=${client.userId} joined vault room for workspace=${workspaceId}`,
    );
 
    return { event: VAULT_EVENTS.SUBSCRIBE, data: { workspaceId, joined: true } };
  }
 
  @SubscribeMessage(VAULT_EVENTS.UNSUBSCRIBE)
  handleUnsubscribe(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() payload: { workspaceId: string },
  ) {
    const room = this.workspaceRoom(payload.workspaceId);
    client.leave(room);
    return { event: VAULT_EVENTS.UNSUBSCRIBE, data: { left: true } };
  }
 
  // Server-Side Emitters (called by VaultService via VaultController) ──
 
  /**
   * Broadcast to ALL members of the workspace vault room that an access
   * request has been created. Clients check if they're a holder and, if so,
   * display a notification prompting them to submit their share.
   */
  notifyAccessRequested(payload: {
    workspaceId:    string;
    accessRequestId: string;
    vaultId:        string;
    vaultName:      string;
    requesterId:    string;
    requesterName:  string;
    reason?:        string;
    holderIds:      string[];
    expiresAt:      Date;
    threshold:      number;
    totalShares:    number;
  }) {
    const room = this.workspaceRoom(payload.workspaceId);
 
    this.server.to(room).emit(VAULT_EVENTS.ACCESS_REQUESTED, {
      ...payload,
      expiresAt: payload.expiresAt.toISOString(),
    });
 
    this.logger.log(
      `Emitted ${VAULT_EVENTS.ACCESS_REQUESTED} to workspace=${payload.workspaceId} ` +
      `vault=${payload.vaultId} requestId=${payload.accessRequestId}`,
    );
  }
 
  /**
   * Broadcast progress update to the workspace room.
   * Everyone can see how many shares have been collected vs. threshold.
   */
  notifyShareSubmitted(payload: {
    workspaceId:     string;
    accessRequestId: string;
    vaultId:         string;
    submittedByName: string;
    submittedCount:  number;
    threshold:       number;
  }) {
    const room = this.workspaceRoom(payload.workspaceId);
    this.server.to(room).emit(VAULT_EVENTS.SHARE_SUBMITTED, payload);
  }
 
  /**
   * Send the reconstructed shares ONLY to the specific requester socket(s).
   * This uses `to(userRoom)` — a private room per user — not the workspace broadcast.
   *
   * The client performs Lagrange interpolation locally to reconstruct the secret.
   * The server never sees or stores the reconstructed value.
   *
   * After this emit, the service has already purged ShareSubmission rows.
   */
  notifyQuorumReached(payload: QuorumReachedPayload & { workspaceId: string }) {
    // Broadcast progress to workspace (status change only — no share data)
    const workspaceRoom = this.workspaceRoom(payload.workspaceId);
    this.server.to(workspaceRoom).emit(VAULT_EVENTS.SHARE_SUBMITTED, {
      workspaceId:     payload.workspaceId,
      accessRequestId: payload.accessRequestId,
      vaultId:         payload.vaultId,
      quorumReached:   true,
    });
 
    // Send actual shares to requester's private room only
    const requesterRoom = this.userRoom(payload.requesterId);
    this.server.to(requesterRoom).emit(VAULT_EVENTS.QUORUM_REACHED, {
      accessRequestId: payload.accessRequestId,
      vaultId:         payload.vaultId,
      shares:          payload.shares, // array of { holderId, share }
    });
 
    this.logger.log(
      `Quorum reached for request=${payload.accessRequestId}. ` +
      `${payload.shares.length} shares forwarded to userId=${payload.requesterId}`,
    );
  }
 
  notifyRequestExpired(workspaceId: string, accessRequestId: string, vaultId: string) {
    const room = this.workspaceRoom(workspaceId);
    this.server.to(room).emit(VAULT_EVENTS.REQUEST_EXPIRED, { accessRequestId, vaultId });
  }
 
  notifyRequestDenied(workspaceId: string, accessRequestId: string, vaultId: string) {
    const room = this.workspaceRoom(workspaceId);
    this.server.to(room).emit(VAULT_EVENTS.REQUEST_DENIED, { accessRequestId, vaultId });
  }
 
  // Private Room Helpers 
 
  /**
   * Join users to their private room on connection so we can target them
   * individually for the quorum payload.
   *
   * Call this after authentication succeeds in handleConnection.
   */
  async joinUserPrivateRoom(client: Socket, userId: string): Promise<void> {
    await client.join(this.userRoom(userId));
  }
 
  private workspaceRoom(workspaceId: string): string {
    return `workspace:${workspaceId}:vault`;
  }
 
  private userRoom(userId: string): string {
    return `user:${userId}:vault`;
  }
 
  // Token Extraction
 
  private extractToken(client: Socket): string {
    // Support both Authorization header and handshake auth object
    const authHeader = client.handshake.headers['authorization'] as string | undefined;
    if (authHeader?.startsWith('Bearer ')) {
      return authHeader.slice(7);
    }
 
    const authObj = client.handshake.auth as Record<string, unknown>;
    if (typeof authObj?.token === 'string') {
      return authObj.token;
    }
 
    throw new WsException('Missing authentication token');
  }

}
