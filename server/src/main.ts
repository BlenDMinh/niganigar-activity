import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '../.env') });

import { NestFactory } from '@nestjs/core';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors({ origin: process.env.CORS_ORIGIN ?? '*' });
  app.useWebSocketAdapter(new IoAdapter(app));
  app.setGlobalPrefix('api');
  await app.listen(process.env.PORT ?? 3001);
}
void bootstrap();
