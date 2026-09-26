import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { ModelCatalogRecord } from '@travelclaw/shared';
import { AuthGuard } from '../auth/auth.guard';
import { ModelService } from './model.service';

@ApiTags('models')
@Controller('api/models')
@UseGuards(AuthGuard)
export class ModelsController {
  constructor(private readonly models: ModelService) {}

  /**
   * The models this desk can run and the pace on each, per tier. This is what a picker
   * renders and what the copy about limits reads from; a guest sees it too, because a guest
   * is who the limits are mostly about.
   */
  @Get()
  @ApiOperation({ summary: 'Models on offer, their tiers, and their turn limits' })
  catalog(): ModelCatalogRecord {
    return this.models.catalog();
  }
}
