import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Response, Request } from 'express';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    const message =
      exception instanceof HttpException
        ? exception.getResponse()
        : 'Internal Server Error';

    this.logger.error(
      `[${request?.method || 'UNKNOWN'}] ${request?.url || ''} - Status: ${status} - Error: ${JSON.stringify(message)}`,
    );

    if (response && typeof response.status === 'function') {
      response.status(status).json({
        success: false,
        statusCode: status,
        message: typeof message === 'object' ? (message as Record<string, unknown>)['message'] || message : message,
        error: typeof message === 'object' ? (message as Record<string, unknown>)['error'] || null : null,
        timestamp: new Date().toISOString(),
        path: request?.url,
      });
    }
  }
}
