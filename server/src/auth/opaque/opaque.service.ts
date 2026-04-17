import { Injectable, Logger, OnModuleInit } from '@nestjs/common';

/**
 * OpaqueService — wraps the @serenity-kit/opaque server API.
 *
 * Security properties:
 * - The server NEVER sees the user's password (zero-knowledge)
 * - `serverSetup` is the long-lived server keypair; must be persisted in OPAQUE_SERVER_SETUP env
 * - `registrationRecord` is an opaque envelope stored per-user (reveals nothing about the password)
 * - `exportKey` is derived purely client-side and is NOT accessible to the server
 * - Login state (serverLoginState) is held in-memory for ≤5 min, keyed by a random nonce
 */

interface PendingLogin {
  serverLoginState: string;
  expiresAt: number;
}

type OpaqueModule = typeof import('@serenity-kit/opaque');

@Injectable()
export class OpaqueService implements OnModuleInit {

}