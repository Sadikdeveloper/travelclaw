import { Body, Controller, Delete, Get, Param, Put, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  upsertConnectorSchema,
  type UpsertConnectorInput,
  type UserRecord,
} from '@travelclaw/shared';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { ZodValidationPipe } from '../common/zod-pipe';
import { ConnectorsService } from './connectors.service';

@ApiTags('connectors')
@Controller('api/connectors')
@UseGuards(AuthGuard)
export class ConnectorsController {
  constructor(private readonly connectors: ConnectorsService) {}

  @Get()
  @ApiOperation({
    summary: 'Supported connectors and their status. Never includes a secret.',
  })
  list(@CurrentUser() user: UserRecord) {
    return this.connectors.list(user.id);
  }

  @Put(':name')
  @ApiOperation({
    summary:
      'Store a key and/or base URL. An omitted field keeps its value, an empty one clears it.',
  })
  upsert(
    @CurrentUser() user: UserRecord,
    @Param('name') name: string,
    @Body(new ZodValidationPipe(upsertConnectorSchema)) body: UpsertConnectorInput,
  ) {
    return this.connectors.upsert(user.id, name, body);
  }

  @Delete(':name')
  @ApiOperation({ summary: 'Forget a stored connector' })
  remove(@CurrentUser() user: UserRecord, @Param('name') name: string) {
    return this.connectors.remove(user.id, name);
  }
}
