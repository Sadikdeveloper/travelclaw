import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ToolsService } from './tools.service';

@ApiTags('tools')
@Controller('api/tools')
export class ToolsController {
  constructor(private readonly tools: ToolsService) {}

  @Get()
  @ApiOperation({
    summary: 'Tools the turn loop can call. Each one is code, not a markdown procedure.',
  })
  list() {
    return this.tools.list();
  }

  @Get('runs')
  @ApiOperation({ summary: 'Recent tool runs' })
  runs() {
    return this.tools.recent();
  }
}
