import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';

/**
 * Converts any unhandled exception into a flat, non-revealing response.
 *
 * Scenario 31 requires that a database failure "does not disclose internal
 * database information". An uncaught `PrismaClientKnownRequestError` would
 * otherwise surface table names, column names and constraint identifiers in the
 * HTTP response, so anything that is not an explicit `HttpException` is
 * collapsed to a generic 503 here and the detail is kept in the server log.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request & { requestId?: string }>();
    const requestId = request.requestId;

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();

      response
        .status(status)
        .json(
          typeof body === 'string'
            ? { message: body, requestId }
            : { ...body, requestId },
        );
      return;
    }

    // Unknown failure: log the detail, return nothing that describes it.
    this.logger.error(
      `Unhandled exception on ${request.method} ${request.url} (requestId=${requestId})`,
      exception instanceof Error ? exception.stack : String(exception),
    );

    response.status(HttpStatus.SERVICE_UNAVAILABLE).json({
      message: 'Authentication service is temporarily unavailable',
      requestId,
    });
  }
}
