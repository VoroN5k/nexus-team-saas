import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';

const API = (wid: string) => `http://localhost:4000/api/workspaces/${wid}/tasks`;

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

  getAll(workspaceId: string) {
    return this.http.get<Task[]>(API(workspaceId));
  }

  create(workspaceId: string, body: { title: string; description?: string; status?: TaskStatus; assignedId?: string }) {
    return this.http.post<Task>(API(workspaceId), body);
  }

  update(workspaceId: string, taskId: string, body: Partial<{ title: string; description: string; status: TaskStatus; assignedId: string | null }>) {
    return this.http.patch<Task>(`${API(workspaceId)}/${taskId}`, body);
  }

  delete(workspaceId: string, taskId: string) {
    return this.http.delete(`${API(workspaceId)}/${taskId}`);
  }
}