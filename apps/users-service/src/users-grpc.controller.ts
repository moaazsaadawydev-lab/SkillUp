import { Controller, Logger } from '@nestjs/common';
import { GrpcMethod } from '@nestjs/microservices';
import {
  USERS_SERVICE_NAME,
  UsersServiceController,
  CreateUserRequest,
  CreateUserResponse,
  FindUserByIdRequest,
  ValidateUserRequest,
  UserResponse,
  UpdateProfileRequest,
  UpdateProfileResponse,
  ChangePasswordRequest,
  ForgotPasswordRequest,
  ResetPasswordRequest,
  ActionResponse,
} from '@skillup/shared/interfaces';
import { UsersService } from './users.service';

@Controller()
export class UsersGrpcController implements UsersServiceController {
  private readonly logger = new Logger(UsersGrpcController.name);

  constructor(private readonly usersService: UsersService) {}

  @GrpcMethod(USERS_SERVICE_NAME, 'CreateUser')
  async createUser(request: CreateUserRequest): Promise<CreateUserResponse> {
    this.logger.log(`gRPC CreateUser called for email: ${request.email}`);
    return this.usersService.createUser(request);
  }

  @GrpcMethod(USERS_SERVICE_NAME, 'FindUserById')
  findUserById(request: FindUserByIdRequest): UserResponse {
    this.logger.log(`gRPC FindUserById called for user: ${request.id}`);
    return {
      id: request.id,
      email: 'placeholder@skillup.com',
      username: 'placeholder_user',
      role: 'STUDENT',
      status: 'ACTIVE',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }

  @GrpcMethod(USERS_SERVICE_NAME, 'ValidateUser')
  validateUser(request: ValidateUserRequest): UserResponse {
    this.logger.log(`gRPC ValidateUser called for email: ${request.email}`);
    return {
      id: 'placeholder-uuid',
      email: request.email,
      username: 'placeholder_user',
      role: 'STUDENT',
      status: 'ACTIVE',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }

  @GrpcMethod(USERS_SERVICE_NAME, 'UpdateProfile')
  updateProfile(request: UpdateProfileRequest): UpdateProfileResponse {
    this.logger.log(`gRPC UpdateProfile called for user: ${request.userId}`);
    return {
      success: true,
      message: 'Profile updated successfully (placeholder)',
      userId: request.userId,
    };
  }

  @GrpcMethod(USERS_SERVICE_NAME, 'ChangePassword')
  changePassword(request: ChangePasswordRequest): ActionResponse {
    this.logger.log(`gRPC ChangePassword called for user: ${request.userId}`);
    return {
      success: true,
      message: 'Password changed successfully (placeholder)',
    };
  }

  @GrpcMethod(USERS_SERVICE_NAME, 'ForgotPassword')
  forgotPassword(request: ForgotPasswordRequest): ActionResponse {
    this.logger.log(`gRPC ForgotPassword called for email: ${request.email}`);
    return {
      success: true,
      message: 'Password reset code sent successfully (placeholder)',
    };
  }

  @GrpcMethod(USERS_SERVICE_NAME, 'ResetPassword')
  resetPassword(request: ResetPasswordRequest): ActionResponse {
    this.logger.log(`gRPC ResetPassword called for email: ${request.email}`);
    return {
      success: true,
      message: 'Password has been reset successfully (placeholder)',
    };
  }
}
