import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { SkillsService } from './skills.service';

@ApiTags('skills')
@Controller('api/skills')
export class SkillsController {
  constructor(private readonly skills: SkillsService) {}

  @Get()
  @ApiOperation({ summary: 'Skill catalog. Markdown does not execute by itself.' })
  list() {
    return this.skills.list();
  }

  @Get('runs')
  @ApiOperation({ summary: 'Recent skill runs' })
  runs() {
    return this.skills.recent();
  }
}
