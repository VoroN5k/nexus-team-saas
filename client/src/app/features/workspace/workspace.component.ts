import { Component, OnInit, signal, computed } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../../core/services/auth.service';
import { WorkspaceService, Workspace, Member } from '../../core/services/workspace.service';
import { TaskService, Task, TaskStatus } from '../../core/services/task.service';
import { VaultTabComponent } from './vault-tab.component';
import { RouterTestingHarness } from '@angular/router/testing';

const STATUS_LABELS: Record<TaskStatus, string> = {
  TODO: 'To Do', IN_PROGRESS: 'In Progress', REVIEW: 'Review', DONE: 'Done',
};
const STATUS_COLORS: Record<TaskStatus, string> = {
  TODO: 'bg-slate-600', IN_PROGRESS: 'bg-blue-600', REVIEW: 'bg-amber-500', DONE: 'bg-green-600',
};

@Component({
  selector: 'app-workspace',
  standalone: true,
  imports: [FormsModule, RouterLink, VaultTabComponent],
  template: `
    <div class="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800 flex flex-col">

      <!-- Navbar -->
      <nav class="border-b border-slate-700 px-6 py-4 flex items-center gap-4 shrink-0">
        <a routerLink="/dashboard" class="text-slate-400 hover:text-white transition-colors">
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7"/>
          </svg>
        </a>
        <div class="w-px h-5 bg-slate-700"></div>
        <div class="flex items-center gap-2">
          <div class="w-7 h-7 bg-indigo-600 rounded-lg flex items-center justify-center">
            <span class="text-white font-bold text-sm">{{ workspace()?.name?.charAt(0)?.toUpperCase() }}</span>
          </div>
          <span class="text-white font-semibold">{{ workspace()?.name }}</span>
          @if (workspace()) {
            <span class="text-xs px-2 py-0.5 rounded-full bg-slate-700 text-slate-400 ml-1">{{ myRole() }}</span>
          }
        </div>
        <div class="ml-auto flex items-center gap-1">
          @for (tab of tabs; track tab.id) {
            <button (click)="setTab(tab.id)"
                    class="px-3 py-1.5 text-sm rounded-lg transition-colors"
                    [class]="activeTab() === tab.id
                ? 'bg-slate-700 text-white font-medium'
                : 'text-slate-400 hover:text-white'">
              {{ tab.label }}
            </button>
          }
        </div>
      </nav>

      <!-- ── Tasks Tab ──────────────────────────────────────────────────────── -->
      @if (activeTab() === 'tasks') {
        <div class="flex-1 flex flex-col p-6 overflow-hidden">
          <div class="flex items-center justify-between mb-6">
            <h2 class="text-xl font-bold text-white">Kanban Board</h2>
            <button (click)="showNewTask.set(true)"
                    class="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white font-medium rounded-lg transition-colors text-sm">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/>
              </svg>
              Add task
            </button>
          </div>

          @if (showNewTask()) {
            <div class="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
              <div class="bg-slate-800 border border-slate-700 rounded-2xl p-6 w-full max-w-md shadow-2xl">
                <h3 class="text-lg font-bold text-white mb-4">New Task</h3>
                <form (ngSubmit)="createTask()" #tf="ngForm">
                  <div class="space-y-3">
                    <div>
                      <label class="block text-sm font-medium text-slate-300 mb-1">Title *</label>
                      <input type="text" name="title" [(ngModel)]="newTask.title" required maxlength="200"
                             class="w-full px-4 py-2.5 bg-slate-900 border border-slate-600 rounded-lg text-white
                               placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                             placeholder="Task title"/>
                    </div>
                    <div>
                      <label class="block text-sm font-medium text-slate-300 mb-1">Description</label>
                      <textarea name="description" [(ngModel)]="newTask.description" rows="3"
                                class="w-full px-4 py-2.5 bg-slate-900 border border-slate-600 rounded-lg text-white
                               placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
                                placeholder="Optional description"></textarea>
                    </div>
                    <div>
                      <label class="block text-sm font-medium text-slate-300 mb-1">Status</label>
                      <select name="status" [(ngModel)]="newTask.status"
                              class="w-full px-4 py-2.5 bg-slate-900 border border-slate-600 rounded-lg text-white
                               focus:outline-none focus:ring-2 focus:ring-indigo-500">
                        <option value="TODO">To Do</option>
                        <option value="IN_PROGRESS">In Progress</option>
                        <option value="REVIEW">Review</option>
                        <option value="DONE">Done</option>
                      </select>
                    </div>
                    <div>
                      <label class="block text-sm font-medium text-slate-300 mb-1">Assign to</label>
                      <select name="assignedId" [(ngModel)]="newTask.assignedId"
                              class="w-full px-4 py-2.5 bg-slate-900 border border-slate-600 rounded-lg text-white
                               focus:outline-none focus:ring-2 focus:ring-indigo-500">
                        <option value="">Unassigned</option>
                        @for (m of members(); track m.id) {
                          <option [value]="m.user.id">{{ m.user.firstName }} {{ m.user.lastName }}</option>
                        }
                      </select>
                    </div>
                  </div>
                  @if (taskError()) { <p class="mt-2 text-red-400 text-sm">{{ taskError() }}</p> }
                  <div class="flex gap-3 mt-5">
                    <button type="button" (click)="showNewTask.set(false)"
                            class="flex-1 py-2.5 border border-slate-600 text-slate-300 rounded-lg hover:border-slate-400">
                      Cancel
                    </button>
                    <button type="submit" [disabled]="savingTask() || tf.invalid"
                            class="flex-1 py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-semibold rounded-lg">
                      {{ savingTask() ? 'Creating…' : 'Create' }}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          }

          @if (editingTask()) {
            <div class="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
              <div class="bg-slate-800 border border-slate-700 rounded-2xl p-6 w-full max-w-md shadow-2xl">
                <h3 class="text-lg font-bold text-white mb-4">Edit Task</h3>
                <form (ngSubmit)="saveEdit()" #ef="ngForm">
                  <div class="space-y-3">
                    <div>
                      <label class="block text-sm font-medium text-slate-300 mb-1">Title *</label>
                      <input type="text" name="editTitle" [(ngModel)]="editForm.title" required
                             class="w-full px-4 py-2.5 bg-slate-900 border border-slate-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"/>
                    </div>
                    <div>
                      <label class="block text-sm font-medium text-slate-300 mb-1">Description</label>
                      <textarea name="editDesc" [(ngModel)]="editForm.description" rows="3"
                                class="w-full px-4 py-2.5 bg-slate-900 border border-slate-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"></textarea>
                    </div>
                    <div>
                      <label class="block text-sm font-medium text-slate-300 mb-1">Status</label>
                      <select name="editStatus" [(ngModel)]="editForm.status"
                              class="w-full px-4 py-2.5 bg-slate-900 border border-slate-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-indigo-500">
                        <option value="TODO">To Do</option>
                        <option value="IN_PROGRESS">In Progress</option>
                        <option value="REVIEW">Review</option>
                        <option value="DONE">Done</option>
                      </select>
                    </div>
                  </div>
                  <div class="flex gap-3 mt-5">
                    <button type="button" (click)="editingTask.set(null)"
                            class="flex-1 py-2.5 border border-slate-600 text-slate-300 rounded-lg hover:border-slate-400">Cancel</button>
                    <button type="submit" [disabled]="savingTask() || ef.invalid"
                            class="flex-1 py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-semibold rounded-lg">
                      {{ savingTask() ? 'Saving…' : 'Save' }}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          }

          @if (loadingTasks()) {
            <div class="flex gap-4">
              @for (_ of [1,2,3,4]; track $index) {
                <div class="min-w-64 bg-slate-800 border border-slate-700 rounded-2xl p-4 animate-pulse">
                  <div class="h-5 bg-slate-700 rounded w-1/2 mb-4"></div>
                  <div class="space-y-3"><div class="h-20 bg-slate-700 rounded-xl"></div></div>
                </div>
              }
            </div>
          } @else {
            <div class="flex gap-4 overflow-x-auto pb-4 flex-1">
              @for (status of statuses; track status) {
                <div class="min-w-64 w-64 flex flex-col">
                  <div class="flex items-center gap-2 mb-3">
                    <span class="w-2.5 h-2.5 rounded-full {{ STATUS_COLORS[status] }}"></span>
                    <span class="text-slate-300 font-semibold text-sm">{{ STATUS_LABELS[status] }}</span>
                    <span class="ml-auto text-slate-500 text-sm">{{ tasksByStatus()[status]?.length ?? 0 }}</span>
                  </div>
                  <div class="flex-1 space-y-3 min-h-16">
                    @for (task of tasksByStatus()[status] ?? []; track task.id) {
                      <div class="bg-slate-800 border border-slate-700 hover:border-slate-500 rounded-xl p-4 transition-colors group">
                        <div class="flex items-start justify-between gap-2">
                          <p class="text-white text-sm font-medium leading-snug">{{ task.title }}</p>
                          <div class="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                            <button (click)="openEdit(task)" class="p-1 text-slate-400 hover:text-indigo-400 transition-colors">
                              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                                      d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/>
                              </svg>
                            </button>
                            <button (click)="deleteTask(task)" class="p-1 text-slate-400 hover:text-red-400 transition-colors">
                              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                                      d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/>
                              </svg>
                            </button>
                          </div>
                        </div>
                        @if (task.description) {
                          <p class="text-slate-400 text-xs mt-1 line-clamp-2">{{ task.description }}</p>
                        }
                        @if (task.assigned) {
                          <div class="flex items-center gap-1.5 mt-3">
                            <div class="w-5 h-5 bg-indigo-600 rounded-full flex items-center justify-center">
                              <span class="text-white text-xs font-bold">{{ task.assigned.firstName.charAt(0) }}</span>
                            </div>
                            <span class="text-slate-400 text-xs">{{ task.assigned.firstName }} {{ task.assigned.lastName }}</span>
                          </div>
                        }
                      </div>
                    }
                  </div>
                </div>
              }
            </div>
          }
        </div>
      }

      <!-- ── Members Tab ─────────────────────────────────────────────────────── -->
      @if (activeTab() === 'members') {
        <div class="flex-1 p-6 max-w-2xl mx-auto w-full">
        @if (roleUpdateError()) {
            <div class="mb-4 p-3 bg-red-500/10 border border-red-500/30 rounded-lg
                        flex items-start gap-3 text-sm">
              <svg class="w-4 h-4 text-red-400 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                      d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/>
              </svg>
              <p class="text-red-400 flex-1">{{ roleUpdateError() }}</p>
              <button (click)="roleUpdateError.set('')" class="text-slate-400 hover:text-white">✕</button>
            </div>
        }

          <div class="flex items-center justify-between mb-6">
            <h2 class="text-xl font-bold text-white">Members</h2>
            <div class="flex gap-2">
              @if (myRole() === 'OWNER' || myRole() === 'ADMIN') {
                <button (click)="generateInviteLink()"
                        [disabled]="generatingLink()"
                        class="flex items-center gap-2 px-4 py-2 border border-slate-600 hover:border-indigo-500
                         text-slate-300 hover:text-white font-medium rounded-lg transition-colors text-sm">
                  <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                          d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"/>
                  </svg>
                  {{ generatingLink() ? 'Generating…' : 'Invite link' }}
                </button>
                <button (click)="showInvite.set(true)"
                        class="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500
                         text-white font-medium rounded-lg transition-colors text-sm">
                  <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/>
                  </svg>
                  Invite by email
                </button>
              }
            </div>
          </div>

          <!-- Invite link banner -->
          @if (inviteLinkUrl()) {
            <div class="mb-5 p-4 bg-indigo-950/60 border border-indigo-500/30 rounded-2xl">
              <p class="text-indigo-300 text-xs font-semibold uppercase tracking-wide mb-2">Shareable invite link · expires in 24h</p>
              <div class="flex items-center gap-2">
                <code class="flex-1 text-xs text-slate-300 bg-slate-800 px-3 py-2 rounded-lg truncate font-mono">
                  {{ inviteLinkUrl() }}
                </code>
                <button (click)="copyInviteLink()"
                        class="shrink-0 px-3 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold rounded-lg transition-colors">
                  {{ linkCopied() ? 'Copied!' : 'Copy' }}
                </button>
                <button (click)="inviteLinkUrl.set('')"
                        class="shrink-0 p-2 text-slate-400 hover:text-white">✕</button>
              </div>
            </div>
          }

          @if (showInvite()) {
            <div class="bg-slate-800 border border-slate-700 rounded-2xl p-5 mb-6">
              <h3 class="font-semibold text-white mb-3">Invite by email</h3>
              <form (ngSubmit)="inviteMember()" class="flex gap-3">
                <input type="email" [(ngModel)]="inviteEmail" name="inviteEmail" required
                       class="flex-1 px-4 py-2.5 bg-slate-900 border border-slate-600 rounded-lg text-white
                         placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                       placeholder="colleague@example.com"/>
                <button type="submit" [disabled]="inviting()"
                        class="px-4 py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-medium rounded-lg">
                  {{ inviting() ? '…' : 'Invite' }}
                </button>
                <button type="button" (click)="showInvite.set(false)"
                        class="px-3 py-2.5 text-slate-400 hover:text-white">✕</button>
              </form>
              @if (inviteError()) { <p class="text-red-400 text-sm mt-2">{{ inviteError() }}</p> }
            </div>
          }

          @if (loadingMembers()) {
            <div class="space-y-3">
              @for (_ of [1,2,3]; track $index) {
                <div class="bg-slate-800 border border-slate-700 rounded-xl p-4 animate-pulse flex items-center gap-3">
                  <div class="w-10 h-10 bg-slate-700 rounded-full"></div>
                  <div class="flex-1"><div class="h-4 bg-slate-700 rounded w-1/3 mb-2"></div></div>
                </div>
              }
            </div>
          } @else {
            <div class="space-y-3">
              @for (m of members(); track m.id) {
                <div class="bg-slate-800 border border-slate-700 rounded-xl p-4 flex items-center gap-3">
                  <div class="w-10 h-10 bg-indigo-600/20 rounded-full flex items-center justify-center shrink-0">
                    <span class="text-indigo-400 font-bold">{{ m.user.firstName.charAt(0).toUpperCase() }}</span>
                  </div>
                  <div class="flex-1 min-w-0">
                    <p class="text-white font-medium">{{ m.user.firstName }} {{ m.user.lastName }}</p>
                    <p class="text-slate-400 text-sm truncate">{{ m.user.email }}</p>
                  </div>
                  <!-- Vault key indicator -->
                  <div [title]="m.user.publicKey ? 'Vault keys set up' : 'No vault keys'"
                       class="w-5 h-5 rounded-full flex items-center justify-center"
                       [class]="m.user.publicKey ? 'bg-green-500/20' : 'bg-slate-700'">
                    <svg class="w-3 h-3" [class]="m.user.publicKey ? 'text-green-400' : 'text-slate-500'"
                         fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                            d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z"/>
                    </svg>
                  </div>
                  @if (canChangeRoleOf(m)) {
                    <div class="relative shrink-0">
                      <select
                        [value]="m.role"
                        [disabled]="updatingRoleUserId() === m.user.id"
                        (change)="changeRole(m.user.id, $any($event.target).value)"
                        class="text-xs font-medium pl-2.5 pr-7 py-1 rounded-full border-0 cursor-pointer
                              appearance-none focus:outline-none focus:ring-2 focus:ring-indigo-500
                              disabled:opacity-50"
                        [class]="m.role === 'ADMIN' ? 'bg-blue-500/20 text-blue-400'
                                                    : 'bg-slate-700 text-slate-400'">
                        @for (role of assignableRoles; track role) {
                          <option [value]="role" class="bg-slate-800 text-white">{{ role }}</option>
                        }
                      </select>
                      @if (updatingRoleUserId() === m.user.id) {
                        <div class="absolute right-1.5 top-1/2 -translate-y-1/2
                                    w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin">
                        </div>
                      } @else {
                        <svg class="absolute right-1.5 top-1/2 -translate-y-1/2 w-3 h-3 pointer-events-none opacity-60"
                            fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"/>
                        </svg>
                      }
                    </div>
                  } @else {
                    <span class="text-xs px-2 py-1 rounded-full font-medium shrink-0"
                          [class]="m.role === 'OWNER' ? 'bg-amber-500/20 text-amber-400'
                              : m.role === 'ADMIN' ? 'bg-blue-500/20 text-blue-400'
                              : 'bg-slate-700 text-slate-400'">
                      {{ m.role }}
                    </span>
                  }
                  @if (myRole() === 'OWNER' && m.role !== 'OWNER') {
                    <button (click)="removeMember(m.user.id)"
                            class="p-1.5 text-slate-500 hover:text-red-400 transition-colors">
                      <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                              d="M13 7a4 4 0 11-8 0 4 4 0 018 0zM9 14a6 6 0 00-6 6v1h12v-1a6 6 0 00-6-6zM21 12h-6"/>
                      </svg>
                    </button>
                  }
                </div>
              }
            </div>
          }
        </div>
      }

      <!-- ── Vault Tab ───────────────────────────────────────────────────────── -->
      @if (activeTab() === 'vault') {
        <app-vault-tab
          [workspaceId]="workspaceId"
          [myRole]="myRole()"
          class="flex-1 flex flex-col">
        </app-vault-tab>
      }
    </div>
  `,
})
export class WorkspaceComponent implements OnInit {
  readonly STATUS_LABELS = STATUS_LABELS;
  readonly STATUS_COLORS = STATUS_COLORS;
  readonly statuses: TaskStatus[] = ['TODO', 'IN_PROGRESS', 'REVIEW', 'DONE'];

