import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { createAgentSchema, type CreateAgentInput } from '@travelclaw/shared';
import { ZodValidationPipe } from '../common/zod-pipe';
import { AgentsService } from './agents.service';

@ApiTags('agents')
@Controller('api/agents')
export class AgentsController {
  constructor(private readonly agents: AgentsService) {}

  @Get()
  @ApiOperation({ summary: 'List desk agents' })
  list() {
    return this.agents.list();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Read one agent' })
  get(@Param('id') id: string) {
    return this.agents.get(id);
  }

  @Post()
  @ApiOperation({
    summary:
      'Create an agent row. Persona files stay shared until per-agent workspaces land.',
  })
  create(@Body(new ZodValidationPipe(createAgentSchema)) body: CreateAgentInput) {
    return this.agents.create(body);
  }
}
