import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { ClientGrpc } from '@nestjs/microservices';
import { firstValueFrom } from 'rxjs';
import {
  USERS_SERVICE_NAME,
  UsersServiceClient,
  VerifyAccountResponse,
} from '@skillup/shared/interfaces';
import { VerifyAccountDto } from '../dto/verify-account.dto';

export interface ClientConnectionInfo {
  ipAddress: string;
  userAgent: string;
}

export interface VerifyAccountResult {
  success: boolean;
  message: string;
  accessToken?: string;
  refreshToken?: string;
  user?: any;
}

@Injectable()
export class AccountVerificationProvider implements OnModuleInit {
  private readonly logger = new Logger(AccountVerificationProvider.name);
  private usersServiceClient: UsersServiceClient;

  constructor(
    @Inject(USERS_SERVICE_NAME) private readonly usersGrpcClient: ClientGrpc,
  ) {}

  onModuleInit() {
    this.usersServiceClient =
      this.usersGrpcClient.getService<UsersServiceClient>(USERS_SERVICE_NAME);
  }

  /**
   * Handle account verification and auto-login:
   * 1. Call UsersService gRPC VerifyAccount.
   * 2. Translate rate limiting (429), validation (400), or not-found (404) errors.
   * 3. Return tokens and activated user profile.
   */
  async verifyAccount(
    dto: VerifyAccountDto,
    clientInfo: ClientConnectionInfo,
  ): Promise<VerifyAccountResult> {
    try {
      const response: VerifyAccountResponse = await firstValueFrom(
        this.usersServiceClient.verifyAccount({
          email: dto.email,
          code: dto.code,
          ipAddress: clientInfo.ipAddress,
          ip_address: clientInfo.ipAddress,
          userAgent: clientInfo.userAgent,
          user_agent: clientInfo.userAgent,
        }),
      );

      return {
        success: true,
        message: response.message || 'Account verified and logged in successfully',
        accessToken:
          response.data?.accessToken || response.data?.access_token,
        refreshToken:
          response.data?.refreshToken || response.data?.refresh_token,
        user: response.data?.user,
      };
    } catch (grpcError: any) {
      this.logger.error('gRPC VerifyAccount call failed:', grpcError);

      const rawErrorMessage =
        grpcError.details || grpcError.message || 'Verification failed';

      // 429 Too Many Requests: Rate limiting / Brute-force lockout
      if (
        grpcError.code === 8 || // RESOURCE_EXHAUSTED
        rawErrorMessage.toLowerCase().includes('too many') ||
        rawErrorMessage.toLowerCase().includes('15 minutes')
      ) {
        this.handleRateLimitError(rawErrorMessage, 900);
      }

      // 400 Bad Request for invalid OTP, remaining attempts, expired, already active
      if (
        grpcError.code === 3 || // INVALID_ARGUMENT
        grpcError.code === 9 || // FAILED_PRECONDITION
        rawErrorMessage.toLowerCase().includes('invalid') ||
        rawErrorMessage.toLowerCase().includes('attempts remaining') ||
        rawErrorMessage.toLowerCase().includes('expired') ||
        rawErrorMessage.toLowerCase().includes('already active')
      ) {
        throw new BadRequestException(rawErrorMessage);
      }

      // 404 Not Found: User record not found
      if (
        grpcError.code === 5 || // NOT_FOUND
        rawErrorMessage.toLowerCase().includes('not found')
      ) {
        throw new NotFoundException(rawErrorMessage);
      }

      throw new InternalServerErrorException(rawErrorMessage);
    }
  }

  /**
   * Helper to parse Retry-After seconds and throw 429 Too Many Requests
   */
  private handleRateLimitError(rawErrorMessage: string, defaultSeconds: number): never {
    const ttlMatch = rawErrorMessage.match(/\[Retry-After:\s*(\d+)\]/);
    const retryAfterSeconds = ttlMatch ? parseInt(ttlMatch[1], 10) : defaultSeconds;
    const cleanMessage = rawErrorMessage
      .replace(/\s*\[Retry-After:\s*\d+\]/, '')
      .trim();

    throw new HttpException(
      {
        statusCode: HttpStatus.TOO_MANY_REQUESTS,
        message: cleanMessage,
        error: 'Too Many Requests',
        retryAfter: retryAfterSeconds,
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}
