import { Controller, Logger } from '@nestjs/common';
import { GrpcMethod } from '@nestjs/microservices';
import {
  USERS_SERVICE_NAME,
  UsersServiceController,
  CreateUserRequest,
  CreateUserResponse,
  VerifyAccountRequest,
  VerifyAccountResponse,
  SendVerificationCodeRequest,
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
    this.logger.debug(`gRPC CreateUser called for email: ${request.email}`);
    return this.usersService.createUser(request);
  }

  @GrpcMethod(USERS_SERVICE_NAME, 'VerifyAccount')
  async verifyAccount(request: VerifyAccountRequest): Promise<VerifyAccountResponse> {
    this.logger.debug(`gRPC VerifyAccount called for email: ${request.email}`);
    return this.usersService.verifyAccount(request);
  }

  @GrpcMethod(USERS_SERVICE_NAME, 'SendVerificationCode')
  async sendVerificationCode(
    request: SendVerificationCodeRequest,
  ): Promise<ActionResponse> {
    this.logger.debug(`gRPC SendVerificationCode called for email: ${request.email}`);
    return this.usersService.sendVerificationCode(request);
  }

  @GrpcMethod(USERS_SERVICE_NAME, 'FindUserById')
  async findUserById(request: FindUserByIdRequest): Promise<UserResponse> {
    this.logger.debug(`gRPC FindUserById called for user: ${request.id}`);
    return this.usersService.findUserById(request);
  }

  @GrpcMethod(USERS_SERVICE_NAME, 'ValidateUser')
  async validateUser(request: ValidateUserRequest): Promise<UserResponse> {
    this.logger.debug(`gRPC ValidateUser called for email: ${request.email}`);
    return this.usersService.validateUser(request);
  }

  @GrpcMethod(USERS_SERVICE_NAME, 'UpdateProfile')
  async updateProfile(request: UpdateProfileRequest): Promise<UpdateProfileResponse> {
    this.logger.debug(`gRPC UpdateProfile called for user: ${request.userId}`);
    return this.usersService.updateProfile(request);
  }

  @GrpcMethod(USERS_SERVICE_NAME, 'ChangePassword')
  async changePassword(request: ChangePasswordRequest): Promise<ActionResponse> {
    this.logger.debug(`gRPC ChangePassword called for user: ${request.userId}`);
    return this.usersService.changePassword(request);
  }

  @GrpcMethod(USERS_SERVICE_NAME, 'ForgotPassword')
  async forgotPassword(request: ForgotPasswordRequest): Promise<ActionResponse> {
    this.logger.debug(`gRPC ForgotPassword called for email: ${request.email}`);
    return this.usersService.forgotPassword(request);
  }

  @GrpcMethod(USERS_SERVICE_NAME, 'ResetPassword')
  async resetPassword(request: ResetPasswordRequest): Promise<ActionResponse> {
    this.logger.debug(`gRPC ResetPassword called for email: ${request.email}`);
    return this.usersService.resetPassword(request);
  }
}
