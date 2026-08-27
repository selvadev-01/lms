import { Injectable, NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

declare module 'express' {
  interface Request {
    requestId?: string;
  }
}

/**
 * Assigns a correlation id to every request.
 *
 * `AuditLog.requestId` is a UUID column, so an inbound header is only trusted
 * when it actually parses as a UUID — otherwise a caller could poison the audit
 * trail (or break the insert) with arbitrary text.
 */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const inbound = req.header('x-request-id');
    req.requestId = inbound && UUID_RE.test(inbound) ? inbound : randomUUID();
    res.setHeader('X-Request-Id', req.requestId);
    next();
  }
}