  readonly tabs = [
    { id: 'tasks',   label: 'Tasks' },
    { id: 'members', label: 'Members' },
    { id: 'vault',   label: '🔐 Vault' },
  ];

  workspace      = signal<Workspace | null>(null);
  tasks          = signal<Task[]>([]);
  members        = signal<Member[]>([]);
  loadingTasks   = signal(true);
  loadingMembers = signal(false);
  showNewTask    = signal(false);
  showInvite     = signal(false);
  editingTask    = signal<Task | null>(null);
  savingTask     = signal(false);
  taskError      = signal('');
  inviteEmail    = '';
  inviteError    = signal('');
  inviting       = signal(false);
  activeTab      = signal<string>('tasks');
  inviteLinkUrl  = signal('');
  generatingLink = signal(false);
  linkCopied     = signal(false);
  readonly assignableRoles = ['ADMIN', 'MEMBER'] as const;
  updatingRoleUserId = signal<string | null>(null);
  roleUpdateError = signal('');

  newTask  = { title: '', description: '', status: 'TODO' as TaskStatus, assignedId: '' };
  editForm = { title: '', description: '', status: 'TODO' as TaskStatus };

  workspaceId = '';

  readonly tasksByStatus = computed(() => {
    const map: Partial<Record<TaskStatus, Task[]>> = {};
    for (const s of this.statuses) map[s] = [];
    for (const t of this.tasks()) map[t.status]!.push(t);
    return map as Record<TaskStatus, Task[]>;
  });

