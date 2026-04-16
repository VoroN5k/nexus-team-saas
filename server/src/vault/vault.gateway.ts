import { Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import { OnGatewayConnection, OnGatewayDisconnect, WebSocketGateway, WebSocketServer } from "@nestjs/websockets";
import { Server, Socket } from "socket.io";

interface AuthenticatedSocket extends Socket {
    userId: string;
    workspaceId: string[];
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

  
  
}
