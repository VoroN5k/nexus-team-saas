import { Injectable, signal, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { AuthService } from './auth.service';

// API base

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

// Types

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

export interface RotationRequest {
  id: string;
  vaultId: string;
  requesterId: string;
  newPublicKey: string;
  status: 'PENDING' | 'APPROVED' | 'EXPIRED' | 'DENIED';
  expiresAt: string;
  createdAt: string;
  requester: { id: string; firstName: string; lastName: string };
  submissions: { holderId: string; submittedAt: string }[];
  vault: { id: string; name: string; threshold: number; totalShares: number };
}

export interface HolderHealth {
  holderId: string;
  firstName: string | null;
  lastName: string | null;
  email: string;
  lastSeenAt: string | null;
  isStale: boolean;
  daysInactive: number | null;
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

export interface RotationNotification {
  type: 'rotation_requested';
  rotationRequestId: string;
  vaultId: string;
  vaultName: string;
  requesterId: string;
  requesterName: string;
  holderIds: string[];
  threshold: number;
  expiresAt: string;
}

export interface QuorumPayload {
  accessRequestId: string;
  vaultId: string;
  shares: Array<{ holderId: string; shareIndex: number; share: string }>;
}

export interface RotationQuorumPayload {
  rotationRequestId: string;
  vaultId: string;
  shares: Array<{ holderId: string; shareIndex: number; share: string }>;
  holderPublicKeys: Array<{ holderId: string; publicKey: string }>;
  threshold: number;
  totalShares: number;
}

// GF(256) Arithmetic & Shamir's Secret Sharing

function buildGFTables() {
  const EXP = new Uint8Array(512);
  const LOG  = new Uint8Array(256);
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x]  = i;
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
  let r = 0;
  for (let i = coeffs.length - 1; i >= 0; i--) r = gfMul(r, x) ^ coeffs[i];
  return r;
}

export function sssplit(secret: Uint8Array, k: number, n: number): Array<{ index: number; share: Uint8Array }> {
  const shares = Array.from({ length: n }, (_, i) => ({ index: i + 1, share: new Uint8Array(secret.length) }));
  for (let b = 0; b < secret.length; b++) {
    const coeffs = new Uint8Array(k);
    coeffs[0] = secret[b];
    crypto.getRandomValues(coeffs.subarray(1));
    for (let i = 0; i < n; i++) shares[i].share[b] = evalPoly(coeffs, i + 1);
  }
  return shares;
}

export function sscombine(shares: Array<{ index: number; share: Uint8Array }>): Uint8Array {
  const len = shares[0].share.length;
  const out  = new Uint8Array(len);
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

// RSA-OAEP Helpers

const KEY_ALGO: RsaHashedKeyGenParams = {
  name: 'RSA-OAEP', modulusLength: 2048,
  publicExponent: new Uint8Array([1, 0, 1]),
  hash: 'SHA-256',
};

function b64ToBytes(b64: string): ArrayBuffer {
  return Uint8Array.from(atob(b64), c => c.charCodeAt(0)).buffer;
}

function bytesToB64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

async function generateKeyPair(): Promise<CryptoKeyPair> {
  return crypto.subtle.generateKey(KEY_ALGO, true, ['encrypt', 'decrypt']);
}

async function exportPublicKey(key: CryptoKey): Promise<string> {
  return bytesToB64(new Uint8Array(await crypto.subtle.exportKey('spki', key)));
}

async function exportPrivateKey(key: CryptoKey): Promise<string> {
  return bytesToB64(new Uint8Array(await crypto.subtle.exportKey('pkcs8', key)));
}

async function importPublicKey(b64: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('spki', b64ToBytes(b64), KEY_ALGO, true, ['encrypt']);
}

async function importPrivateKey(b64: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('pkcs8', b64ToBytes(b64), KEY_ALGO, true, ['decrypt']);
}

export async function encryptShare(shareHex: string, publicKeyB64: string): Promise<string> {
  const pubKey = await importPublicKey(publicKeyB64);
  const ct     = await crypto.subtle.encrypt({ name: 'RSA-OAEP' }, pubKey, new TextEncoder().encode(shareHex));
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

  readonly pendingNotifications  = signal<VaultNotification[]>([]);
  readonly pendingRotations      = signal<RotationNotification[]>([]);
  readonly requestProgress       = signal<Map<string, { submitted: number; threshold: number }>>(new Map());
  readonly rotationProgress      = signal<Map<string, { submitted: number; threshold: number }>>(new Map());

  /**
   * Reconstructed secrets keyed by vaultId — held in memory only, never persisted.
   * Auto-cleared after 5 minutes.
   */
  readonly unlockedSecrets = signal<Map<string, string>>(new Map());

  private socket:   any   = null;
  private keyCache: { publicKey: string; privateKey: string } | null = null;

  // Key Pair Management

  private storageKey(userId: string) { return `vault_kp_${userId}`; }

  async ensureKeyPair(): Promise<{ publicKey: string; privateKey: string }> {
    if (this.keyCache) return this.keyCache;

    const userId = this.auth.user()?.sub;
    if (!userId) throw new Error('Not authenticated');

    const stored = localStorage.getItem(this.storageKey(userId));
    if (stored) {
      this.keyCache = JSON.parse(stored);
      return this.keyCache!;
    }

    const kp     = await generateKeyPair();
    const pubB64 = await exportPublicKey(kp.publicKey);
    const prvB64 = await exportPrivateKey(kp.privateKey);

    const pair = { publicKey: pubB64, privateKey: prvB64 };
    localStorage.setItem(this.storageKey(userId), JSON.stringify(pair));
    this.keyCache = pair;

    await firstValueFrom(this.http.put(`${apiBase()}/auth/me/public-key`, { publicKey: pubB64 }));
    return pair;
  }

  hasKeyPair(): boolean {
    const userId = this.auth.user()?.sub;
    if (!userId) return false;
    return !!localStorage.getItem(this.storageKey(userId));
  }

  /**
   * Generate a FRESH key pair (discards old one).
   * Used when the user is on a new device and needs to request rotation.
   */
  async generateFreshKeyPair(): Promise<{ publicKey: string; privateKey: string }> {
    const userId = this.auth.user()?.sub;
    if (!userId) throw new Error('Not authenticated');

    const kp     = await generateKeyPair();
    const pubB64 = await exportPublicKey(kp.publicKey);
    const prvB64 = await exportPrivateKey(kp.privateKey);

    const pair = { publicKey: pubB64, privateKey: prvB64 };
    localStorage.setItem(this.storageKey(userId), JSON.stringify(pair));
    this.keyCache = pair;

    // Publish the new key — the old shares on the server still use the old key
    // until rotation is finalized
    await firstValueFrom(this.http.put(`${apiBase()}/auth/me/public-key`, { publicKey: pubB64 }));
    return pair;
  }

  /**
   * Returns true if the local private key matches the public key registered on
   * ANY of the user's vault shares. Mismatch means rotation is needed.
   */
  async detectKeyMismatch(vaults: Vault[]): Promise<string[]> {
    const userId = this.auth.user()?.sub;
    if (!userId || !this.hasKeyPair()) return [];

    const { publicKey } = await this.ensureKeyPair();
    const mismatchedVaultIds: string[] = [];

    for (const vault of vaults) {
      const myShare = vault.shares.find(s => s.holderId === userId);
      if (myShare && myShare.holderPublicKey !== publicKey) {
        mismatchedVaultIds.push(vault.id);
      }
    }

    return mismatchedVaultIds;
  }

  // WebSocket

  async connectSocket(workspaceId: string): Promise<void> {
    if (this.socket?.connected) {
      this.socket.emit('vault:subscribe', { workspaceId });
      return;
    }

    const { io } = await import('socket.io-client' as any);
    const token  = this.auth.token();

    this.socket = io(`${wsBase()}/vault`, { auth: { token }, transports: ['websocket'] });

    this.socket.on('connect', () => {
      this.socket.emit('vault:subscribe', { workspaceId });
    });

    // Access request flow

    this.socket.on('vault:access_requested', (data: VaultNotification) => {
      const myId = this.auth.user()?.sub;
      if (data.holderIds.includes(myId ?? '')) {
        this.pendingNotifications.update(ns => [...ns, data]);
      }
      this.requestProgress.update(m => {
        const next = new Map(m);
        next.set(data.accessRequestId, { submitted: 0, threshold: data.threshold });
        return next;
      });
    });

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

    this.socket.on('vault:quorum_reached', async (data: QuorumPayload) => {
      try {
        const parsedShares = data.shares.map(s => {
          const bytes = new Uint8Array(s.share.length / 2);
          for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(s.share.slice(i * 2, i * 2 + 2), 16);
          return { index: s.shareIndex, share: bytes };
        });

        const secret = new TextDecoder().decode(sscombine(parsedShares));

        this.unlockedSecrets.update(m => {
          const next = new Map(m);
          next.set(data.vaultId, secret);
          return next;
        });

        // Clear after 5 minutes — XSS mitigation: minimise time secret lives in memory
        setTimeout(() => {
          this.unlockedSecrets.update(m => { const next = new Map(m); next.delete(data.vaultId); return next; });
        }, 5 * 60 * 1_000);
      } catch (err) {
        console.error('Failed to reconstruct secret:', err);
      }
    });

    this.socket.on('vault:request_expired', (data: any) => {
      this.pendingNotifications.update(ns => ns.filter(n => n.accessRequestId !== data.accessRequestId));
    });

    this.socket.on('vault:request_denied', (data: any) => {
      this.pendingNotifications.update(ns => ns.filter(n => n.accessRequestId !== data.accessRequestId));
    });

    // ── Rotation flow ──

    this.socket.on('vault:rotation_requested', (data: RotationNotification) => {
      const myId = this.auth.user()?.sub;
      // Notify OTHER holders (not the requester themselves)
      if (data.holderIds.includes(myId ?? '') && data.requesterId !== myId) {
        this.pendingRotations.update(ns => [...ns, data]);
      }
      this.rotationProgress.update(m => {
        const next = new Map(m);
        next.set(data.rotationRequestId, { submitted: 0, threshold: data.threshold });
        return next;
      });
    });

    this.socket.on('vault:rotation_share_submitted', (data: any) => {
      this.rotationProgress.update(m => {
        const next = new Map(m);
        next.set(data.rotationRequestId, {
          submitted: data.submittedCount ?? (m.get(data.rotationRequestId)?.submitted ?? 0) + 1,
          threshold: data.threshold ?? m.get(data.rotationRequestId)?.threshold ?? 1,
        });
        return next;
      });
    });

    /**
     * The rotation quorum has been reached.
     * The requester receives the plaintext shares and must:
     *   1. Reconstruct the secret
     *   2. Re-split with new n shares
     *   3. Encrypt each share with the corresponding holder's current public key
     *   4. Call finalizeRotation to persist the new shares
     */
    this.socket.on('vault:rotation_quorum_reached', async (data: RotationQuorumPayload & { rotationRequestId: string; vaultId: string }) => {
      // Emitted to: this service's rotationQuorumCallback handler set by the component
      this._rotationQuorumCallback?.(data);
    });

    this.socket.on('vault:rotation_finalized', () => {
      // Reload signal will be set by the component to trigger a data refresh
      this._rotationFinalizedCallback?.();
    });

    this.socket.on('vault:rotation_denied', (data: any) => {
      this.pendingRotations.update(ns => ns.filter(n => n.rotationRequestId !== data.rotationRequestId));
    });
  }

  /** Set by VaultTabComponent to react to rotation quorum */
  private _rotationQuorumCallback?: (data: RotationQuorumPayload & { rotationRequestId: string; vaultId: string }) => void;
  private _rotationFinalizedCallback?: () => void;

  onRotationQuorum(cb: (data: RotationQuorumPayload & { rotationRequestId: string; vaultId: string }) => void) {
    this._rotationQuorumCallback = cb;
  }

  onRotationFinalized(cb: () => void) {
    this._rotationFinalizedCallback = cb;
  }

  disconnectSocket(): void {
    this.socket?.disconnect();
    this.socket = null;
    this._rotationQuorumCallback  = undefined;
    this._rotationFinalizedCallback = undefined;
  }

  dismissNotification(accessRequestId: string) {
    this.pendingNotifications.update(ns => ns.filter(n => n.accessRequestId !== accessRequestId));
  }

  dismissRotationNotification(rotationRequestId: string) {
    this.pendingRotations.update(ns => ns.filter(n => n.rotationRequestId !== rotationRequestId));
  }

  restoreNotificationsFromRequests(pendingRequests: AccessRequest[], vaults: Vault[], myUserId: string): void {
    const existing = new Set(this.pendingNotifications().map(n => n.accessRequestId));

    for (const req of pendingRequests) {
      if (existing.has(req.id)) continue;
      const vault = vaults.find(v => v.id === req.vaultId);
      if (!vault) continue;
      if (!vault.shares.some(s => s.holderId === myUserId)) continue;
      if (req.submissions.some(s => s.holderId === myUserId)) continue;

      this.pendingNotifications.update(ns => [...ns, {
        type:            'access_requested',
        accessRequestId: req.id,
        vaultId:         req.vaultId,
        vaultName:       vault.name,
        requesterId:     req.requesterId,
        requesterName:   `${req.requester.firstName} ${req.requester.lastName}`,
        holderIds:       vault.shares.map(s => s.holderId),
        threshold:       vault.threshold,
        totalShares:     vault.totalShares,
        expiresAt:       req.expiresAt,
      }]);
    }
  }

  restoreRotationNotifications(pendingRotations: RotationRequest[], vaults: Vault[], myUserId: string): void {
    const existing = new Set(this.pendingRotations().map(n => n.rotationRequestId));

    for (const req of pendingRotations) {
      if (existing.has(req.id)) continue;
      if (req.requesterId === myUserId) continue; // I'm the requester, not a responder

      const vault = vaults.find(v => v.id === req.vaultId);
      if (!vault) continue;
      if (!vault.shares.some(s => s.holderId === myUserId)) continue;  // I'm a holder
      if (req.submissions.some(s => s.holderId === myUserId)) continue; // Already submitted

      this.pendingRotations.update(ns => [...ns, {
        type:              'rotation_requested',
        rotationRequestId: req.id,
        vaultId:           req.vaultId,
        vaultName:         vault.name,
        requesterId:       req.requesterId,
        requesterName:     `${req.requester.firstName} ${req.requester.lastName}`,
        holderIds:         vault.shares.map(s => s.holderId),
        threshold:         vault.threshold,
        expiresAt:         req.expiresAt,
      }]);
    }
  }

  // HTTP API

  private url(wid: string, ...parts: string[]) {
    return `${apiBase()}/workspaces/${wid}/vault${parts.length ? '/' + parts.join('/') : ''}`;
  }

  listVaults(workspaceId: string)                      { return this.http.get<Vault[]>(this.url(workspaceId)); }
  deleteVault(workspaceId: string, vaultId: string)    { return this.http.delete(this.url(workspaceId, vaultId)); }

  getMyEncryptedShare(workspaceId: string, vaultId: string) {
    return this.http.get<{ id: string; shareIndex: number; encryptedShare: string; holderPublicKey: string }>(
      this.url(workspaceId, vaultId, 'my-share'),
    );
  }

  getHolderHealth(workspaceId: string, vaultId: string) {
    return this.http.get<HolderHealth[]>(this.url(workspaceId, vaultId, 'holder-health'));
  }

  listAccessRequests(workspaceId: string, vaultId: string) {
    return this.http.get<AccessRequest[]>(this.url(workspaceId, vaultId, 'access-requests'));
  }

  createAccessRequest(workspaceId: string, vaultId: string, reason?: string) {
    return this.http.post<AccessRequest>(this.url(workspaceId, vaultId, 'access-requests'), { reason });
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

  listRotationRequests(workspaceId: string, vaultId: string) {
    return this.http.get<RotationRequest[]>(this.url(workspaceId, vaultId, 'rotation-requests'));
  }

  createRotationRequest(workspaceId: string, vaultId: string, newPublicKey: string) {
    return this.http.post<RotationRequest>(
      this.url(workspaceId, vaultId, 'rotation-requests'),
      { newPublicKey },
    );
  }

  submitRotationShare(workspaceId: string, vaultId: string, rotationRequestId: string, share: string) {
    return this.http.post<{ status: string; submittedCount: number }>(
      this.url(workspaceId, vaultId, 'rotation-requests', rotationRequestId, 'submit'),
      { share },
    );
  }

  finalizeRotation(
    workspaceId: string,
    vaultId: string,
    rotationRequestId: string,
    shares: Array<{ holderId: string; encryptedShare: string; holderPublicKey: string; shareIndex: number }>,
  ) {
    return this.http.put<Vault>(
      this.url(workspaceId, vaultId, 'rotation-requests', rotationRequestId, 'finalize'),
      { shares },
    );
  }

  denyRotationRequest(workspaceId: string, vaultId: string, rotationRequestId: string) {
    return this.http.delete(this.url(workspaceId, vaultId, 'rotation-requests', rotationRequestId));
  }

  // High-level vault creation

  async createVault(workspaceId: string, opts: {
    name: string; description?: string; secret: string;
    threshold: number; holders: Array<{ id: string; publicKey: string }>;
  }) {
    const secretBytes    = new TextEncoder().encode(opts.secret);
    const rawShares      = sssplit(secretBytes, opts.threshold, opts.holders.length);

    const encryptedShares = await Promise.all(
      rawShares.map(async (s, idx) => {
        const holder   = opts.holders[idx];
        const shareHex = Array.from(s.share).map(b => b.toString(16).padStart(2, '0')).join('');
        const enc      = await encryptShare(shareHex, holder.publicKey);
        return { holderId: holder.id, shareIndex: s.index, encryptedShare: enc, holderPublicKey: holder.publicKey };
      }),
    );

    return firstValueFrom(
      this.http.post<Vault>(this.url(workspaceId), {
        name: opts.name, description: opts.description,
        threshold: opts.threshold, totalShares: opts.holders.length,
        shares: encryptedShares,
      }),
    );
  }

  async holderSubmitShare(
    workspaceId: string,
    vaultId: string,
    accessRequestId: string,
  ): Promise<{ status: string; submittedCount: number }> {
    const { privateKey, publicKey } = await this.ensureKeyPair();
    const encShare = await firstValueFrom(this.getMyEncryptedShare(workspaceId, vaultId));

    if (encShare.holderPublicKey !== publicKey) {
      throw new Error(
        'Key mismatch: your local private key does not match the public key used to encrypt your share. ' +
        'Use "Request key rotation" to regain access.',
      );
    }

    const plainHex = await decryptShare(encShare.encryptedShare, privateKey);
    return firstValueFrom(this.submitShare(workspaceId, vaultId, accessRequestId, plainHex));
  }

  async holderSubmitRotationShare(
    workspaceId: string,
    vaultId: string,
    rotationRequestId: string,
  ): Promise<{ status: string; submittedCount: number }> {
    const { privateKey, publicKey } = await this.ensureKeyPair();
    const encShare = await firstValueFrom(this.getMyEncryptedShare(workspaceId, vaultId));

    if (encShare.holderPublicKey !== publicKey) {
      throw new Error(
        'Key mismatch: cannot submit rotation share — your own key is also mismatched. ' +
        'You should request rotation for your share first.',
      );
    }

    const plainHex = await decryptShare(encShare.encryptedShare, privateKey);
    return firstValueFrom(this.submitRotationShare(workspaceId, vaultId, rotationRequestId, plainHex));
  }

  /**
   * After receiving `vault:rotation_quorum_reached`:
   *   1. Reconstruct secret from the k submitted shares
   *   2. Re-split into n new shares
   *   3. Encrypt each share with the holder's current public key
   *   4. PUT /finalize to persist
   */
  async finalizeRotationClientSide(
    workspaceId: string,
    data: RotationQuorumPayload & { rotationRequestId: string; vaultId: string },
  ): Promise<Vault> {
    // 1. Reconstruct secret
    const parsedShares = data.shares.map(s => {
      const bytes = new Uint8Array(s.share.length / 2);
      for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(s.share.slice(i * 2, i * 2 + 2), 16);
      return { index: s.shareIndex, share: bytes };
    });

    const secretBytes = sscombine(parsedShares);

    // 2. Re-split into n new shares
    const newShares = sssplit(secretBytes, data.threshold, data.totalShares);

    // 3. Encrypt each share with the corresponding holder's current public key
    const holderKeyMap = new Map(data.holderPublicKeys.map(h => [h.holderId, h.publicKey]));

    // We need the vault shares in correct order (index 1..n)
    // data.holderPublicKeys has all holders — match by position/index
    const sortedHolders = data.holderPublicKeys; // server sends them in share-index order

    const encryptedShares = await Promise.all(
      newShares.map(async (s, idx) => {
        const holder = sortedHolders[idx];
        if (!holder) throw new Error(`Missing holder for share index ${s.index}`);
        const publicKey = holderKeyMap.get(holder.holderId);
        if (!publicKey) throw new Error(`No public key for holder ${holder.holderId}`);
        const shareHex  = Array.from(s.share).map(b => b.toString(16).padStart(2, '0')).join('');
        const encrypted = await encryptShare(shareHex, publicKey);
        return {
          holderId:        holder.holderId,
          shareIndex:      s.index,
          encryptedShare:  encrypted,
          holderPublicKey: publicKey,
        };
      }),
    );

    // Clear secret from local scope ASAP
    secretBytes.fill(0);

    // 4. Send to server
    return firstValueFrom(
      this.finalizeRotation(workspaceId, data.vaultId, data.rotationRequestId, encryptedShares),
    );
  }
}
