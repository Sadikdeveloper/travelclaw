import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ChannelsService } from './channels.service';

@ApiTags('channels')
@Controller('api/channels')
export class ChannelsController {
  constructor(private readonly channels: ChannelsService) {}

  @Get()
  @ApiOperation({ summary: 'Channel plugins and whether they can receive messages' })
  list() {
    return this.channels.list();
  }
}
