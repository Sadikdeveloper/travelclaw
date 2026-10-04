import { Body, Controller, Get, Patch, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { updateWorkspaceSchema, type WorkspaceView } from '@travelclaw/shared';
import { ZodValidationPipe } from '../common/zod-pipe';
import { WorkspaceService } from './workspace.service';

@ApiTags('workspace')
@Controller('api/workspace')
export class WorkspaceController {
  constructor(private readonly workspace: WorkspaceService) {}

  @Get()
  @ApiOperation({
    summary: 'Read the desk persona files and say which file backs each slot',
  })
  read(@Query('agentId') agentId?: string): WorkspaceView {
    // `agentId` selects the per-agent view: workspace/agents/<id>/<file> when that
    // file exists, the shared desk file otherwise. The id is validated in the
    // service, so a traversal attempt is a 400, not a path outside the workspace.
    return this.workspace.view(agentId?.trim() || undefined);
  }

  @Patch()
  @ApiOperation({ summary: 'Replace one allowlisted shared persona file' })
  update(
    @Body(new ZodValidationPipe(updateWorkspaceSchema))
    body: {
      file: 'SOUL.md' | 'IDENTITY.md' | 'USER.md' | 'AGENTS.md' | 'MEMORY.md';
      content: string;
    },
  ): WorkspaceView {
    return this.workspace.write(body.file, body.content);
  }
}
