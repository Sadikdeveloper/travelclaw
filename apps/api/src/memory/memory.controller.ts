import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  createMemorySchema,
  memoryQuerySchema,
  type CreateMemoryInput,
  type MemoryQueryInput,
  type MemoryRecord,
  type MemorySearchResult,
} from '@travelclaw/shared';
import { ZodValidationPipe } from '../common/zod-pipe';
import { MemoryService } from './memory.service';

@ApiTags('memory')
@Controller('api/memory')
export class MemoryController {
  constructor(private readonly memory: MemoryService) {}

  @Get()
  @ApiOperation({
    summary: 'List memory notes, or search them when q is given',
  })
  list(
    @Query(new ZodValidationPipe(memoryQuerySchema)) query: MemoryQueryInput,
  ): MemoryRecord[] | MemorySearchResult[] {
    const options = { kind: query.kind, limit: query.limit };
    // A blank q is no question at all, so it lists rather than returning nothing.
    return query.q
      ? this.memory.search(query.agentId, query.q, options)
      : this.memory.list(query.agentId, options);
  }

  @Post()
  @ApiOperation({ summary: 'Store a preference, fact, or decision' })
  create(@Body(new ZodValidationPipe(createMemorySchema)) body: CreateMemoryInput) {
    return this.memory.create(body);
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Forget a note, in the index and in MEMORY.md' })
  remove(@Param('id') id: string, @Query('agentId') agentId?: string) {
    this.memory.forget(agentId, id);
  }
}
