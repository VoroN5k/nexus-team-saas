import { Injectable, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { tap } from 'rxjs/operators';
import { Observable } from 'rxjs';
import { apiBase } from '../utils/api-base.util';


export interface JWTPayload {
  sub: string;
  email: string;
  firstName: string;
  lastName: string;
}


const API = `${apiBase()}/auth`;

@Injectable({ providedIn: 'root' })
export class AuthService {
  private _token = signal<string | null>(localStorage.getItem('access_token'));
  private _user  = signal<JWTPayload | null>(this.parseToken(localStorage.getItem('access_token')));

  readonly token      = this._token.asReadonly();
  readonly user       = this._user.asReadonly();
  readonly isLoggedIn = () => !!this._token();

  constructor(private http: HttpClient, private router: Router) {}

  // Legacy password auth (kept for backward compat)

  register(body: {
    email: string; password: string; confirmPassword: string;
    firstName: string; lastName: string; organizationName: string;
  }): Observable<{ accessToken: string; workspaceSlug: string }> {
    return this.http.post<{ accessToken: string; workspaceSlug: string }>(
      `${API}/register`, body, { withCredentials: true },
    ).pipe(tap(r => this.saveToken(r.accessToken)));
  }

  login(email: string, password: string): Observable<{ accessToken: string }> {
    return this.http.post<{ accessToken: string }>(
      `${API}/login`, { email, password }, { withCredentials: true },
    ).pipe(tap(r => this.saveToken(r.accessToken)));
  }

  // OPAQUE token endpoints

  /**
   * OPAQUE register-finish: create user account with the OPAQUE record
   * The access token is returned and saved here; the caller handles VaultKeyService
   */
  opaqueRegisterFinish(body: {
    email: string; registrationRecord: string;
    firstName: string; lastName: string; organizationName: string;
  }): Observable<{ accessToken: string; workspaceSlug: string }> {
    return this.http.post<{ accessToken: string; workspaceSlug: string }>(
      `${API}/opaque/register-finish`, body, { withCredentials: true },
    ).pipe(tap(r => this.saveToken(r.accessToken)));
  }

  /**
   * OPAQUE login-finish: issues JWT after server verifies the MAC
   * The access token is returned and saved here; the caller handles VaultKeyService
   */
  opaqueLoginFinish(body: {
    userIdentifier: string; nonce: string; finishLoginRequest: string;
  }): Observable<{ accessToken: string }> {
    return this.http.post<{ accessToken: string }>(
      `${API}/opaque/login-finish`, body, { withCredentials: true },
    ).pipe(tap(r => this.saveToken(r.accessToken)));
  }

  /** Upload the user's RSA public key (called after VaultKeyService.initSession) */
  uploadPublicKey(publicKey: string): Observable<void> {
    return this.http.put<void>(`${API}/me/public-key`, { publicKey });
  }

  // Shared

  refresh(): Observable<{ accessToken: string }> {
    return this.http.post<{ accessToken: string }>(
      `${API}/refresh`, {}, { withCredentials: true },
    ).pipe(tap(r => this.saveToken(r.accessToken)));
  }

  logout(): void {
    this.http.post(`${API}/logout`, {}, { withCredentials: true }).subscribe();
    this.clearToken();
    this.router.navigate(['/login']);
  }

  getSessions() {
    return this.http.get<any[]>(`${API}/sessions`, { withCredentials: true });
  }

  saveToken(token: string): void {
    localStorage.setItem('access_token', token);
    this._token.set(token);
    this._user.set(this.parseToken(token));
  }

  clearToken(): void {
    localStorage.removeItem('access_token');
    this._token.set(null);
    this._user.set(null);
  }

  private parseToken(token: string | null): JWTPayload | null {
    if (!token) return null;
    try { return JSON.parse(atob(token.split('.')[1])) as JWTPayload; }
    catch { return null; }
  }
}
