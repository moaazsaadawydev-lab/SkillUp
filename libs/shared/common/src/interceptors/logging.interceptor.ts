import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger(LoggingInterceptor.name);

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const now = Date.now();
    const req = context.switchToHttp().getRequest();
    const method = req?.method || 'RPC/MSG';
    const url = req?.url || context.getHandler().name;

    return next
      .handle()
      .pipe(
        tap(() =>
          this.logger.log(`[${method}] ${url} completed in ${Date.now() - now}ms`),
        ),
      );
  }
}
