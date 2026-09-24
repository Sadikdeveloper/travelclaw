import { Injectable } from '@nestjs/common';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { GATEWAY_VERSION, type HealthReport } from '@travelclaw/shared';
import { ModelService } from '../models/model.service';
import { WorkspaceService } from '../workspace/workspace.service';

@Injectable()
export class HealthService {
  constructor(
    private readonly workspace: WorkspaceService,
    private readonly models: ModelService,
  ) {}

  report(): HealthReport {
    const ready = existsSync(join(this.workspace.path(), 'SOUL.md'));
    return {
      ok: true,
      service: 'travelclaw-gateway',
      version: GATEWAY_VERSION,
      uptimeSec: Math.round(process.uptime()),
      database: 'ok',
      workspace: ready ? 'ok' : 'missing',
      model: this.models.current(),
    };
  }
}
