import { Injectable, signal } from '@angular/core';

/**
 * VaultKeyService - stores RSA-OAEP vault key pairs in IndexedDB,
 * wrapped (encrypted) with a key derived from the OPAQUE sessionKey.
 *
 * TypeScript 5.6+ note: bare `Uint8Array` defaults to `Uint8Array<ArrayBufferLike>`,
 * which is NOT assignable to WebCrypto's `BufferSource`. All typed arrays here
 * are explicitly `Uint8Array<ArrayBuffer>`.
 */

const DB_NAME    = 'nexus-vault-v1';
const STORE_NAME = 'keys';
const DB_VERSION = 1;

const RSA_ALGO: RsaHashedKeyGenParams = {
  name:           'RSA-OAEP',
  modulusLength:  2048,
  publicExponent: new Uint8Array([1, 0, 1]) as Uint8Array<ArrayBuffer>,
  hash:           'SHA-256',
};

// HKDF constants - explicitly ArrayBuffer-backed so they're usable as BufferSource
const HKDF_INFO: Uint8Array<ArrayBuffer> =
  new TextEncoder().encode('nexus-vault-key-wrapping-v1') as Uint8Array<ArrayBuffer>;

const HKDF_SALT: Uint8Array<ArrayBuffer> =
  new Uint8Array(new ArrayBuffer(32)); // all-zeros

@Injectable({ providedIn: 'root' })
export class VaultKeyService {
  readonly hasKeys   = signal(false);
  readonly publicKey = signal<string | null>(null);

  private sessionPrivateKey:  CryptoKey | null = null;
  private sessionWrappingKey: CryptoKey | null = null;

  private db: IDBDatabase | null = null;

  // IndexedDB helpers

