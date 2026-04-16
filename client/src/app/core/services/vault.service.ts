import { Injectable, signal, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { AuthService } from './auth.service';

// ── API base ──────────────────────────────────────────────────────────────────

function apiBase(): string {
  const { protocol, hostname } = window.location;
  if (hostname === 'localhost') return `${protocol}//localhost:4000/api`;
  const apiHost = hostname.replace(/-(\d+)\./, (_: string, p: string) =>
    p === '3000' ? '-4000.' : `-${p}.`);
  return `${protocol}//${apiHost}/api`;
}

function wsBase(): string {
  const { hostname } = window.location;
  if (hostname === 'localhost') return 'http://localhost:4000';
  const apiHost = hostname.replace(/-(\d+)\./, (_: string, p: string) =>
    p === '3000' ? '-4000.' : `-${p}.`);
  return `https://${apiHost}`;
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface VaultHolder {
  id: string;
  holderId: string;
  shareIndex: number;
  holderPublicKey: string;
  holder: { id: string; firstName: string; lastName: string; email: string };
}

export interface Vault {
  id: string;
  name: string;
  description?: string;
  threshold: number;
  totalShares: number;
  createdAt: string;
  createdBy: { id: string; firstName: string; lastName: string };
  shares: VaultHolder[];
}

export interface AccessRequest {
  id: string;
  vaultId: string;
  requesterId: string;
  status: 'PENDING' | 'APPROVED' | 'EXPIRED' | 'DENIED';
  expiresAt: string;
  createdAt: string;
  requester: { id: string; firstName: string; lastName: string };
  submissions: { holderId: string; submittedAt: string }[];
  vault: { id: string; name: string; threshold: number; totalShares: number };
}

export interface VaultNotification {
  type: 'access_requested';
  accessRequestId: string;
  vaultId: string;
  vaultName: string;
  requesterId: string;
  requesterName: string;
  reason?: string;
  holderIds: string[];
  threshold: number;
  totalShares: number;
  expiresAt: string;
}

export interface QuorumPayload {
  accessRequestId: string;
  vaultId: string;
  shares: Array<{ holderId: string; share: string }>;
}

// ── GF(256) Arithmetic & Shamir's Secret Sharing ─────────────────────────────
// Finite field GF(2^8) with primitive polynomial 0x11b (same as AES)

function buildGFTables() {
  const EXP = new Uint8Array(512);
  const LOG = new Uint8Array(256);
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x = x ^ (x << 1) ^ (x & 0x80 ? 0x1b : 0);
    x &= 0xff;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
  return { EXP, LOG };
}

const { EXP, LOG } = buildGFTables();

function gfMul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return EXP[(LOG[a] + LOG[b]) % 255];
}

function gfInv(a: number): number {
  if (a === 0) throw new Error('GF inv(0) undefined');
  return EXP[(255 - LOG[a]) % 255];
}

function evalPoly(coeffs: Uint8Array, x: number): number {
  // Horner's method: f(x) = c0 + c1*x + c2*x^2 + ...
  let r = 0;
  for (let i = coeffs.length - 1; i >= 0; i--) {
    r = gfMul(r, x) ^ coeffs[i];
  }
  return r;
}

/** Split a secret (bytes) into n shares requiring k to reconstruct. */
export function sssplit(
  secret: Uint8Array,
  k: number,
  n: number,
): Array<{ index: number; share: Uint8Array }> {
  const shares = Array.from({ length: n }, (_, i) => ({
    index: i + 1,
    share: new Uint8Array(secret.length),
  }));

  for (let b = 0; b < secret.length; b++) {
    const coeffs = new Uint8Array(k);
    coeffs[0] = secret[b];
    crypto.getRandomValues(coeffs.subarray(1));

    for (let i = 0; i < n; i++) {
      shares[i].share[b] = evalPoly(coeffs, i + 1);
    }
  }
  return shares;
}

/** Reconstruct secret from k (or more) shares via Lagrange interpolation at x=0. */
export function sscombine(shares: Array<{ index: number; share: Uint8Array }>): Uint8Array {
  const len = shares[0].share.length;
  const out = new Uint8Array(len);

  for (let b = 0; b < len; b++) {
    let val = 0;
    for (let i = 0; i < shares.length; i++) {
      let num = 1, den = 1;
      for (let j = 0; j < shares.length; j++) {
        if (i === j) continue;
        num = gfMul(num, shares[j].index);
        den = gfMul(den, shares[i].index ^ shares[j].index);
      }
      val ^= gfMul(shares[i].share[b], gfMul(num, gfInv(den)));
    }
    out[b] = val;
  }
  return out;
}

// ── RSA-OAEP Helpers (Web Crypto API) ────────────────────────────────────────

const KEY_ALGO: RsaHashedKeyGenParams = {
  name: 'RSA-OAEP', modulusLength: 2048,
  publicExponent: new Uint8Array([1, 0, 1]),
  hash: 'SHA-256',
};

function b64ToBytes(b64: string): ArrayBuffer {
  const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  return bytes.buffer;
}

function bytesToB64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

async function generateKeyPair(): Promise<CryptoKeyPair> {
  return crypto.subtle.generateKey(KEY_ALGO, true, ['encrypt', 'decrypt']);
}

async function exportPublicKey(key: CryptoKey): Promise<string> {
  const spki = await crypto.subtle.exportKey('spki', key);
  return bytesToB64(new Uint8Array(spki));
}

async function exportPrivateKey(key: CryptoKey): Promise<string> {
  const pkcs8 = await crypto.subtle.exportKey('pkcs8', key);
  return bytesToB64(new Uint8Array(pkcs8));
}

async function importPublicKey(b64: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('spki', b64ToBytes(b64), KEY_ALGO, true, ['encrypt']);
}

async function importPrivateKey(b64: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('pkcs8', b64ToBytes(b64), KEY_ALGO, true, ['decrypt']);
}

export async function encryptShare(shareHex: string, publicKeyB64: string): Promise<string> {
  const pubKey = await importPublicKey(publicKeyB64);
  const data   = new TextEncoder().encode(shareHex);
  const ct     = await crypto.subtle.encrypt({ name: 'RSA-OAEP' }, pubKey, data);
  return bytesToB64(new Uint8Array(ct));
}

export async function decryptShare(encryptedB64: string, privateKeyB64: string): Promise<string> {
  const privKey = await importPrivateKey(privateKeyB64);
  const pt      = await crypto.subtle.decrypt({ name: 'RSA-OAEP' }, privKey, b64ToBytes(encryptedB64));
  return new TextDecoder().decode(pt);
}

// VaultService

@Injectable({ providedIn: 'root' })
export class VaultService {
  private http = inject(HttpClient);
  private auth = inject(AuthService);

  // Reactive state

  /** Pending notifications that the current user (as a holder) should respond to */
  readonly pendingNotifications = signal<VaultNotification[]>([]);

  /** Access requests being tracked (progress updates) */
  readonly requestProgress = signal<Map<string, { submitted: number; threshold: number }>>(new Map());

  /** Reconstructed secrets keyed by vaultId — held in memory only */
  readonly unlockedSecrets = signal<Map<string, string>>(new Map());

  private socket: any = null;
  private keyCache: { publicKey: string; privateKey: string } | null = null;

  // Key Pair Management

  private storageKey(userId: string) { return `vault_kp_${userId}`; }

  /** Returns { publicKey, privateKey } in base64. Generates and persists if missing. */
  async ensureKeyPair(): Promise<{ publicKey: string; privateKey: string }> {
    if (this.keyCache) return this.keyCache;

    const userId = this.auth.user()?.sub;
    if (!userId) throw new Error('Not authenticated');

    const stored = localStorage.getItem(this.storageKey(userId));
    if (stored) {
      this.keyCache = JSON.parse(stored);
      return this.keyCache!;
    }

    // Generate fresh key pair
    const kp     = await generateKeyPair();
    const pubB64 = await exportPublicKey(kp.publicKey);
    const prvB64 = await exportPrivateKey(kp.privateKey);

    const pair = { publicKey: pubB64, privateKey: prvB64 };
    localStorage.setItem(this.storageKey(userId), JSON.stringify(pair));
    this.keyCache = pair;

    // Publish public key to server
    await firstValueFrom(
      this.http.put(`${apiBase()}/auth/me/public-key`, { publicKey: pubB64 }),
    );

    return pair;
  }

  /** Returns true if the user already has a key pair set up. */
  hasKeyPair(): boolean {
    const userId = this.auth.user()?.sub;
    if (!userId) return false;
    return !!localStorage.getItem(this.storageKey(userId));
  }

  // WebSocket

  async connectSocket(workspaceId: string): Promise<void> {
    if (this.socket?.connected) {
      this.socket.emit('vault:subscribe', { workspaceId });
      return;
    }

    // Lazy-load socket.io-client
    const { io } = await import('socket.io-client' as any);
    const token  = this.auth.token();

    this.socket = io(`${wsBase()}/vault`, {
      auth: { token },
      transports: ['websocket'],
    });

    this.socket.on('connect', () => {
      this.socket.emit('vault:subscribe', { workspaceId });
    });

    // Holder notification: someone requested access to a vault we hold a share for
    this.socket.on('vault:access_requested', (data: VaultNotification) => {
      const myId = this.auth.user()?.sub;
      if (data.holderIds.includes(myId ?? '')) {
        this.pendingNotifications.update(ns => [...ns, data]);
      }
      // Update progress tracking
      this.requestProgress.update(m => {
        const next = new Map(m);
        next.set(data.accessRequestId, { submitted: 0, threshold: data.threshold });
        return next;
      });
    });

    // Progress update
    this.socket.on('vault:share_submitted', (data: any) => {
      this.requestProgress.update(m => {
        const next = new Map(m);
        next.set(data.accessRequestId, {
          submitted: data.submittedCount ?? (m.get(data.accessRequestId)?.submitted ?? 0) + 1,
          threshold: data.threshold ?? m.get(data.accessRequestId)?.threshold ?? 1,
        });
        return next;
      });
    });

    // Quorum reached — reconstruct secret in-browser
    this.socket.on('vault:quorum_reached', async (data: QuorumPayload) => {
      try {
        const { privateKey } = await this.ensureKeyPair();
        const myId = this.auth.user()?.sub;

        // Find MY share in the payload
        const mySubmission = data.shares.find(s => s.holderId === myId);
        if (!mySubmission) {
          console.warn('Quorum reached but no share for current user — not the requester');
        }

        // Reconstruct from all shares
        const parsedShares = data.shares.map(s => {
          const bytes = Uint8Array.from(
            s.share.match(/.{1,2}/g)!.map(h => parseInt(h, 16)),
          );
          return { index: parseInt(s.holderId.slice(-2), 16) || 1, share: bytes };
        });

        // Note: we store the raw share data — actual reconstruction uses sscombine
        // The shares here are already plaintext (submitted by holders)
        const combined = sscombine(parsedShares);
        const secret   = new TextDecoder().decode(combined);

        this.unlockedSecrets.update(m => {
          const next = new Map(m);
          next.set(data.vaultId, secret);
          return next;
        });

        // Auto-clear secret after 5 minutes
        setTimeout(() => {
          this.unlockedSecrets.update(m => {
            const next = new Map(m);
            next.delete(data.vaultId);
            return next;
          });
        }, 5 * 60 * 1_000);
      } catch (err) {
        console.error('Failed to reconstruct secret:', err);
      }
    });

    this.socket.on('vault:request_expired', (data: any) => {
      this.pendingNotifications.update(ns =>
        ns.filter(n => n.accessRequestId !== data.accessRequestId),
      );
    });
    this.socket.on('vault:request_denied', (data: any) => {
      this.pendingNotifications.update(ns =>
        ns.filter(n => n.accessRequestId !== data.accessRequestId),
      );
    });
  }

  disconnectSocket(): void {
    this.socket?.disconnect();
    this.socket = null;
  }

  dismissNotification(accessRequestId: string) {
    this.pendingNotifications.update(ns =>
      ns.filter(n => n.accessRequestId !== accessRequestId),
    );
  }

  // HTTP API

  private url(wid: string, ...parts: string[]) {
    return `${apiBase()}/workspaces/${wid}/vault${parts.length ? '/' + parts.join('/') : ''}`;
  }

  listVaults(workspaceId: string) {
    return this.http.get<Vault[]>(this.url(workspaceId));
  }

  deleteVault(workspaceId: string, vaultId: string) {
    return this.http.delete(this.url(workspaceId, vaultId));
  }

  getMyEncryptedShare(workspaceId: string, vaultId: string) {
    return this.http.get<{ id: string; shareIndex: number; encryptedShare: string; holderPublicKey: string }>(
      this.url(workspaceId, vaultId, 'my-share'),
    );
  }

  listAccessRequests(workspaceId: string, vaultId: string) {
    return this.http.get<AccessRequest[]>(this.url(workspaceId, vaultId, 'access-requests'));
  }

  createAccessRequest(workspaceId: string, vaultId: string, reason?: string) {
    return this.http.post<AccessRequest>(
      this.url(workspaceId, vaultId, 'access-requests'),
      { reason },
    );
  }

  submitShare(workspaceId: string, vaultId: string, requestId: string, share: string) {
    return this.http.post<{ status: string; submittedCount: number }>(
      this.url(workspaceId, vaultId, 'access-requests', requestId, 'submit'),
      { share },
    );
  }

  denyAccessRequest(workspaceId: string, vaultId: string, requestId: string) {
    return this.http.delete(this.url(workspaceId, vaultId, 'access-requests', requestId));
  }

  // High-level vault creation

  /**
   * Full client-side creation flow:
   *   1. Encode secret as UTF-8 bytes
   *   2. Split via SSS into n shares
   *   3. Encrypt each share with the holder's RSA-OAEP public key
   *   4. POST to server (raw secret never leaves browser)
   */
  async createVault(
    workspaceId: string,
    opts: {
      name: string;
      description?: string;
      secret: string;
      threshold: number;
      holders: Array<{ id: string; publicKey: string }>;
    },
  ) {
    const secretBytes = new TextEncoder().encode(opts.secret);
    const n           = opts.holders.length;
    const k           = opts.threshold;

    const rawShares = sssplit(secretBytes, k, n);

    // Convert each share to hex for RSA encryption
    const encryptedShares = await Promise.all(
      rawShares.map(async (s, idx) => {
        const holder   = opts.holders[idx];
        const shareHex = Array.from(s.share).map(b => b.toString(16).padStart(2, '0')).join('');
        const enc      = await encryptShare(shareHex, holder.publicKey);
        return {
          holderId:       holder.id,
          shareIndex:     s.index,
          encryptedShare: enc,
          holderPublicKey: holder.publicKey,
        };
      }),
    );

    return firstValueFrom(
      this.http.post<Vault>(this.url(workspaceId), {
        name:        opts.name,
        description: opts.description,
        threshold:   k,
        totalShares: n,
        shares:      encryptedShares,
      }),
    );
  }

  /**
   * High-level submit-share flow for a key holder:
   *   1. Fetch the holder's encrypted share from the server
   *   2. Decrypt it locally using the holder's private key
   *   3. POST the plaintext share hex to fulfil the access request
   */
  async holderSubmitShare(
    workspaceId: string,
    vaultId: string,
    accessRequestId: string,
  ): Promise<{ status: string; submittedCount: number }> {
    const { privateKey } = await this.ensureKeyPair();

    const encShare = await firstValueFrom(
      this.getMyEncryptedShare(workspaceId, vaultId),
    );

    const plainHex = await decryptShare(encShare.encryptedShare, privateKey);

    return firstValueFrom(
      this.submitShare(workspaceId, vaultId, accessRequestId, plainHex),
    );
  }
}
