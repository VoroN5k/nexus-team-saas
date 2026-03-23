import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import * as dotenv from 'dotenv';
import { ValidationPipe } from '@nestjs/common';
import cookieParser from 'cookie-parser';

async function bootstrap() {

  dotenv.config(); // Load environment variables from .env file

  const app = await NestFactory.create(AppModule);

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }));

    app.setGlobalPrefix('api'); // Set global prefix for all routes
    app.use(cookieParser()); // Use cookie parser middleware

    app.enableCors({
      origin: 'http://localhost:3000', // Allow requests from this origin
      credentials: true, // Allow cookies to be sent with requests
    })



  await app.listen(process.env.PORT ?? 4000);
  console.log(`Server is running on port ${process.env.PORT ?? 4000}`);
}
bootstrap();