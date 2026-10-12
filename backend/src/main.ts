import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { env } from './common/env';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('api');
  app.enableCors({ origin: env.publicUrl });
  // whitelist: descarta campos que no están en el DTO (evita inyectar "status: TALLIED" en un body)
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  await app.listen(env.port);
  console.log(`API en http://localhost:${env.port}/api`);
}
bootstrap();
