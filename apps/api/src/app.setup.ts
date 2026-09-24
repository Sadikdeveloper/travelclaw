import { INestApplication } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { NextFunction, Request, Response } from 'express';
import { HttpExceptionFilter } from './common/http-exception.filter';

export function configureApp(app: INestApplication) {
  app.useWebSocketAdapter(new IoAdapter(app));
  app.enableCors({ origin: true, credentials: true });
  app.useGlobalFilters(new HttpExceptionFilter());
  const swagger = new DocumentBuilder()
    .setTitle('TravelClaw Gateway')
    .setDescription('Travel desk API. Request shapes live in @travelclaw/shared.')
    .setVersion('0.1.0')
    .build();
  SwaggerModule.setup('docs', app, SwaggerModule.createDocument(app, swagger));

  const webDist = resolve(process.cwd(), '../web/dist');
  if (!existsSync(join(webDist, 'index.html'))) return;
  const expressApp = app.getHttpAdapter().getInstance() as {
    use: (handler: (req: Request, res: Response, next: NextFunction) => void) => void;
  };
  (app as NestExpressApplication).useStaticAssets(webDist);
  expressApp.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    const path = req.path || '/';
    if (
      path.startsWith('/api') ||
      path.startsWith('/docs') ||
      path.startsWith('/socket.io') ||
      path === '/health'
    ) {
      return next();
    }
    if (!(req.headers.accept ?? '').includes('text/html')) return next();
    res.sendFile(join(webDist, 'index.html'));
  });
}
