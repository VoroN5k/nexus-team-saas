import { ConflictException, Injectable, InternalServerErrorException } from "@nestjs/common";
import { PrismaService } from "src/prisma/prisma.service";
import { CreateWorkspaceDto } from "./dto/create-workspace.dto";


@Injectable()
export class WorkspaceService {
    constructor(private readonly prisma: PrismaService) {}

    async createWorkspace(userId: string, dto: CreateWorkspaceDto) {
        const { name, slug } = dto;

        const existing = await this.prisma.workspace.findUnique({
            where: { slug }
        })
        
        if (existing) throw new ConflictException("Slug already in use");
        
        try {
            return await this.prisma.$transaction(async (tx) => {
            // 1. Create the workspace
            const workspace = await tx.workspace.create({
                data: {
                    name,
                    slug: slug.toLowerCase(),
                },
            });

        // 2. Attach the user as the OWNER
        await tx.workspaceMember.create({
          data: {
            userId,
            workspaceId: workspace.id,
            role: Role.OWNER,
          },
        });

        return workspace;
      });
    } catch (error) {
      throw new InternalServerErrorException('Failed to create workspace');
    }

}
}