  readonly myRole = computed(() => {
    const wsRole = (this.workspace() as any)?.myRole;
    if (wsRole) return wsRole;
    const userId = this.auth.user()?.sub;
    const member = this.members().find(m => m.user.id === userId);
    return member?.role ?? 'MEMBER';
  });

  constructor(
    private route:       ActivatedRoute,
    private auth:        AuthService,
    private wsService:   WorkspaceService,
    private taskService: TaskService,
  ) {}

  ngOnInit() {
    this.workspaceId = this.route.snapshot.paramMap.get('id')!;
    this.wsService.getOne(this.workspaceId).subscribe({ next: ws => this.workspace.set(ws as any) });
    this.wsService.getMembers(this.workspaceId).subscribe({ next: m => this.members.set(m) });
    this.loadTasks();

    // Handle pending invite from join redirect flow
    const pendingInvite = sessionStorage.getItem('pending_invite');
    if (pendingInvite) {
      sessionStorage.removeItem('pending_invite');
    }
  }

  setTab(id: string) {
    this.activeTab.set(id);
    if (id === 'members' && !this.members().length) this.loadMembers();
  }

  loadTasks() {
    this.loadingTasks.set(true);
    this.taskService.getAll(this.workspaceId).subscribe({
      next: t => { this.tasks.set(t); this.loadingTasks.set(false); },
      error: () => this.loadingTasks.set(false),
    });
  }

