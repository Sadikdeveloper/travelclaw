import { INestApplication } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { NextFunction, Request, Response } from 'express';
import { HttpExceptionFilter } from './common/http-exception.filter';
import { loadConfig } from './config';

export function configureApp(app: INestApplication) {
  app.useWebSocketAdapter(new IoAdapter(app));
  // Same-origin by default: the desk ships its own web client on the same host, and a
  // caller that presents no credential is recognised by address and user agent, so
  // reflecting arbitrary origins with credentials would let another site read a guest's
  // chats. Name extra origins in TRAVELCLAW_ALLOWED_ORIGINS if something else must call in.
  const { allowedOrigins } = loadConfig();
  app.enableCors({
    origin: allowedOrigins.length ? allowedOrigins : false,
    credentials: true,
  });
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
