import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';

import type { AuthContext } from '../auth-context';

/** Injects the authenticated principal attached by JwtAuthGuard. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthContext => {
    const request = ctx
      .switchToHttp()
      .getRequest<Request & { user?: AuthContext }>();
    return request.user as AuthContext;
  },
);
