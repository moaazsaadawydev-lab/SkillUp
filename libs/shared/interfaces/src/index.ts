import { UserRole } from '@skillup/shared/enums';

export interface IJwtPayload {
  sub: string;
  email: string;
  role: UserRole;
  iat?: number;
  exp?: number;
}

export interface IAuthenticatedUser {
  id: string;
  email: string;
  role: UserRole;
}

export interface IServiceResponse<T = unknown> {
  success: boolean;
  message?: string;
  data?: T;
  errorCode?: string;
}

export * from './users-grpc.interface';
