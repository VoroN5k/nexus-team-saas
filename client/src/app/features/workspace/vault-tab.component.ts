import {
  Component, OnInit, OnDestroy, Input, signal, computed, inject,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { VaultService, Vault, AccessRequest, VaultNotification } from '../../core/services/vault.service';
import { WorkspaceService, Member } from '../../core/services/workspace.service';
import { AuthService } from '../../core/services/auth.service';
import { Router } from '@angular/router';
import { forkJoin } from 'rxjs';

@Component({
  selector: 'app-vault-tab',
  standalone: true,
  imports: [FormsModule],
  template: `
    <div class="flex-1 p-6 max-w-5xl mx-auto w-full">

      <!-- ── Key Setup Banner ───────────────────────────────────────────────── -->
      @if (!hasKeys() && !settingUpKeys()) {
        <div class="mb-6 relative overflow-hidden rounded-2xl border border-amber-500/30
                bg-gradient-to-r from-amber-950/60 to-slate-900 p-5 flex items-start gap-4">
          <div class="mt-0.5 w-10 h-10 rounded-xl bg-amber-500/20 flex items-center justify-center shrink-0">
            <svg class="w-5 h-5 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                    d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z"/>
            </svg>
          </div>
          <div class="flex-1">
            <p class="text-amber-300 font-semibold text-sm">Vault keys not set up</p>
            <p class="text-slate-400 text-sm mt-1">
              Generate your personal encryption key pair to hold or create vault secrets.
              Your private key never leaves this browser.
            </p>
          </div>
          <button (click)="setupKeys()"
                  class="shrink-0 px-4 py-2 bg-amber-500 hover:bg-amber-400 text-black font-semibold
               text-sm rounded-lg transition-colors">
            Generate Keys
          </button>
        </div>
      }

      @if (settingUpKeys()) {
        <div class="mb-6 rounded-2xl border border-indigo-500/30 bg-indigo-950/40 p-5 flex items-center gap-3">
          <div class="w-5 h-5 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin"></div>
          <p class="text-indigo-300 text-sm">Generating RSA-2048 key pair…</p>
        </div>
      }

      <!-- ── Share Submit Error ─────────────────────────────────────────────── -->
      @if (shareSubmitError()) {
        <div class="mb-4 rounded-2xl border border-red-500/30 bg-red-950/40 p-4 flex items-start gap-3">
          <svg class="w-5 h-5 text-red-400 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                  d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/>
          </svg>
          <div class="flex-1">
            <p class="text-red-300 font-semibold text-sm">Cannot submit share</p>
            <p class="text-slate-400 text-sm mt-1">{{ shareSubmitError() }}</p>
          </div>
          <button (click)="shareSubmitError.set('')" class="text-slate-500 hover:text-white shrink-0">✕</button>
        </div>
      }

      <!-- ── Holder Notifications ──────────────────────────────────────────── -->
      @for (notif of notifications(); track notif.accessRequestId) {
        <div class="mb-4 rounded-2xl border border-violet-500/30 bg-violet-950/40 p-4 flex items-start gap-4">
          <div class="w-9 h-9 rounded-xl bg-violet-500/20 flex items-center justify-center shrink-0">
            <svg class="w-4 h-4 text-violet-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                    d="M8 11V7a4 4 0 118 0m-4 8v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2z"/>
            </svg>
          </div>
          <div class="flex-1">
            <p class="text-violet-300 font-semibold text-sm">Share request</p>
            <p class="text-slate-300 text-sm mt-0.5">
              <span class="font-medium text-white">{{ notif.requesterName }}</span>
              is requesting access to <span class="font-medium text-white">{{ notif.vaultName }}</span>.
            </p>
            @if (notif.reason) {
              <p class="text-slate-400 text-xs mt-1 italic">"{{ notif.reason }}"</p>
            }
            <div class="flex gap-2 mt-3">
              <button (click)="submitHolderShare(notif)"
                      [disabled]="submittingShare() === notif.accessRequestId"
                      class="px-3 py-1.5 bg-violet-600 hover:bg-violet-500 disabled:opacity-50
                   text-white text-xs font-semibold rounded-lg transition-colors">
                {{ submittingShare() === notif.accessRequestId ? 'Submitting…' : 'Submit my share' }}
              </button>
              <button (click)="vaultService.dismissNotification(notif.accessRequestId)"
                      class="px-3 py-1.5 border border-slate-600 text-slate-400 text-xs rounded-lg hover:border-slate-400">
                Dismiss
              </button>
            </div>
          </div>
        </div>
      }

      <!-- ── Header ─────────────────────────────────────────────────────────── -->
      <div class="flex items-center justify-between mb-6">
        <div>
          <h2 class="text-xl font-bold text-white">Vault</h2>
          <p class="text-slate-400 text-sm mt-0.5">Zero-knowledge secret storage · {{ vaults().length }} secret{{ vaults().length !== 1 ? 's' : '' }}</p>
        </div>
        @if (canCreate()) {
          <button (click)="openCreate()"
                  class="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500
               text-white font-medium rounded-lg transition-colors text-sm">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/>
            </svg>
            New secret
          </button>
        }
      </div>

      <!-- ── Create Vault Modal ────────────────────────────────────────────── -->
      @if (showCreate()) {
        <div class="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
          <div class="bg-slate-900 border border-slate-700 rounded-2xl p-6 w-full max-w-lg shadow-2xl
                  max-h-[90vh] overflow-y-auto">
            <div class="flex items-center gap-3 mb-5">
              <div class="w-9 h-9 bg-indigo-600/20 rounded-xl flex items-center justify-center">
                <svg class="w-5 h-5 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                        d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zM10 11V7a2 2 0 114 0v4"/>
                </svg>
              </div>
              <h3 class="text-lg font-bold text-white">New secret</h3>
            </div>

            @if (createError()) {
              <div class="mb-4 p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-sm">
                {{ createError() }}
              </div>
            }

            <form (ngSubmit)="createVault()">
              <div class="space-y-4">
                <div>
                  <label class="block text-sm font-medium text-slate-300 mb-1">Name</label>
                  <input type="text" [(ngModel)]="cf.name" name="name" required maxlength="100"
                         class="w-full px-4 py-2.5 bg-slate-800 border border-slate-600 rounded-lg text-white
                       placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                         placeholder="Production DB Password"/>
                </div>

                <div>
                  <label class="block text-sm font-medium text-slate-300 mb-1">Description</label>
                  <input type="text" [(ngModel)]="cf.description" name="desc" maxlength="500"
                         class="w-full px-4 py-2.5 bg-slate-800 border border-slate-600 rounded-lg text-white
                       placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                         placeholder="Optional"/>
                </div>

                <div>
                  <label class="block text-sm font-medium text-slate-300 mb-1">
                    Secret value
                    <span class="text-slate-500 font-normal ml-1">(encrypted in-browser, never sent to server)</span>
                  </label>
                  <textarea [(ngModel)]="cf.secret" name="secret" required rows="3"
                            class="w-full px-4 py-2.5 bg-slate-800 border border-slate-600 rounded-lg text-white
                       placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500
                       font-mono text-sm resize-none"
                            placeholder="paste-secret-here"></textarea>
                </div>

                <div class="grid grid-cols-2 gap-3">
                  <div>
                    <label class="block text-sm font-medium text-slate-300 mb-1">Threshold (k)</label>
                    <input type="number" [(ngModel)]="cf.threshold" name="threshold"
                           [min]="2" [max]="cf.selectedHolders.length || 2" required
                           class="w-full px-4 py-2.5 bg-slate-800 border border-slate-600 rounded-lg text-white
                         focus:outline-none focus:ring-2 focus:ring-indigo-500"/>
                    <p class="text-slate-500 text-xs mt-1">Min shares to unlock</p>
                  </div>
                  <div class="flex items-end pb-6">
                    <p class="text-slate-400 text-sm">
                      of <span class="text-white font-bold">{{ cf.selectedHolders.length }}</span> holders
                    </p>
                  </div>
                </div>

                <div>
                  <label class="block text-sm font-medium text-slate-300 mb-2">Key holders</label>
                  <div class="space-y-2 max-h-48 overflow-y-auto pr-1">
                    @for (m of eligibleMembers(); track m.user.id) {
                      <label class="flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-colors"
                             [class]="isSelected(m.user.id)
                      ? 'border-indigo-500 bg-indigo-500/10'
                      : 'border-slate-700 hover:border-slate-500 bg-slate-800/50'">
                        <input type="checkbox" class="hidden"
                               [checked]="isSelected(m.user.id)"
                               (change)="toggleHolder(m)"/>
                        <div class="w-8 h-8 rounded-full bg-indigo-600/20 flex items-center justify-center shrink-0">
                      <span class="text-indigo-400 font-bold text-sm">
                        {{ m.user.firstName.charAt(0).toUpperCase() }}
                      </span>
                        </div>
                        <div class="flex-1 min-w-0">
                          <p class="text-white text-sm font-medium">{{ m.user.firstName }} {{ m.user.lastName }}</p>
                          <p class="text-slate-400 text-xs truncate">{{ m.user.email }}</p>
                        </div>
                        @if (!m.user.publicKey) {
                          <span class="text-xs text-amber-400 shrink-0">No vault key</span>
                        }
                        @if (isSelected(m.user.id)) {
                          <svg class="w-4 h-4 text-indigo-400 shrink-0" fill="currentColor" viewBox="0 0 20 20">
                            <path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd"/>
                          </svg>
                        }
                      </label>
                    }
                  </div>
                  @if (eligibleMembers().length === 0) {
                    <p class="text-slate-500 text-sm">No members with vault keys set up yet.</p>
                  }
                </div>
              </div>

              <div class="flex gap-3 mt-6">
                <button type="button" (click)="showCreate.set(false)"
                        class="flex-1 py-2.5 border border-slate-600 text-slate-300 rounded-lg hover:border-slate-400">
                  Cancel
                </button>
                <button type="submit" [disabled]="creating() || !canSubmitCreate()"
                        class="flex-1 py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50
                     text-white font-semibold rounded-lg transition-colors">
                  {{ creating() ? 'Encrypting & saving…' : 'Create secret' }}
                </button>
              </div>
            </form>
          </div>
        </div>
      }

      <!-- ── Vault list ─────────────────────────────────────────────────────── -->
      @if (loading()) {
        <div class="space-y-4">
          @for (_ of [1,2]; track $index) {
            <div class="bg-slate-800 border border-slate-700 rounded-2xl p-5 animate-pulse">
              <div class="h-5 bg-slate-700 rounded w-1/3 mb-2"></div>
              <div class="h-4 bg-slate-700 rounded w-1/2"></div>
            </div>
          }
        </div>
      } @else if (vaults().length === 0) {
        <div class="text-center py-20">
          <div class="w-16 h-16 bg-slate-800 border border-slate-700 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <svg class="w-8 h-8 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"
                    d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zM10 11V7a2 2 0 114 0v4"/>
            </svg>
          </div>
          <p class="text-slate-400">No secrets stored yet</p>
          <p class="text-slate-500 text-sm mt-1">Create a secret to split it between key holders</p>
        </div>
      } @else {
        <div class="space-y-4">
          @for (vault of vaults(); track vault.id) {
            <div class="bg-slate-800 border rounded-2xl p-5 transition-colors"
                 [class]="unlockedSecrets().has(vault.id)
            ? 'border-green-500/50'
            : activeRequest(vault.id) ? 'border-amber-500/40' : 'border-slate-700'">

              <div class="flex items-start justify-between gap-4">
                <div class="flex items-start gap-3 min-w-0">
                  <div class="mt-1 w-2.5 h-2.5 rounded-full shrink-0"
                       [class]="unlockedSecrets().has(vault.id) ? 'bg-green-400 shadow-[0_0_8px] shadow-green-400/60'
                         : activeRequest(vault.id) ? 'bg-amber-400 animate-pulse'
                         : 'bg-slate-600'"></div>
                  <div class="min-w-0">
                    <h3 class="text-white font-semibold">{{ vault.name }}</h3>
                    @if (vault.description) {
                      <p class="text-slate-400 text-sm mt-0.5">{{ vault.description }}</p>
                    }
                    <div class="flex items-center gap-3 mt-2 flex-wrap">
                  <span class="text-xs text-slate-500 bg-slate-700/60 px-2 py-0.5 rounded-full">
                    {{ vault.threshold }}-of-{{ vault.totalShares }}
                  </span>
                      @for (s of vault.shares.slice(0, 5); track s.id) {
                        <div class="w-6 h-6 rounded-full bg-indigo-600/20 flex items-center justify-center
                                border border-slate-700" [title]="s.holder.firstName + ' ' + s.holder.lastName">
                      <span class="text-indigo-400 text-xs font-bold">
                        {{ s.holder.firstName.charAt(0) }}
                      </span>
                        </div>
                      }
                      @if (vault.shares.length > 5) {
                        <span class="text-slate-500 text-xs">+{{ vault.shares.length - 5 }}</span>
                      }
                    </div>
                  </div>
                </div>

                <div class="flex items-center gap-2 shrink-0">
              <span class="text-xs px-2.5 py-1 rounded-full font-medium"
                    [class]="unlockedSecrets().has(vault.id)
                  ? 'bg-green-500/20 text-green-400'
                  : activeRequest(vault.id) ? 'bg-amber-500/20 text-amber-400'
                  : 'bg-slate-700 text-slate-400'">
                {{ unlockedSecrets().has(vault.id) ? '🟢 Unlocked' : activeRequest(vault.id) ? '🟡 Pending' : '🔴 Locked' }}
              </span>
                  @if (canCreate()) {
                    <button (click)="deleteVault(vault)" title="Delete"
                            class="p-1.5 text-slate-500 hover:text-red-400 transition-colors">
                      <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                              d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/>
                      </svg>
                    </button>
                  }
                </div>
              </div>

              @if (unlockedSecrets().has(vault.id)) {
                <div class="mt-4 p-4 bg-green-950/40 border border-green-500/20 rounded-xl">
                  <div class="flex items-center justify-between mb-2">
                    <p class="text-green-400 text-xs font-semibold uppercase tracking-wide">Decrypted secret · clears in 5 min</p>
                    <button (click)="copySecret(vault.id)"
                            class="text-xs text-green-400 hover:text-green-300 transition-colors">
                      {{ copied() === vault.id ? 'Copied!' : 'Copy' }}
                    </button>
                  </div>
                  <pre class="text-green-300 text-sm font-mono break-all whitespace-pre-wrap">{{ unlockedSecrets().get(vault.id) }}</pre>
                </div>
              }

              @if (activeRequest(vault.id); as req) {
                @if (!unlockedSecrets().has(vault.id)) {
                  <div class="mt-4">
                    <div class="flex items-center justify-between text-xs text-slate-400 mb-1">
                      <span>Shares collected</span>
                      <span>{{ getProgress(req.id).submitted }}/{{ vault.threshold }}</span>
                    </div>
                    <div class="h-1.5 bg-slate-700 rounded-full overflow-hidden">
                      <div class="h-full bg-amber-500 rounded-full transition-all"
                           [style.width.%]="(getProgress(req.id).submitted / vault.threshold) * 100"></div>
                    </div>
                  </div>
                }
              }

              <div class="flex gap-2 mt-4">
                @if (!unlockedSecrets().has(vault.id) && !activeRequest(vault.id)) {
                  <button (click)="requestAccess(vault)"
                          [disabled]="requestingAccess() === vault.id"
                          class="px-3 py-1.5 bg-indigo-600/20 hover:bg-indigo-600/40 border border-indigo-500/30
                       text-indigo-300 text-xs font-medium rounded-lg transition-colors">
                    {{ requestingAccess() === vault.id ? 'Requesting…' : 'Request access' }}
                  </button>
                }
                @if (activeRequest(vault.id)) {
                  <button (click)="cancelRequest(vault, activeRequest(vault.id)!.id)"
                          class="px-3 py-1.5 border border-slate-600 text-slate-400 text-xs rounded-lg hover:border-slate-400">
                    Cancel request
                  </button>
                }
              </div>
            </div>
          }
        </div>
      }
    </div>
  `,
})
export class VaultTabComponent implements OnInit, OnDestroy {
  @Input() workspaceId!: string;
  @Input() myRole!: string;

  readonly vaultService    = inject(VaultService);
  private readonly wsSvc   = inject(WorkspaceService);
  private readonly auth    = inject(AuthService);

  vaults         = signal<Vault[]>([]);
  members        = signal<Member[]>([]);
  accessRequests = signal<AccessRequest[]>([]);
  loading        = signal(true);
  showCreate     = signal(false);
  creating       = signal(false);
  createError    = signal('');
  settingUpKeys  = signal(false);
  hasKeys        = signal(false);
  submittingShare  = signal<string | null>(null);
  requestingAccess = signal<string | null>(null);
  copied           = signal<string | null>(null);
  shareSubmitError = signal('');

  cf = {
    name: '', description: '', secret: '', threshold: 2,
    selectedHolders: [] as Array<{ id: string; publicKey: string }>,
  };

  readonly notifications   = this.vaultService.pendingNotifications;
  readonly unlockedSecrets = this.vaultService.unlockedSecrets;

  readonly canCreate = computed(() => this.myRole === 'OWNER' || this.myRole === 'ADMIN');

  readonly eligibleMembers = computed(() =>
    this.members().filter(m => m.user.publicKey),
  );

  ngOnInit() {
    if (!this.auth.isLoggedIn()) {
      try { inject(Router).navigate(['/login']); } catch (e) { /* noop */ }
      return;
    }

    this.hasKeys.set(this.vaultService.hasKeyPair());
    this.vaultService.connectSocket(this.workspaceId);
    this.load();
  }

  ngOnDestroy() {
    this.vaultService.disconnectSocket();
  }

  private load() {
    this.loading.set(true);

    // Load members and vaults in parallel, then load requests for each vault
    forkJoin({
      members: this.wsSvc.getMembers(this.workspaceId),
      vaults:  this.vaultService.listVaults(this.workspaceId),
    }).subscribe({
      next: ({ members, vaults }) => {
        this.members.set(members);
        this.vaults.set(vaults);
        this.loading.set(false);

        // Load access requests for all vaults, then restore notifications
        if (vaults.length === 0) return;

        let pending = vaults.length;
        const allRequests: AccessRequest[] = [];

        for (const v of vaults) {
          this.vaultService.listAccessRequests(this.workspaceId, v.id).subscribe({
            next: reqs => {
              const pendingReqs = reqs.filter(r => r && r.status === 'PENDING');
              allRequests.push(...pendingReqs);

              const localVault = this.vaults().find(lv => lv.id === v.id);
              const fallbackThreshold = localVault?.threshold ?? 1;

              pendingReqs.forEach(r => {
                const threshold = r.vault?.threshold ?? fallbackThreshold;
                this.vaultService.requestProgress.update(m => {
                  const next = new Map(m);
                  if (!next.has(r.id)) {
                    next.set(r.id, { submitted: r.submissions.length, threshold });
                  }
                  return next;
                });
              });

              this.accessRequests.update(all => {
                const filtered = all.filter(r => r.vaultId !== v.id);
                return [...filtered, ...pendingReqs];
              });

              pending--;
              if (pending === 0) {
                // FIX 1: After all requests loaded, restore holder notifications
                const myId = this.auth.user()?.sub ?? '';
                this.vaultService.restoreNotificationsFromRequests(
                  allRequests,
                  this.vaults(),
                  myId,
                );
              }
            },
            error: err => {
              console.warn('Failed to load access requests for vault', v.id, err);
              pending--;
            },
          });
        }
      },
      error: () => this.loading.set(false),
    });
  }

  activeRequest(vaultId: string): AccessRequest | undefined {
    return this.accessRequests().find(r => r.vaultId === vaultId && r.status === 'PENDING');
  }

  getProgress(requestId: string) {
    return this.vaultService.requestProgress().get(requestId) ?? { submitted: 0, threshold: 1 };
  }

  // Key setup

  async setupKeys() {
    this.settingUpKeys.set(true);
    try {
      await this.vaultService.ensureKeyPair();
      this.hasKeys.set(true);
      this.load();
    } catch (err) {
      console.error('Key setup failed', err);
    } finally {
      this.settingUpKeys.set(false);
    }
  }

  // Create vault

  openCreate() {
    if (!this.hasKeys()) {
      this.setupKeys().then(() => this.showCreate.set(true));
      return;
    }
    this.cf = { name: '', description: '', secret: '', threshold: 2, selectedHolders: [] };
    this.createError.set('');
    this.showCreate.set(true);
  }

  isSelected(userId: string) {
    return this.cf.selectedHolders.some(h => h.id === userId);
  }

  toggleHolder(m: Member) {
    if (!m.user.publicKey) return;
    if (this.isSelected(m.user.id)) {
      this.cf.selectedHolders = this.cf.selectedHolders.filter(h => h.id !== m.user.id);
    } else {
      this.cf.selectedHolders = [...this.cf.selectedHolders, {
        id: m.user.id, publicKey: m.user.publicKey!,
      }];
    }
  }

  canSubmitCreate() {
    return this.cf.name && this.cf.secret &&
      this.cf.selectedHolders.length >= 2 &&
      this.cf.threshold >= 2 &&
      this.cf.threshold <= this.cf.selectedHolders.length;
  }

  async createVault() {
    if (this.creating() || !this.canSubmitCreate()) return;
    this.creating.set(true);
    this.createError.set('');
    try {
      const vault = await this.vaultService.createVault(this.workspaceId, {
        name:        this.cf.name,
        description: this.cf.description || undefined,
        secret:      this.cf.secret,
        threshold:   this.cf.threshold,
        holders:     this.cf.selectedHolders,
      });
      this.vaults.update(vs => [vault, ...vs]);
      this.showCreate.set(false);
    } catch (e: any) {
      console.error('createVault failed', e);
      let msg = 'Failed to create vault';
      if (e instanceof Error) {
        msg = e.message || msg;
      } else if (e?.error) {
        const err = e.error;
        if (typeof err === 'string') msg = err;
        else if (err?.message) msg = Array.isArray(err.message) ? err.message.join(', ') : err.message;
      } else if (e?.message) {
        msg = e.message;
      }
      this.createError.set(msg);
    } finally {
      this.creating.set(false);
    }
  }

  // Access request

  requestAccess(vault: Vault) {
    if (this.requestingAccess()) return;
    this.requestingAccess.set(vault.id);
    this.vaultService.createAccessRequest(this.workspaceId, vault.id).subscribe({
      next: req => {
        this.accessRequests.update(all => [...all, req]);
        this.vaultService.requestProgress.update(m => {
          const next = new Map(m);
          next.set(req.id, { submitted: 0, threshold: vault.threshold });
          return next;
        });
        this.requestingAccess.set(null);
      },
      error: () => this.requestingAccess.set(null),
    });
  }

  cancelRequest(vault: Vault, requestId: string) {
    this.vaultService.denyAccessRequest(this.workspaceId, vault.id, requestId).subscribe({
      next: () => {
        this.accessRequests.update(all => all.filter(r => r.id !== requestId));
      },
    });
  }

  // Holder submit

  async submitHolderShare(notif: VaultNotification) {
    if (this.submittingShare()) return;
    this.shareSubmitError.set('');
    this.submittingShare.set(notif.accessRequestId);
    try {
      await this.vaultService.holderSubmitShare(
        this.workspaceId, notif.vaultId, notif.accessRequestId,
      );
      this.vaultService.dismissNotification(notif.accessRequestId);
    } catch (e: any) {
      console.error('Submit share failed', e);
      // FIX 3: show a human-readable error instead of just logging
      const msg = e instanceof Error
        ? e.message
        : (e?.error?.message ?? 'Failed to submit share');
      this.shareSubmitError.set(msg);
    } finally {
      this.submittingShare.set(null);
    }
  }

  // Delete vault

  deleteVault(vault: Vault) {
    if (!confirm(`Delete vault "${vault.name}"? This is irreversible.`)) return;
    this.vaultService.deleteVault(this.workspaceId, vault.id).subscribe({
      next: () => this.vaults.update(vs => vs.filter(v => v.id !== vault.id)),
    });
  }

  // Copy

  copySecret(vaultId: string) {
    const secret = this.unlockedSecrets().get(vaultId);
    if (!secret) return;
    navigator.clipboard.writeText(secret);
    this.copied.set(vaultId);
    setTimeout(() => this.copied.set(null), 2000);
  }
}
