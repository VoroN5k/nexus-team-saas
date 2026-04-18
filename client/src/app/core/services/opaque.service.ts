import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

/**
 * OpaqueClientService - browser-side OPAQUE protocol.
 *
 * Security guarantees:
 * - The plaintext password NEVER leaves this browser
 * - The server only sees OPRF evaluations and the OPAQUE envelope
 * - `exportKey` is a PRF output derived from password + server secrets;
 *   the server cannot compute it - we use it to wrap the vault private key
 * - All opaque binary values are base64 strings (handled by the library)
 */

function apiBase(): string {
  const { protocol, hostname } = window.location;
  if (hostname === 'localhost') return `${protocol}//localhost:4000/api`;
  const apiHost = hostname.replace(/-(\d+)\./, (_: string, p: string) =>
    p === '3000' ? '-4000.' : `-${p}.`,
  );
  return `${protocol}//${apiHost}/api`;
}

const API = `${apiBase()}/auth`;

// Lazy singleton: WASM module loads once on first use
let opaquePromise: Promise<typeof import('@serenity-kit/opaque')> | null = null;

async function getOpaque() {
  if (!opaquePromise) {
    opaquePromise = import('@serenity-kit/opaque').then(async mod => {
      // Some versions expose a `ready` promise for WASM init
      if ((mod as any).ready) await (mod as any).ready;
      return mod;
    });
  }
  return opaquePromise;
}

export interface OpaqueRegisterResult {
  /** Send to POST /auth/opaque/register-finish */
  registrationRecord: string;
  /**
   * Client-only - NEVER send to server
   * Deterministic PRF output: use to derive the vault-key wrapping key
   */
  exportKey: Uint8Array;
}

export interface OpaqueLoginResult {
  /** Send to POST /auth/opaque/login-finish */
  finishLoginRequest: string;
  /**
   * Client-only - NEVER send to server
   * Same value as produced during registration (deterministic from password)
   * Use to unwrap vault private key from IndexedDB
   */
  exportKey: Uint8Array;
}

@Injectable({ providedIn: 'root' })
export class OpaqueClientService {
  constructor(private http: HttpClient) {}

  // Registration flow

  /**
   * Full OPAQUE registration:
   *   1. client.createRegistrationRequest(password)
   *   2. POST /auth/opaque/register-init -> registrationResponse
   *   3. client.finalizeRegistration(...)
   *
   * Returns { registrationRecord, exportKey } - caller sends registrationRecord to server
   * exportKey is kept client-side only
   */
  async registerOpaque(email: string, password: string): Promise<OpaqueRegisterResult> {
    const { client } = await getOpaque();

    const { registrationRequest, clientRegistrationState } =
      client.startRegistration({ password });

    const { registrationResponse } = await firstValueFrom(
      this.http.post<{ registrationResponse: string }>(`${API}/opaque/register-init`, {
        userIdentifier:      email,
        registrationRequest,
      }),
    );

    const { registrationRecord, exportKey } = client.finishRegistration({
      clientRegistrationState,
      registrationResponse,
      password,
    });


    return { registrationRecord, exportKey };
  }

  // Login flow

  /**
   * Round 1 of OPAQUE login - returns the client's AKE message and state
   * Call this, get `loginResponse` + `nonce` from server, then call `finishLogin`
   */
  async startLogin(
    email:    string,
    password: string,
  ): Promise<{ clientLoginState: string; loginResponse: string; nonce: string }> {
    const { client } = await getOpaque();

    const { startLoginRequest, clientLoginState } =
      client.startLogin({ password });

    const { loginResponse, nonce } = await firstValueFrom(
      this.http.post<{ loginResponse: string; nonce: string }>(`${API}/opaque/login-init`, {
        userIdentifier:    email,
        startLoginRequest,
      }),
    );

    return { clientLoginState, loginResponse, nonce };
  }

  /**
   * Round 2 of OPAQUE login - verifies server's message, derives exportKey
   * Returns `finishLoginRequest` to send to server + `exportKey` for vault keys
   */
  async finishLogin(
    clientLoginState: string,
    loginResponse:    string,
  ): Promise<OpaqueLoginResult> {
    const { client } = await getOpaque();

    const { finishLoginRequest, exportKey } = client.finishLogin({
      clientLoginState,
      loginResponse,
    });

    return { finishLoginRequest, exportKey };
  }
}