  loadMembers() {
    if (this.members().length) return;
    this.loadingMembers.set(true);
    this.wsService.getMembers(this.workspaceId).subscribe({
      next: m => { this.members.set(m); this.loadingMembers.set(false); },
      error: () => this.loadingMembers.set(false),
    });
  }

  createTask() {
    if (this.savingTask()) return;
    this.taskError.set('');
    this.savingTask.set(true);
    const body: any = {
      title: this.newTask.title,
      status: this.newTask.status,
      ...(this.newTask.description && { description: this.newTask.description }),
      ...(this.newTask.assignedId && { assignedId: this.newTask.assignedId }),
    };
    this.taskService.create(this.workspaceId, body).subscribe({
      next: t => {
        this.tasks.update(ts => [t, ...ts]);
        this.showNewTask.set(false);
        this.newTask = { title: '', description: '', status: 'TODO', assignedId: '' };
        this.savingTask.set(false);
      },
      error: e => {
        const msg = e?.error?.message;
        this.taskError.set(Array.isArray(msg) ? msg.join(', ') : (msg ?? 'Failed to create task'));
        this.savingTask.set(false);
      },
    });
  }

  openEdit(task: Task) {
    this.editingTask.set(task);
    this.editForm = { title: task.title, description: task.description ?? '', status: task.status };
  }

