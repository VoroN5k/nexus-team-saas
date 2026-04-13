import { Component, OnInit, signal, inject } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../../core/services/auth.service';
import { WorkspaceService, Workspace } from '../../core/services/workspace.service';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [FormsModule, RouterLink],
  template: `
    <div class="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800">
      <!-- Navbar -->
      <nav class="border-b border-slate-700 px-6 py-4 flex items-center justify-between">
        <div class="flex items-center gap-3">
          <div class="w-9 h-9 bg-indigo-600 rounded-xl flex items-center justify-center">
            <svg class="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"/>
            </svg>
          </div>
          <span class="text-white font-bold text-xl">Nexus</span>
        </div>
        <div class="flex items-center gap-4">
          <span class="text-slate-400 text-sm">
            {{ user()?.firstName }} {{ user()?.lastName }}
          </span>
          <button (click)="logout()"
            class="text-sm text-slate-400 hover:text-white transition-colors px-3 py-1.5
                   border border-slate-600 rounded-lg hover:border-slate-400">
            Sign out
          </button>
        </div>
      </nav>

      <main class="max-w-5xl mx-auto px-6 py-10">
        <div class="flex items-center justify-between mb-8">
          <div>
            <h2 class="text-2xl font-bold text-white">Your Workspaces</h2>
            <p class="text-slate-400 mt-1">Select a workspace or create a new one</p>
          </div>
          <button (click)="showCreate.set(true)"
            class="flex items-center gap-2 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-500
                   text-white font-semibold rounded-lg transition-colors">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/>
            </svg>
            New workspace
          </button>
        </div>

        @if (showCreate()) {
          <div class="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
            <div class="bg-slate-800 border border-slate-700 rounded-2xl p-6 w-full max-w-md shadow-2xl">
              <h3 class="text-lg font-bold text-white mb-4">New Workspace</h3>
              @if (createError()) {
                <div class="mb-3 p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-sm">
                  {{ createError() }}
                </div>
              }
              <form (ngSubmit)="create()" #cf="ngForm">
                <div class="space-y-3">
                  <div>
                    <label class="block text-sm font-medium text-slate-300 mb-1">Name</label>
                    <input type="text" name="name" [(ngModel)]="newName" required minlength="3"
                      class="w-full px-4 py-2.5 bg-slate-900 border border-slate-600 rounded-lg text-white
                             placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      placeholder="My Team"/>
                  </div>
                  <div>
                    <label class="block text-sm font-medium text-slate-300 mb-1">Slug (URL)</label>
                    <input type="text" name="slug" [(ngModel)]="newSlug" required pattern="[a-z0-9-]+"
                      class="w-full px-4 py-2.5 bg-slate-900 border border-slate-600 rounded-lg text-white
                             placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      placeholder="my-team"/>
                    <p class="text-slate-500 text-xs mt-1">Only lowercase letters, numbers, hyphens</p>
                  </div>
                </div>
                <div class="flex gap-3 mt-5">
                  <button type="button" (click)="showCreate.set(false)"
                    class="flex-1 py-2.5 border border-slate-600 text-slate-300 rounded-lg hover:border-slate-400 transition-colors">
                    Cancel
                  </button>
                  <button type="submit" [disabled]="creating() || cf.invalid"
                    class="flex-1 py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-semibold rounded-lg transition-colors">
                    {{ creating() ? 'Creating…' : 'Create' }}
                  </button>
                </div>
              </form>
            </div>
          </div>
        }

        @if (loading()) {
          <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            @for (_ of [1,2,3]; track $index) {
              <div class="bg-slate-800 border border-slate-700 rounded-2xl p-6 animate-pulse">
                <div class="h-5 bg-slate-700 rounded w-2/3 mb-3"></div>
                <div class="h-4 bg-slate-700 rounded w-1/3"></div>
              </div>
            }
          </div>
        }

        @if (!loading()) {
          @if (workspaces().length === 0) {
            <div class="text-center py-20">
              <div class="w-16 h-16 bg-slate-800 rounded-2xl flex items-center justify-center mx-auto mb-4">
                <svg class="w-8 h-8 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"
                    d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"/>
                </svg>
              </div>
              <p class="text-slate-400 text-lg">No workspaces yet</p>
              <p class="text-slate-500 text-sm mt-1">Create one to get started</p>
            </div>
          } @else {
            <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              @for (ws of workspaces(); track ws.id) {
                <a [routerLink]="['/workspace', ws.id]"
                  class="group bg-slate-800 border border-slate-700 hover:border-indigo-500 rounded-2xl p-6
                         transition-all cursor-pointer block">
                  <div class="flex items-start justify-between mb-4">
                    <div class="w-10 h-10 bg-indigo-600/20 rounded-xl flex items-center justify-center
                                group-hover:bg-indigo-600/30 transition-colors">
                      <span class="text-indigo-400 font-bold text-lg">{{ ws.name.charAt(0).toUpperCase() }}</span>
                    </div>
                    <span class="text-xs px-2 py-1 rounded-full font-medium"
                      [class]="ws.myRole === 'OWNER' ? 'bg-amber-500/20 text-amber-400'
                               : ws.myRole === 'ADMIN'  ? 'bg-blue-500/20 text-blue-400'
                               : 'bg-slate-700 text-slate-400'">
                      {{ ws.myRole }}
                    </span>
                  </div>
                  <h3 class="text-white font-semibold text-lg group-hover:text-indigo-300 transition-colors">
                    {{ ws.name }}
                  </h3>
                  <p class="text-slate-500 text-sm mt-1">/{{ ws.slug }}</p>
                  <div class="flex gap-4 mt-4 text-slate-400 text-sm">
                    <span class="flex items-center gap-1">
                      <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                          d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z"/>
                      </svg>
                      {{ ws._count.members }}
                    </span>
                    <span class="flex items-center gap-1">
                      <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                          d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"/>
                      </svg>
                      {{ ws._count.tasks }}
                    </span>
                  </div>
                </a>
              }
            </div>
          }
        }
      </main>
    </div>
  `,
})
export class DashboardComponent implements OnInit {

  private auth             = inject(AuthService);
  private workspaceService = inject(WorkspaceService);
  private router           = inject(Router);


  readonly user = this.auth.user;

  workspaces  = signal<Workspace[]>([]);
  loading     = signal(true);
  showCreate  = signal(false);
  creating    = signal(false);
  createError = signal('');
  newName     = '';
  newSlug     = '';

  ngOnInit() { this.load(); }

  load() {
    this.loading.set(true);
    this.workspaceService.getAll().subscribe({
      next: (ws) => { this.workspaces.set(ws); this.loading.set(false); },
      error: ()   => this.loading.set(false),
    });
  }

  create() {
    if (this.creating()) return;
    this.createError.set('');
    this.creating.set(true);
    this.workspaceService.create(this.newName, this.newSlug).subscribe({
      next: (ws) => {
        this.showCreate.set(false);
        this.newName = '';
        this.newSlug = '';
        this.creating.set(false);
        this.router.navigate(['/workspace', ws.id]);
      },
      error: (e) => {
        const msg = e?.error?.message;
        this.createError.set(Array.isArray(msg) ? msg.join(', ') : (msg ?? 'Failed to create workspace'));
        this.creating.set(false);
      },
    });
  }

  logout() { this.auth.logout(); }
}