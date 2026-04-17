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
  private readonly logger = new Logger(OpaqueService.name);
  private mod!: OpaqueModule;
  private serverSetup!: string;

  // Short-lived login sessions: nonce = serverLoginState
  // TTL 5 min - enough for any real client, but short enough to limit server memory
  private readonly pending = new Map<string, PendingLogin>();

  async onModuleInit():Promise<void> {
    this.mod = await import('@serenity-kit/opaque');
    // We need to wait for WASM in case library exposes it
    await (this.mod as any).ready;

    const raw = process.env.OPAQUE_SERVER_SETUP;
    if (raw) {
      this.serverSetup = raw;
      this.logger.log('OPAQUE server setup loaded from environment.');
    } else {
      this.serverSetup = this.mod.server.createSetup();
      this.logger.warn(
        '⚠  OPAQUE_SERVER_SETUP is not set — generated an EPHEMERAL server keypair.\n' +
        '   All user OPAQUE records will become INVALID on server restart.\n' +
        `   Persist this value in .env: OPAQUE_SERVER_SETUP=${this.serverSetup}`,
      );
    }

    // Periodic cleanup pf stale pending login states
    const timer = setInterval(() => this.cleanup(), 60_000); // TO DO cleanup
    // Allow node.js to exit even if interval is running ( tests )
    timer.unref?.();
  }

  // Registration

  /**
   * Step 1 of OPAQUE registration
   * Returns the server's contribution to the OPRF, safe to send over plaintext
   */
  registrationResponse(userIdentifier: string, registrationRequest: string): string {
    const { registrationResponse } = this.mod.server.createRegistrationResponse({
      serverSetup: this.serverSetup,
      userIdentifier,
      registrationRequest,
    });
    return registrationResponse;
  }
}