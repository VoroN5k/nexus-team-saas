import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import {apiBase} from '../utils/api-base.util';

/**
 * OpaqueClientService - browser-side OPAQUE protocol.
 *
 * Key points about @serenity-kit/opaque API:
 * - `client.finishRegistration` returns `{ registrationRecord }` - no sessionKey
 * - `client.finishLogin` returns `FinishClientLoginResult | undefined`
 *    (undefined = wrong password), contains `{ finishLoginRequest, sessionKey }`
 * - `sessionKey` is a hex string, not Uint8Array
 *
 * We use `sessionKey` from the login flow as the vault-key wrapping material
 * After registration we immediately run a login to obtain the sessionKey
 */


const API = `${apiBase()}/auth`;

// Lazy singleton — WASM loads once
let opaquePromise: Promise<typeof import('@serenity-kit/opaque')> | null = null;

async function getOpaque() {
  if(!opaquePromise) {
    opaquePromise = import('@serenity-kit/opaque').then(async mod => {
      await (mod as any).ready;
      return mod;
    });
  }
  return opaquePromise;
}

/** sessionKey as hex string - use to derive vault wrapping key via HKDF */
export type OpaqueSessionKey = string;

export interface OpaqueRegisterResult {
  registrationRecord: string;
}

export interface OpaqueLoginResult {
  finishLoginRequest: string;
  nonce: string;
  /**
   * Shared secret derived from password + server OPRF
   * Server NEVER sees this value (it derives its own copy but doesn't send it)
   * Use for VaultKeyService.initSession()
   */
  sessionKey: OpaqueSessionKey;
}

@Injectable({ providedIn: 'root' })
export class OpaqueClientService {
  constructor(private http: HttpClient) {}

  // Registration flow

  /**
   * OPAQUE registration - 2 round-trips:
   *   1. client.startRegistration(password) -> POST register-init
   *   2. server.createRegistrationResponse  -> client.finishRegistration
   *
   * Returns { registrationRecord } to send to server
   * Note: there is NO sessionKey from registration — call loginOpaque() after
   * the account is created to obtain the sessionKey for vault key init
   */
  async registerOpaque(email: string, password: string): Promise<OpaqueRegisterResult> {
    const opaque = await getOpaque();

    const { clientRegistrationState, registrationRequest } =
      opaque.client.startRegistration({ password });

    const { registrationResponse } = await firstValueFrom(
      this.http.post<{ registrationResponse: string }>(`${API}/opaque/register-init`, {
        userIdentifier:      email,
        registrationRequest,
      }),
    );

    // finishRegistration only returns { registrationRecord } - no sessionKey
    const { registrationRecord } = opaque.client.finishRegistration({
      clientRegistrationState,
      registrationResponse,
      password,
    });

    return { registrationRecord };
  }

  // Login flow

  /**
   * OPAQUE login - 2 round-trips:
   *   1. client.startLogin(password) -> POST login-init
   *   2. server.startLogin           -> client.finishLogin → POST login-finish
   *
   * Returns { finishLoginRequest, nonce, sessionKey }
   * Caller sends finishLoginRequest + nonce to server, keeps sessionKey locally
   * Throws if password is wrong (finishLogin returns undefined)
   */
  async loginOpaque(email: string, password: string): Promise<OpaqueLoginResult> {
    const opaque = await getOpaque();

    // Round 1
    const { clientLoginState, startLoginRequest } =
      opaque.client.startLogin({ password });

    const { loginResponse, nonce } = await firstValueFrom(
      this.http.post<{ loginResponse: string; nonce: string }>(`${API}/opaque/login-init`, {
        userIdentifier:    email,
        startLoginRequest,
      }),
    );

    // Round 2 — returns undefined when password is wrong (client-side MAC fails)
    const loginResult = opaque.client.finishLogin({
      clientLoginState,
      loginResponse,
      password,
    });

    if (!loginResult) {
      // MAC verification failed client-side — password is wrong
      throw new Error('Invalid credentials');
    }

    const { finishLoginRequest, sessionKey } = loginResult;
    return { finishLoginRequest, nonce, sessionKey };
  }
}
