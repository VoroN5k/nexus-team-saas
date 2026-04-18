import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { apiBase } from '../utils/api-base.util';



export type TaskStatus = 'TODO' | 'IN_PROGRESS' | 'REVIEW' | 'DONE';

export interface Task {
  id: string;
  title: string;
  description?: string;
  status: TaskStatus;
  workspaceId: string;
  assignedId?: string;
  createdAt: string;
  updatedAt: string;
  assigned?: { id: string; firstName: string; lastName: string; email: string } | null;
}

@Injectable({ providedIn: 'root' })
export class TaskService {
  constructor(private http: HttpClient) {}

  private url(wid: string) { return `${apiBase()}/workspaces/${wid}/tasks`; }

  getAll(workspaceId: string) { return this.http.get<Task[]>(this.url(workspaceId)); }

  create(workspaceId: string, body: {
    title: string; description?: string; status?: TaskStatus; assignedId?: string;
  }) { return this.http.post<Task>(this.url(workspaceId), body); }

  update(workspaceId: string, taskId: string, body: Partial<{
    title: string; description: string; status: TaskStatus; assignedId: string | null;
  }>) { return this.http.patch<Task>(`${this.url(workspaceId)}/${taskId}`, body); }

  delete(workspaceId: string, taskId: string) {
    return this.http.delete(`${this.url(workspaceId)}/${taskId}`);
  }
}