  private async openDB(): Promise<IDBDatabase> {
    if (this.db) return this.db;
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE_NAME);
      req.onsuccess  = () => { this.db = req.result; resolve(req.result); };
      req.onerror    = () => reject(req.error);
      req.onblocked  = () => reject(new Error('IndexedDB blocked'));
    });
  }

  private async idbGet<T = unknown>(key: string): Promise<T | undefined> {
    const db = await this.openDB();
    return new Promise((resolve, reject) => {
      const req = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(key);
      req.onsuccess = () => resolve(req.result as T);
      req.onerror   = () => reject(req.error);
    });
  }

  /**
   * Retrieves a stored value as a guaranteed `ArrayBuffer`.
   * `ArrayBuffer.prototype.slice` always returns a plain `ArrayBuffer`
   * (never SharedArrayBuffer), making it safe for WebCrypto.
   */
  private async idbGetBuffer(key: string): Promise<ArrayBuffer | undefined> {
    const raw = await this.idbGet<ArrayBuffer>(key);
    if (raw == null) return undefined;
    // slice(0) → new ArrayBuffer (never SharedArrayBuffer)
    return (raw as ArrayBuffer).slice(0);
  }

  /**
   * Retrieves a stored `number[]` IV and returns `Uint8Array<ArrayBuffer>`.
   * Storing as `number[]` avoids the `ArrayBufferLike` ambiguity entirely;
   * `new Uint8Array(new ArrayBuffer(n))` is the only safe constructor for TS 5.6+.
   */
  private async idbGetIv(key: string): Promise<Uint8Array<ArrayBuffer> | undefined> {
    const arr = await this.idbGet<number[]>(key);
    if (arr == null) return undefined;
    const buf = new ArrayBuffer(arr.length);
    const u8  = new Uint8Array(buf) as Uint8Array<ArrayBuffer>;
    u8.set(arr);
    return u8;
  }

  private async idbSet(key: string, value: unknown): Promise<void> {
    const db = await this.openDB();
    return new Promise((resolve, reject) => {
      const req = db.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME).put(value, key);
      req.onsuccess = () => resolve();
      req.onerror   = () => reject(req.error);
    });
  }

  private async idbDelete(key: string): Promise<void> {
    const db = await this.openDB();
    return new Promise((resolve, reject) => {
      const req = db.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME).delete(key);
      req.onsuccess = () => resolve();
      req.onerror   = () => reject(req.error);
    });
  }

  private storageKey(userId: string, suffix: string): string {
    return `u:${userId}:${suffix}`;
  }

  // HKDF wrapping key derivation

  private async deriveWrappingKey(sessionKey: string): Promise<CryptoKey> {
    // Decode hex -> explicit ArrayBuffer-backed Uint8Array
    const buf      = new ArrayBuffer(sessionKey.length / 2);
    const keyBytes = new Uint8Array(buf) as Uint8Array<ArrayBuffer>;
    for (let i = 0; i < keyBytes.length; i++) {
      keyBytes[i] = parseInt(sessionKey.slice(i * 2, i * 2 + 2), 16);
    }

    const baseKey = await crypto.subtle.importKey(
      'raw', keyBytes, 'HKDF', false, ['deriveKey'],
    );

    return crypto.subtle.deriveKey(
      { name: 'HKDF', hash: 'SHA-256', salt: HKDF_SALT, info: HKDF_INFO },
      baseKey,
      { name: 'AES-GCM', length: 256 },
      false,
      ['wrapKey', 'unwrapKey'],
    );
  }

  // Session initialisation

  async initSession(
    userId:     string,
    sessionKey: string,
  ): Promise<{ publicKeyB64: string; isNew: boolean }> {
    const wrappingKey = await this.deriveWrappingKey(sessionKey);
    this.sessionWrappingKey = wrappingKey;

    // Fetch stored material with proper ArrayBuffer types
    const wrappedBuf   = await this.idbGetBuffer(this.storageKey(userId, 'priv'));
    const iv           = await this.idbGetIv(this.storageKey(userId, 'iv'));
    const storedPubB64 = await this.idbGet<string>(this.storageKey(userId, 'pub'));

    if (wrappedBuf && iv && storedPubB64) {
      try {
        const privateKey = await crypto.subtle.unwrapKey(
          'pkcs8',
          wrappedBuf,           // ArrayBuffer - directly assignable to BufferSource ✓
          wrappingKey,
          { name: 'AES-GCM', iv },   // iv: Uint8Array<ArrayBuffer> ✓
          RSA_ALGO,
          false,
          ['decrypt'] as KeyUsage[],
        );
        this.sessionPrivateKey = privateKey;
        this.publicKey.set(storedPubB64);
        this.hasKeys.set(true);
        return { publicKeyB64: storedPubB64, isNew: false };
      } catch {
        // Unwrap failed — password/sessionKey changed on another device.
        // Fall through to generate a fresh keypair.
      }
    }

    return this.generateAndStore(userId, wrappingKey);
  }

  async generateFreshKeyPair(userId: string): Promise<string> {
    if (!this.sessionWrappingKey) {
      throw new Error('Session not initialised — sign out and sign back in first.');
    }
    const { publicKeyB64 } = await this.generateAndStore(userId, this.sessionWrappingKey);
    return publicKeyB64;
  }

  // Accessors

  getPrivateKey(): CryptoKey | null { return this.sessionPrivateKey; }
  getPublicKeyB64(): string | null  { return this.publicKey(); }

  async hasStoredKeyPair(userId: string): Promise<boolean> {
    return !!(await this.idbGet(this.storageKey(userId, 'priv')));
  }

  clearSession(): void {
    this.sessionPrivateKey  = null;
    this.sessionWrappingKey = null;
    this.hasKeys.set(false);
    this.publicKey.set(null);
  }

  async clearStoredKeys(userId: string): Promise<void> {
    await Promise.all([
      this.idbDelete(this.storageKey(userId, 'priv')),
      this.idbDelete(this.storageKey(userId, 'iv')),
      this.idbDelete(this.storageKey(userId, 'pub')),
    ]);
    this.clearSession();
  }

  // ── Private ────────────────────────────────────────────────────────────────

  private async generateAndStore(
    userId:      string,
    wrappingKey: CryptoKey,
  ): Promise<{ publicKeyB64: string; isNew: true }> {
    const keyPair = await crypto.subtle.generateKey(RSA_ALGO, true, ['encrypt', 'decrypt']);

    // Export public key → base64 SPKI
    const pubSpki = await crypto.subtle.exportKey('spki', keyPair.publicKey);
    const pubB64  = btoa(String.fromCharCode(...new Uint8Array(pubSpki)));

    // Create IV with explicit ArrayBuffer (not ArrayBufferLike)
    const ivBuf = new ArrayBuffer(12);
    const iv    = new Uint8Array(ivBuf) as Uint8Array<ArrayBuffer>;
    crypto.getRandomValues(iv);

    // wrapKey returns ArrayBuffer
    const wrappedPriv: ArrayBuffer = await crypto.subtle.wrapKey(
      'pkcs8', keyPair.privateKey, wrappingKey, { name: 'AES-GCM', iv },
    );

    await this.idbSet(this.storageKey(userId, 'priv'), wrappedPriv);
    // Store IV as number[] — clean round-trip with no ArrayBufferLike ambiguity
    await this.idbSet(this.storageKey(userId, 'iv'),   Array.from(iv));
    await this.idbSet(this.storageKey(userId, 'pub'),  pubB64);

    // Re-import private key as non-extractable for session
    const privPkcs8    = await crypto.subtle.exportKey('pkcs8', keyPair.privateKey);
    const sessionPriv  = await crypto.subtle.importKey(
      'pkcs8', privPkcs8, RSA_ALGO, false, ['decrypt'],
    );

    this.sessionPrivateKey = sessionPriv;
    this.publicKey.set(pubB64);
    this.hasKeys.set(true);

    return { publicKeyB64: pubB64, isNew: true };
  }
}
