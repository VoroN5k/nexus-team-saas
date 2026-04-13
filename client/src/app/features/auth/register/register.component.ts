import { Component, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../../core/services/auth.service';

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
          @if (success()) {
            <div class="mb-4 p-3 bg-green-500/10 border border-green-500/30 rounded-lg text-green-400 text-sm">
              Registered! Redirecting…
            </div>
          }

          <form (ngSubmit)="submit()" #f="ngForm">
            <div class="grid grid-cols-2 gap-3 mb-3">
              <div>
                <label class="block text-sm font-medium text-slate-300 mb-1">First name</label>
                <input type="text" name="firstName" [(ngModel)]="form.firstName" required minlength="3"
                  class="w-full px-3 py-2.5 bg-slate-900 border border-slate-600 rounded-lg text-white
                         placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  placeholder="John"/>
              </div>
              <div>
                <label class="block text-sm font-medium text-slate-300 mb-1">Last name</label>
                <input type="text" name="lastName" [(ngModel)]="form.lastName" required minlength="3"
                  class="w-full px-3 py-2.5 bg-slate-900 border border-slate-600 rounded-lg text-white
                         placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  placeholder="Doe"/>
              </div>
            </div>

            <div class="space-y-3">
              <div>
                <label class="block text-sm font-medium text-slate-300 mb-1">Email</label>
                <input type="email" name="email" [(ngModel)]="form.email" required
                  class="w-full px-4 py-2.5 bg-slate-900 border border-slate-600 rounded-lg text-white
                         placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  placeholder="you@example.com"/>
              </div>

              <div>
                <label class="block text-sm font-medium text-slate-300 mb-1">Organization name</label>
                <input type="text" name="organizationName" [(ngModel)]="form.organizationName" required minlength="3"
                  class="w-full px-4 py-2.5 bg-slate-900 border border-slate-600 rounded-lg text-white
                         placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  placeholder="Acme Inc."/>
              </div>

              <div>
                <label class="block text-sm font-medium text-slate-300 mb-1">Password</label>
                <input type="password" name="password" [(ngModel)]="form.password" required minlength="6"
                  class="w-full px-4 py-2.5 bg-slate-900 border border-slate-600 rounded-lg text-white
                         placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  placeholder="Min. 6 characters"/>
              </div>

              <div>
                <label class="block text-sm font-medium text-slate-300 mb-1">Confirm password</label>
                <input type="password" name="confirmPassword" [(ngModel)]="form.confirmPassword" required minlength="6"
                  class="w-full px-4 py-2.5 bg-slate-900 border border-slate-600 rounded-lg text-white
                         placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  placeholder="Repeat password"/>
              </div>
            </div>

            <button type="submit" [disabled]="loading() || f.invalid"
              class="mt-6 w-full py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed
                     text-white font-semibold rounded-lg transition-colors">
              {{ loading() ? 'Creating account…' : 'Create account' }}
            </button>
          </form>

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
  form = { email: '', password: '', confirmPassword: '', firstName: '', lastName: '', organizationName: '' };
  loading = signal(false);
  error   = signal('');
  success = signal(false);

  constructor(private auth: AuthService, private router: Router) {}

  submit() {
    if (this.loading()) return;
    if (this.form.password !== this.form.confirmPassword) {
      this.error.set('Passwords do not match');
      return;
    }
    this.error.set('');
    this.loading.set(true);

    this.auth.register(this.form).subscribe({
      next: (r) => {
        this.success.set(true);
        setTimeout(() => this.router.navigate(['/dashboard']), 500);
      },
      error: (e) => {
        const msg = e?.error?.message;
        this.error.set(Array.isArray(msg) ? msg.join(', ') : (msg ?? 'Registration failed'));
        this.loading.set(false);
      },
    });
  }
}