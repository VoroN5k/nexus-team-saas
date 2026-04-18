import { Component, signal, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { AuthService } from '../../../core/services/auth.service';
import { OpaqueClientService } from '../../../core/services/opaque.service';
import { VaultKeyService } from '../../../core/services/vault-key.service';

@Component({
  selector: 'app-register',
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
          <p class="text-slate-400 mt-1">Create your account & workspace</p>
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
            <div class="grid grid-cols-2 gap-3 mb-3">
              <div>
                <label class="block text-sm font-medium text-slate-300 mb-1">First name</label>
                <input type="text" name="firstName" [(ngModel)]="form.firstName" required minlength="3"
                       [disabled]="loading()"
                       class="w-full px-3 py-2.5 bg-slate-900 border border-slate-600 rounded-lg text-white
                         placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50"
                       placeholder="John"/>
              </div>
              <div>
                <label class="block text-sm font-medium text-slate-300 mb-1">Last name</label>
                <input type="text" name="lastName" [(ngModel)]="form.lastName" required minlength="3"
                       [disabled]="loading()"
                       class="w-full px-3 py-2.5 bg-slate-900 border border-slate-600 rounded-lg text-white
                         placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50"
                       placeholder="Doe"/>
              </div>
            </div>

            <div class="space-y-3">
              <div>
                <label class="block text-sm font-medium text-slate-300 mb-1">Email</label>
                <input type="email" name="email" [(ngModel)]="form.email" required
                       [disabled]="loading()"
                       class="w-full px-4 py-2.5 bg-slate-900 border border-slate-600 rounded-lg text-white
                         placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50"
                       placeholder="you@example.com"/>
              </div>

              <div>
                <label class="block text-sm font-medium text-slate-300 mb-1">Organization name</label>
                <input type="text" name="organizationName" [(ngModel)]="form.organizationName" required minlength="3"
                       [disabled]="loading()"
                       class="w-full px-4 py-2.5 bg-slate-900 border border-slate-600 rounded-lg text-white
                         placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50"
                       placeholder="Acme Inc."/>
              </div>

              <div>
                <label class="block text-sm font-medium text-slate-300 mb-1">Password</label>
                <input type="password" name="password" [(ngModel)]="form.password" required minlength="6"
                       [disabled]="loading()"
                       class="w-full px-4 py-2.5 bg-slate-900 border border-slate-600 rounded-lg text-white
                         placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50"
                       placeholder="Min. 6 characters"/>
              </div>

              <div>
                <label class="block text-sm font-medium text-slate-300 mb-1">Confirm password</label>
                <input type="password" name="confirmPassword" [(ngModel)]="form.confirmPassword" required minlength="6"
                       [disabled]="loading()"
                       class="w-full px-4 py-2.5 bg-slate-900 border border-slate-600 rounded-lg text-white
                         placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50"
                       placeholder="Repeat password"/>
              </div>
            </div>

            <button type="submit" [disabled]="loading() || f.invalid"
                    class="mt-6 w-full py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50
                     disabled:cursor-not-allowed text-white font-semibold rounded-lg transition-colors">
              {{ loading() ? 'Creating account…' : 'Create account' }}
            </button>
          </form>

          <div class="mt-5 flex items-center justify-center gap-2 text-slate-500 text-xs">
            <svg class="w-3.5 h-3.5 text-green-500" fill="currentColor" viewBox="0 0 20 20">
              <path fill-rule="evenodd"
                    d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z"
                    clip-rule="evenodd"/>
            </svg>
            Password stored using OPAQUE — server never sees it
          </div>

          <p class="mt-4 text-center text-slate-400 text-sm">
            Already have an account?
            <a routerLink="/login" class="text-indigo-400 hover:text-indigo-300 font-medium">Sign in</a>
          </p>
        </div>
      </div>
    </div>
  `,
})
export class RegisterComponent {
  form = {
    email: '', password: '', confirmPassword: '',
    firstName: '', lastName: '', organizationName: '',
  };
  loading  = signal(false);
  error    = signal('');
  private _step = signal(0);

  readonly stepLabel = () => [
    '',
    'Creating zero-knowledge password envelope…',  // 1
    'Registering your account…',                   // 2
    'Finalising login & deriving keys…',            // 3
    'Generating vault encryption keys…',            // 4
  ][this._step()];

  private auth        = inject(AuthService);
  private opaque      = inject(OpaqueClientService);
  private vaultKeySvc = inject(VaultKeyService);
  private router      = inject(Router);

  async submit(): Promise<void> {
    if (this.loading()) return;
    if (this.form.password !== this.form.confirmPassword) {
      this.error.set('Passwords do not match');
      return;
    }

    this.error.set('');
    this.loading.set(true);

    try {
      // Step 1: OPAQUE registration exchange (2 HTTP calls)
      this._step.set(1);
      const { registrationRecord } =
        await this.opaque.registerOpaque(this.form.email, this.form.password);

      // Step 2: Create the user account on the server
      this._step.set(2);
      await firstValueFrom(
        this.auth.opaqueRegisterFinish({
          email:            this.form.email,
          registrationRecord,
          firstName:        this.form.firstName,
          lastName:         this.form.lastName,
          organizationName: this.form.organizationName,
        }),
      );
      // JWT is now saved by AuthService; auth.user() is populated

      // Step 3: Login to get sessionKey (registration has no sessionKey)
      // finishLoginRequest is sent to server; sessionKey stays client-only
      this._step.set(3);
      const { finishLoginRequest, nonce, sessionKey } =
        await this.opaque.loginOpaque(this.form.email, this.form.password);

      await firstValueFrom(
        this.auth.opaqueLoginFinish({ userIdentifier: this.form.email, nonce, finishLoginRequest }),
      );
      // JWT refreshed (same user); sessionKey is the wrapping material

      // Step 4: Generate vault keypair, wrap with sessionKey, store IDB
      this._step.set(4);
      const userId = this.auth.user()?.sub;
      if (userId) {
        const { publicKeyB64, isNew } =
          await this.vaultKeySvc.initSession(userId, sessionKey);

        if (isNew) {
          await firstValueFrom(this.auth.uploadPublicKey(publicKeyB64));
        }
      }

      // sessionKey is now out of scope - GC collects it
      this.router.navigate(['/dashboard']);

    } catch (e: any) {
      const msg = e?.error?.message;
      this.error.set(Array.isArray(msg) ? msg.join(', ') : (msg ?? e?.message ?? 'Registration failed'));
      this.loading.set(false);
      this._step.set(0);
    }
  }
}
