import { Module } from '@nestjs/common';
import { ConnectorsService } from './connectors.service';

/** Internal only: connectors are operator env, with no HTTP surface. */
@Module({
  providers: [ConnectorsService],
  exports: [ConnectorsService],
})
export class ConnectorsModule {}