  saveEdit() {
    const task = this.editingTask();
    if (!task || this.savingTask()) return;
    this.savingTask.set(true);
    this.taskService.update(this.workspaceId, task.id, {
      title: this.editForm.title,
      description: this.editForm.description || undefined,
      status: this.editForm.status,
    }).subscribe({
      next: updated => {
        this.tasks.update(ts => ts.map(t => t.id === updated.id ? updated : t));
        this.editingTask.set(null);
        this.savingTask.set(false);
      },
      error: () => this.savingTask.set(false),
    });
  }

  deleteTask(task: Task) {
    if (!confirm(`Delete "${task.title}"?`)) return;
    this.taskService.delete(this.workspaceId, task.id).subscribe({
      next: () => this.tasks.update(ts => ts.filter(t => t.id !== task.id)),
    });
  }

  inviteMember() {
    if (this.inviting()) return;
    this.inviteError.set('');
    this.inviting.set(true);
    this.wsService.addMember(this.workspaceId, this.inviteEmail).subscribe({
      next: m => {
        this.members.update(ms => [...ms, m]);
        this.inviteEmail = '';
        this.showInvite.set(false);
        this.inviting.set(false);
      },
      error: e => {
        const msg = e?.error?.message;
        this.inviteError.set(Array.isArray(msg) ? msg.join(', ') : (msg ?? 'Failed to invite'));
        this.inviting.set(false);
      },
    });
  }

