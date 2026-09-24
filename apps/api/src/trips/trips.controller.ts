import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  createTripSchema,
  planTripSchema,
  updateTripSchema,
  type CreateTripInput,
  type PlanTripInput,
  type UpdateTripInput,
} from '@travelclaw/shared';
import { ZodValidationPipe } from '../common/zod-pipe';
import { TripsService } from './trips.service';

@ApiTags('trips')
@Controller('api/trips')
export class TripsController {
  constructor(private readonly trips: TripsService) {}

  @Get()
  @ApiOperation({ summary: 'List trips' })
  list() {
    return this.trips.list();
  }

  @Post()
  @ApiOperation({ summary: 'Create a trip shell' })
  create(@Body(new ZodValidationPipe(createTripSchema)) body: CreateTripInput) {
    return this.trips.create(body);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Trip plus itinerary days' })
  get(@Param('id') id: string) {
    return this.trips.get(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update trip fields or status' })
  update(@Param('id') id: string, @Body(new ZodValidationPipe(updateTripSchema)) body: UpdateTripInput) {
    return this.trips.update(id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Delete a trip and its days' })
  remove(@Param('id') id: string) {
    this.trips.remove(id);
  }

  @Post(':id/plan')
  @ApiOperation({ summary: 'Replace itinerary days from the outline skill' })
  plan(@Param('id') id: string, @Body(new ZodValidationPipe(planTripSchema)) body: PlanTripInput) {
    return this.trips.plan(id, body);
  }
}
