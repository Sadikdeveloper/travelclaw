import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';
import { loadConfig, loadEnvFiles } from './config';

async function bootstrap() {
  loadEnvFiles();
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  configureApp(app);
  const { host, port } = loadConfig();
  await app.listen(port, host);
  Logger.log(`Gateway listening on http://${host}:${port}`, 'Bootstrap');
}

void bootstrap();
