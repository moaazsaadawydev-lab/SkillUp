import { Injectable } from '@nestjs/common';
import { CreateUserResponse } from '@skillup/shared/interfaces';
import { RegisterRequestDto } from './dto/register-request.dto';
import { VerifyAccountDto } from './dto/verify-account.dto';
import { SendVerificationCodeDto } from './dto/send-verification-code.dto';
import { LoginDto } from './dto/login.dto';
import {
  RegistrationProvider,
  AccountVerificationProvider,
  VerificationCodeProvider,
  LoginProvider,
  ClientConnectionInfo,
  VerifyAccountResult,
  LoginResult,
} from './providers';

/**
 * AuthService (Facade)
 * Coordinates authentication flows by delegating requests to specialized providers
 * organized by endpoint category in the providers/ directory.
 */
@Injectable()
export class AuthService {
  constructor(
    private readonly registrationProvider: RegistrationProvider,
    private readonly accountVerificationProvider: AccountVerificationProvider,
    private readonly verificationCodeProvider: VerificationCodeProvider,
    private readonly loginProvider: LoginProvider,
  ) {}

  /**
   * User registration flow delegation
   */
  async register(dto: RegisterRequestDto): Promise<CreateUserResponse> {
    return this.registrationProvider.register(dto);
  }

  /**
   * Account verification and auto-login session delegation
   */
  async verifyAccount(
    dto: VerifyAccountDto,
    clientInfo: ClientConnectionInfo,
  ): Promise<VerifyAccountResult> {
    return this.accountVerificationProvider.verifyAccount(dto, clientInfo);
  }

  /**
   * Resend verification code delegation
   */
  async sendVerificationCode(dto: SendVerificationCodeDto) {
    return this.verificationCodeProvider.sendVerificationCode(dto);
  }

  /**
   * User login delegation
   */
  async login(
    dto: LoginDto,
    clientInfo: ClientConnectionInfo,
  ): Promise<LoginResult> {
    return this.loginProvider.login(dto, clientInfo);
  }
}
