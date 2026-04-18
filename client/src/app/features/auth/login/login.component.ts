import { Component, signal, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { AuthService } from '../../../core/services/auth.service';
import { OpaqueClientService } from '../../../core/services/opaque.service';
import { VaultKeyService } from '../../../core/services/vault-key.service';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [FormsModule, RouterLink],
  template: `
    <div class="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800 flex items-center justify-center p-4">
      <div class="w-full max-w-md">
        <div class="text-center mb-8">
          <div class="inline-flex items-center justify-center w-14 h-14 bg-indigo-600 rounded-2xl mb-4">
            <svg class="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                    d="M13 10V3L4 14h7v7l9-11h-7z"/>
            </svg>
          </div>
          <h1 class="text-3xl font-bold text-white">Nexus</h1>
          <p class="text-slate-400 mt-1">Sign in to your workspace</p>
        </div>

        <div class="bg-slate-800 border border-slate-700 rounded-2xl p-8 shadow-2xl">
          @if (error()) {
            <div class="mb-4 p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-sm">
              {{ error() }}
            </div>
          }

          @if (loading()) {
            <div class="mb-4 p-3 bg-indigo-500/10 border border-indigo-500/30 rounded-lg flex items-center gap-3">
              <div class="w-4 h-4 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin shrink-0"></div>
              <p class="text-indigo-300 text-sm">{{ stepLabel() }}</p>
            </div>
          }

          <form (ngSubmit)="submit()" #f="ngForm">
            <div class="space-y-4">
              <div>
                <label class="block text-sm font-medium text-slate-300 mb-1">Email</label>
                <input
                  type="email" name="email" [(ngModel)]="email" required
                  [disabled]="loading()"
                  class="w-full px-4 py-2.5 bg-slate-900 border border-slate-600 rounded-lg text-white
                         placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500
                         disabled:opacity-50"
                  placeholder="you@example.com"
                />
              </div>

              <div>
                <label class="block text-sm font-medium text-slate-300 mb-1">Password</label>
                <input
                  type="password" name="password" [(ngModel)]="password" required minlength="6"
                  [disabled]="loading()"
                  class="w-full px-4 py-2.5 bg-slate-900 border border-slate-600 rounded-lg text-white
                         placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500
                         disabled:opacity-50"
                  placeholder="••••••••"
                />
              </div>
            </div>

            <button
              type="submit"
              [disabled]="loading() || f.invalid"
              class="mt-6 w-full py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50
                     disabled:cursor-not-allowed text-white font-semibold rounded-lg transition-colors cursor-pointer"
            >
              {{ loading() ? 'Signing in…' : 'Sign in' }}
            </button>
          </form>

          <div class="mt-5 flex items-center justify-center gap-2 text-slate-500 text-xs">
            <svg class="w-3.5 h-3.5 text-green-500" fill="currentColor" viewBox="0 0 20 20">
              <path fill-rule="evenodd"
                    d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z"
                    clip-rule="evenodd"/>
            </svg>
            Password never leaves this browser (OPAQUE protocol)
          </div>

          <p class="mt-4 text-center text-slate-400 text-sm">
            Don't have an account?
            <a routerLink="/register" class="text-indigo-400 hover:text-indigo-300 font-medium">Create one</a>
          </p>
        </div>
      </div>
    </div>
  `,
})
export class LoginComponent {
  email    = '';
  password = '';
  loading  = signal(false);
  error    = signal('');
  private _step = signal(0);

  readonly stepLabel = () => [
    '',
    'Performing zero-knowledge handshake…',  // 1
    'Verifying credentials…',                // 2
    'Initialising vault keys…',              // 3
  ][this._step()];

  private auth        = inject(AuthService);
  private opaque      = inject(OpaqueClientService);
  private vaultKeySvc = inject(VaultKeyService);
  private router      = inject(Router);

  async submit(): Promise<void> {
    if (this.loading()) return;
    this.error.set('');
    this.loading.set(true);

    try {
      await this.loginWithOpaque();
    } catch (err: any) {
      // If server returns 401 because user has no opaqueRecord (legacy account),
      // fall back to classic password login
      if (err?.status === 401 || err?.message === 'Invalid credentials') {
        try {
          await this.loginLegacy();
          return;
        } catch (legacyErr: any) {
          this.error.set(legacyErr?.error?.message ?? 'Invalid credentials');
        }
      } else {
        this.error.set(err?.error?.message ?? err?.message ?? 'Sign-in failed');
      }
      this.loading.set(false);
      this._step.set(0);
    }
  }

  // OPAQUE login

  private async loginWithOpaque(): Promise<void> {
    // Rounds 1+2 in one call - returns only if credentials are correct
    this._step.set(1);
    const { finishLoginRequest, nonce, sessionKey } =
      await this.opaque.loginOpaque(this.email, this.password);

    // Confirm with server → get JWT
    this._step.set(2);
    await firstValueFrom(
      this.auth.opaqueLoginFinish({
        userIdentifier:     this.email,
        nonce,
        finishLoginRequest,
      }),
    );

    // Initialise vault keys with sessionKey (unwrap from IDB or generate fresh)
    this._step.set(3);
    const userId = this.auth.user()?.sub;
    if (userId) {
      const { publicKeyB64, isNew } =
        await this.vaultKeySvc.initSession(userId, sessionKey);

      if (isNew) {
        // New device — upload fresh public key, vault rotation will be detected
        await firstValueFrom(this.auth.uploadPublicKey(publicKeyB64));
      }
    }

    // sessionKey is now out of scope
    this.router.navigate(['/dashboard']);
  }

  // Legacy password login (migration path for pre-OPAQUE accounts)

  private async loginLegacy(): Promise<void> {
    await firstValueFrom(this.auth.login(this.email, this.password));
    // No sessionKey available — vault tab will show "sign back in to init keys"
    this.router.navigate(['/dashboard']);
  }
}
