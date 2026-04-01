import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { CreateTaskDto } from './dto/task.dto';
import { UpdateTaskDto } from './dto/task.dto';
import { Role } from '../../generated/prisma/client';

@Injectable()
export class TaskService {
  constructor(private readonly prisma: PrismaService) {}

  // Read 

  async getTasks(workspaceId: string) {
    return this.prisma.task.findMany({
      where:   { workspaceId },
      include: {
        assigned: {
          select: { id: true, firstName: true, lastName: true, email: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getTask(workspaceId: string, taskId: string) {
    // Always scope by workspaceId — prevents IDOR across workspaces
    const task = await this.prisma.task.findFirst({
      where: { id: taskId, workspaceId },
      include: {
        assigned: {
          select: { id: true, firstName: true, lastName: true, email: true },
        },
      },
    });

    if (!task) throw new NotFoundException('Task not found');
    return task;
  }

  // Write

  async createTask(workspaceId: string, dto: CreateTaskDto) {
    if (dto.assignedId) {
      await this.assertMemberOfWorkspace(dto.assignedId, workspaceId);
    }

    return this.prisma.task.create({
      data: {
        title:       dto.title,
        description: dto.description,
        status:      dto.status,
        workspaceId,
        assignedId:  dto.assignedId ?? null,
      },
      include: {
        assigned: {
          select: { id: true, firstName: true, lastName: true, email: true },
        },
      },
    });
  }

  async updateTask(
    workspaceId:    string,
    taskId:         string,
    dto:            UpdateTaskDto,
    requestingUserId: string,
    requestingRole: Role,
  ) {
    const task = await this.getTask(workspaceId, taskId);

    // Members can only update tasks assigned to them
    // ADMINs and OWNERs can update any task
    const isPrivileged = requestingRole === Role.ADMIN || requestingRole === Role.OWNER;
    if (!isPrivileged && task.assignedId !== requestingUserId) {
      throw new ForbiddenException('You can only update tasks assigned to you');
    }

    // Validate assignee is a workspace member
    if (dto.assignedId !== undefined && dto.assignedId !== null) {
      await this.assertMemberOfWorkspace(dto.assignedId, workspaceId);
    }

    return this.prisma.task.update({
      where: { id: taskId },
      data:  {
        ...(dto.title       !== undefined && { title:       dto.title       }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.status      !== undefined && { status:      dto.status      }),
        ...('assignedId' in dto          && { assignedId:   dto.assignedId  }),
      },
      include: {
        assigned: {
          select: { id: true, firstName: true, lastName: true, email: true },
        },
      },
    });
  }

  async deleteTask(
    workspaceId:    string,
    taskId:         string,
    requestingRole: Role,
  ) {
    await this.getTask(workspaceId, taskId); // 404 if not found / wrong workspace

    // Only ADMIN and OWNER can delete tasks
    if (requestingRole === Role.MEMBER) {
      throw new ForbiddenException('Members cannot delete tasks');
    }

    await this.prisma.task.delete({ where: { id: taskId } });
  }

  // Private

  /**
   * Ensures the given userId is a member of the workspace.
   * Used to prevent assigning tasks to outsiders.
   */
  private async assertMemberOfWorkspace(
    userId:      string,
    workspaceId: string,
  ) {
    const member = await this.prisma.workspaceMember.findUnique({
      where: { userId_workspaceId: { userId, workspaceId } },
    });

    if (!member) {
      throw new BadRequestException('Assignee must be a workspace member');
    }
  }
}