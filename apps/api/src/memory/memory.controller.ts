import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { createMemorySchema, type CreateMemoryInput } from '@travelclaw/shared';
import { ZodValidationPipe } from '../common/zod-pipe';
import { MemoryService } from './memory.service';

@ApiTags('memory')
@Controller('api/memory')
export class MemoryController {
  constructor(private readonly memory: MemoryService) {}

  @Get()
  @ApiOperation({ summary: 'List memory notes for an agent' })
  list(@Query('agentId') agentId?: string) {
    return this.memory.list(agentId);
  }

  @Post()
  @ApiOperation({ summary: 'Store a preference, fact, or decision' })
  create(@Body(new ZodValidationPipe(createMemorySchema)) body: CreateMemoryInput) {
    return this.memory.create(body);
  }
}
