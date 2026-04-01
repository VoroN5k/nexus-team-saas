import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { TaskService } from './task.service';
import { CreateTaskDto, UpdateTaskDto } from './dto/task.dto';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { WorkspaceMemberGuard } from 'src/workspace/guards/workspace-member.guard';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import { WorkspaceRole } from 'src/workspace/decorators/workspace-role.decorator';
import { JWTPayload } from 'src/auth/interfaces/jwt-payload.interface';
import { Role } from '../../generated/prisma/client';

/**
 * Routes: /workspaces/:workspaceId/tasks
 *
 * All routes require:
 *   1. Valid JWT (JwtAuthGuard)
 *   2. User is a member of the workspace (WorkspaceMemberGuard)
 */
@UseGuards(JwtAuthGuard, WorkspaceMemberGuard)
@Controller('workspaces/:workspaceId/tasks')
export class TaskController {
  constructor(private readonly taskService: TaskService) {}

  @Get()
  findAll(@Param('workspaceId') workspaceId: string) {
    return this.taskService.getTasks(workspaceId);
  }

  @Get(':taskId')
  findOne(
    @Param('workspaceId') workspaceId: string,
    @Param('taskId') taskId: string,
  ) {
    return this.taskService.getTask(workspaceId, taskId);
  }

  @Post()
  create(
    @Param('workspaceId') workspaceId: string,
    @Body() dto: CreateTaskDto,
  ) {
    return this.taskService.createTask(workspaceId, dto);
  }

  @Patch(':taskId')
  update(
    @Param('workspaceId') workspaceId: string,
    @Param('taskId') taskId: string,
    @Body() dto: UpdateTaskDto,
    @CurrentUser() user: JWTPayload,
    @WorkspaceRole() role: Role,
  ) {
    return this.taskService.updateTask(workspaceId, taskId, dto, user.sub, role);
  }

  @HttpCode(HttpStatus.NO_CONTENT)
  @Delete(':taskId')
  remove(
    @Param('workspaceId') workspaceId: string,
    @Param('taskId') taskId: string,
    @WorkspaceRole() role: Role,
  ) {
    return this.taskService.deleteTask(workspaceId, taskId, role);
  }
}