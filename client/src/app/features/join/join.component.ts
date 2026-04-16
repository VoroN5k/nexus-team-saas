import { Component, OnInit, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { WorkspaceService } from '../../core/services/workspace.service';
import { AuthService } from '../../core/services/auth.service';

@Component({
  selector: 'app-join',
  standalone: true,
  template: `
    <div class="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800 flex items-center justify-center p-4">
      <div class="w-full max-w-md text-center">
        <div class="inline-flex items-center justify-center w-14 h-14 bg-indigo-600 rounded-2xl mb-6">
          <svg class="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
              d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z"/>
          </svg>
        </div>

        @if (status() === 'loading') {
          <h1 class="text-2xl font-bold text-white mb-2">Joining workspace…</h1>
          <p class="text-slate-400 mb-6">Verifying your invite link</p>
          <div class="flex justify-center">
            <div class="w-8 h-8 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin"></div>
          </div>
        }

        @if (status() === 'success') {
          <h1 class="text-2xl font-bold text-white mb-2">You're in!</h1>
          <p class="text-slate-400 mb-6">
            Joined <span class="text-indigo-300 font-semibold">{{ workspaceName() }}</span>.
            Redirecting to your dashboard…
          </p>
          <div class="flex justify-center">
            <div class="w-8 h-8 border-2 border-green-400 border-t-transparent rounded-full animate-spin"></div>
          </div>
        }

        @if (status() === 'error') {
          <h1 class="text-2xl font-bold text-white mb-2">Invite invalid</h1>
          <p class="text-slate-400 mb-6">{{ errorMsg() }}</p>
          <button (click)="router.navigate(['/dashboard'])"
            class="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white font-semibold rounded-lg transition-colors">
            Go to dashboard
          </button>
        }

        @if (status() === 'no-token') {
          <h1 class="text-2xl font-bold text-white mb-2">No invite token</h1>
          <p class="text-slate-400 mb-6">This link is missing an invite token.</p>
          <button (click)="router.navigate(['/dashboard'])"
            class="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white font-semibold rounded-lg transition-colors">
            Go to dashboard
          </button>
        }
      </div>
    </div>
  `,
})
export class JoinComponent implements OnInit {
  status       = signal<'loading' | 'success' | 'error' | 'no-token'>('loading');
  workspaceName = signal('');
  errorMsg     = signal('');

  constructor(
    private route:   ActivatedRoute,
    readonly router: Router,
    private ws:      WorkspaceService,
    private auth:    AuthService,
  ) {}

  ngOnInit() {
    const token = this.route.snapshot.queryParamMap.get('token');

    if (!token) {
      this.status.set('no-token');
      return;
    }

    if (!this.auth.isLoggedIn()) {
      // Save token and redirect to login, then come back
      sessionStorage.setItem('pending_invite', token);
      this.router.navigate(['/login']);
      return;
    }

    this.ws.joinViaInvite(token).subscribe({
      next: (workspace) => {
        this.workspaceName.set(workspace.name);
        this.status.set('success');
        setTimeout(() => this.router.navigate(['/workspace', workspace.id]), 1500);
      },
      error: (e) => {
        const msg = e?.error?.message ?? e?.message ?? 'Invite link is expired or invalid';
        this.errorMsg.set(msg);
        this.status.set('error');
      },
    });
  }
}
