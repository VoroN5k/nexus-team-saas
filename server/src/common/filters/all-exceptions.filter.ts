import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';

interface ErrorBody {
  statusCode: number;
  message:    string | string[];
  error?:     string;
  path:       string;
  timestamp:  string;
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);
  private readonly isProd = process.env.NODE_ENV === 'production';

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx  = host.switchToHttp();
    const res  = ctx.getResponse<Response>();
    const req  = ctx.getRequest<Request>();

    let status  = HttpStatus.INTERNAL_SERVER_ERROR;
    let message: string | string[] = 'Internal server error';
    let error: string | undefined;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse();

      if (typeof body === 'string') {
        message = body;
      } else if (typeof body === 'object' && body !== null) {
        const b = body as Record<string, unknown>;
        message = (b.message as string | string[]) ?? message;
        error   = b.error as string | undefined;
      }
    } else {
      // Unknown error — log full details, never expose in prod
      this.logger.error(
        `Unhandled exception on ${req.method} ${req.url}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    const body: ErrorBody = {
      statusCode: status,
      message:    this.isProd && status >= 500 ? 'Internal server error' : message,
      ...(error && !this.isProd ? { error } : {}),
      path:       req.url,
      timestamp:  new Date().toISOString(),
    };

    res.status(status).json(body);
  }
}