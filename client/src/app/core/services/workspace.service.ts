import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';

function apiBase(): string {
  const { protocol, hostname } = window.location;
  if (hostname === 'localhost') return `${protocol}//localhost:4000/api`;
  const apiHost = hostname.replace(/-(\d+)\./, (_: string, p: string) =>
    p === '3000' ? '-4000.' : `-${p}.`
  );
  return `${protocol}//${apiHost}/api`;
}

const API = `${apiBase()}/workspaces`;

export interface Workspace {
  id: string;
  name: string;
  slug: string;
  createdAt: string;
  myRole: 'OWNER' | 'ADMIN' | 'MEMBER';
  _count: { members: number; tasks: number };
}

export interface Member {
  id: string;
  role: string;
  joinedAt: string;
  user: {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
    /** RSA-OAEP SPKI public key (base64) — present if user has set up vault keys */
    publicKey?: string | null;
  };
}

export interface InviteLink {
  id: string;
  expiresAt: string;
  maxUses: number | null;
  useCount: number;
  createdAt: string;
  createdBy: { id: string; firstName: string; lastName: string };
}

@Injectable({ providedIn: 'root' })
export class WorkspaceService {
  constructor(private http: HttpClient) {}

  getAll()                         { return this.http.get<Workspace[]>(API); }
  getOne(id: string)               { return this.http.get<Workspace>(`${API}/${id}`); }
  create(name: string, slug: string) { return this.http.post<Workspace>(API, { name, slug }); }
  update(id: string, name: string) { return this.http.patch<Workspace>(`${API}/${id}`, { name }); }
  delete(id: string)               { return this.http.delete(`${API}/${id}`); }

  getMembers(workspaceId: string)  { return this.http.get<Member[]>(`${API}/${workspaceId}/members`); }

  addMember(workspaceId: string, email: string, role = 'MEMBER') {
    return this.http.post<Member>(`${API}/${workspaceId}/members`, { email, role });
  }
  removeMember(workspaceId: string, userId: string) {
    return this.http.delete(`${API}/${workspaceId}/members/${userId}`);
  }
  updateMemberRole(workspaceId: string, userId: string, role: string) {
    return this.http.patch(`${API}/${workspaceId}/members/${userId}`, { role });
  }

  // Invite links

  createInviteLink(workspaceId: string, ttlHours = 24, maxUses?: number) {
    return this.http.post<{ token: string; expiresAt: string }>(
      `${API}/${workspaceId}/invites`,
      { ttlHours, maxUses: maxUses ?? null },
    );
  }

  listInviteLinks(workspaceId: string) {
    return this.http.get<InviteLink[]>(`${API}/${workspaceId}/invites`);
  }

  revokeInviteLink(workspaceId: string, inviteId: string) {
    return this.http.delete(`${API}/${workspaceId}/invites/${inviteId}`);
  }

  /** Join a workspace using a shared invite token. */
  joinViaInvite(token: string) {
    return this.http.post<Workspace>(`${API}/join`, { token });
  }
}
