import { Injectable, Logger } from '@nestjs/common';
import {
  CreateUserRequest,
  CreateUserResponse,
  VerifyAccountRequest,
  VerifyAccountResponse,
  SendVerificationCodeRequest,
  ActionResponse,
  FindUserByIdRequest,
  UserResponse,
  ValidateUserRequest,
  UpdateProfileRequest,
  UpdateProfileResponse,
  ChangePasswordRequest,
  ForgotPasswordRequest,
  ResetPasswordRequest,
} from '@skillup/shared/interfaces';
import {
  RegisterProvider,
  VerifyAccountProvider,
  VerificationCodeProvider,
  UserQueryProvider,
  PasswordManagementProvider,
} from './providers';

/**
 * UsersService (Facade)
 * Acts as an orchestrator and unified gateway delegating endpoint operations
 * to specialized, single-responsibility domain providers in the providers/ directory.
 */
@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    private readonly registerProvider: RegisterProvider,
    private readonly verifyAccountProvider: VerifyAccountProvider,
    private readonly verificationCodeProvider: VerificationCodeProvider,
    private readonly userQueryProvider: UserQueryProvider,
    private readonly passwordManagementProvider: PasswordManagementProvider,
  ) {}

  /**
   * User registration endpoint logic
   */
  async createUser(request: CreateUserRequest): Promise<CreateUserResponse> {
    return this.registerProvider.createUser(request);
  }

  /**
   * Account verification and auto-login logic
   */
  async verifyAccount(
    request: VerifyAccountRequest,
  ): Promise<VerifyAccountResponse> {
    return this.verifyAccountProvider.verifyAccount(request);
  }

  /**
   * Resend OTP verification code with cooldown & lockout enforcement
   */
  async sendVerificationCode(
    request: SendVerificationCodeRequest,
  ): Promise<ActionResponse> {
    return this.verificationCodeProvider.sendVerificationCode(request);
  }

  /**
   * Query user profile by ID
   */
  async findUserById(request: FindUserByIdRequest): Promise<UserResponse> {
    return this.userQueryProvider.findUserById(request);
  }

  /**
   * Validate user credentials
   */
  async validateUser(request: ValidateUserRequest): Promise<UserResponse> {
    return this.userQueryProvider.validateUser(request);
  }

  /**
   * Update profile details
   */
  updateProfile(request: UpdateProfileRequest): UpdateProfileResponse {
    return this.passwordManagementProvider.updateProfile(request);
  }

  /**
   * Change user password
   */
  changePassword(request: ChangePasswordRequest): ActionResponse {
    return this.passwordManagementProvider.changePassword(request);
  }

  /**
   * Initiate forgot password flow
   */
  forgotPassword(request: ForgotPasswordRequest): ActionResponse {
    return this.passwordManagementProvider.forgotPassword(request);
  }

  /**
   * Complete password reset
   */
  resetPassword(request: ResetPasswordRequest): ActionResponse {
    return this.passwordManagementProvider.resetPassword(request);
  }
}
