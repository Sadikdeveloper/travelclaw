import { Body, Controller, Get, Patch } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { updateWorkspaceSchema } from '@travelclaw/shared';
import { ZodValidationPipe } from '../common/zod-pipe';
import { WorkspaceService } from './workspace.service';

@ApiTags('workspace')
@Controller('api/workspace')
export class WorkspaceController {
  constructor(private readonly workspace: WorkspaceService) {}

  @Get()
  @ApiOperation({ summary: 'Read the desk persona files' })
  read() {
    return this.workspace.readFiles();
  }

  @Patch()
  @ApiOperation({ summary: 'Replace one allowlisted persona file' })
  update(
    @Body(new ZodValidationPipe(updateWorkspaceSchema))
    body: {
      file: 'SOUL.md' | 'IDENTITY.md' | 'USER.md' | 'AGENTS.md' | 'MEMORY.md';
      content: string;
    },
  ) {
    return this.workspace.write(body.file, body.content);
  }
}