  removeMember(userId: string) {
    if (!confirm('Remove this member?')) return;
    this.wsService.removeMember(this.workspaceId, userId).subscribe({
      next: () => this.members.update(ms => ms.filter(m => m.user.id !== userId)),
    });
  }

  changeRole(userId: string, newRole: string) {
    if (this.updatingRoleUserId()) return;

    const member = this.members().find(m => m.user.id === userId);
    if (!member || member.role === newRole) return;

    this.roleUpdateError.set('');
    this.updatingRoleUserId.set(userId);

    this.wsService.updateMemberRole(this.workspaceId, userId, newRole).subscribe({
      next: () => {
        this.members.update(ms => 
          ms.map(m => m.user.id === userId ? { ...m, role: newRole } : m)
        );
        this.updatingRoleUserId.set(null);
      },
      error: e => {
        const msg = e?.error?.message;
        this.roleUpdateError.set(
          Array.isArray(msg) ? msg.join(', '): (msg ?? 'Failed to update role'),
        );
        this.updatingRoleUserId.set(null);
        this.wsService.getMembers(this.workspaceId).subscribe({
          next: m => this.members.set(m),
        });
      },
    });
  }

  canChangeRoleOf(member: Member): boolean {
    const myId = this.auth.user()?.sub;
    return this.myRole() === 'OWNER'
      && member.role !== 'OWNER'
      && member.user.id !== myId;
  }

  generateInviteLink() {
    if (this.generatingLink()) return;
    this.generatingLink.set(true);
    this.wsService.createInviteLink(this.workspaceId).subscribe({
      next: ({ token }) => {
        const base = window.location.origin;
        this.inviteLinkUrl.set(`${base}/join?token=${token}`);
        this.generatingLink.set(false);
      },
      error: () => this.generatingLink.set(false),
    });
  }

  copyInviteLink() {
    navigator.clipboard.writeText(this.inviteLinkUrl());
    this.linkCopied.set(true);
    setTimeout(() => this.linkCopied.set(false), 2000);
  }
}
