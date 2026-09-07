import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { IAuthenticatedUser } from '@skillup/shared/interfaces';

export const CurrentUser = createParamDecorator(
  (data: keyof IAuthenticatedUser | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    const user = request.user as IAuthenticatedUser;

    if (!user) {
      return null;
    }

    return data ? user[data] : user;
  },
);
