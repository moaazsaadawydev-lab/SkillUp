import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
  OnModuleInit,
  UnauthorizedException,
} from '@nestjs/common';
import { ClientGrpc } from '@nestjs/microservices';
import { firstValueFrom } from 'rxjs';
import {
  USERS_SERVICE_NAME,
  UsersServiceClient,
  LoginResponse,
} from '@skillup/shared/interfaces';
import { LoginDto } from '../dto/login.dto';
import { ClientConnectionInfo } from './account-verification.provider';

export interface LoginResult {
  success: boolean;
  message: string;
  accessToken?: string;
  refreshToken?: string;
  user?: any;
}

@Injectable()
export class LoginProvider implements OnModuleInit {
  private readonly logger = new Logger(LoginProvider.name);
  private usersServiceClient: UsersServiceClient;

  constructor(
    @Inject(USERS_SERVICE_NAME) private readonly usersGrpcClient: ClientGrpc,
  ) {}

  onModuleInit() {
    this.usersServiceClient =
      this.usersGrpcClient.getService<UsersServiceClient>(USERS_SERVICE_NAME);
  }

  /**
   * Handle user login via gRPC:
   * 1. Delegate authentication to users-service.
   * 2. Map gRPC status codes to appropriate NestJS HTTP exceptions:
   *    - RESOURCE_EXHAUSTED (8) -> 429 Too Many Requests (with Retry-After)
   *    - UNAUTHENTICATED (16)   -> 401 Unauthorized
   *    - FAILED_PRECONDITION (9)-> 400 Bad Request (Inactive/Unverified account)
   *    - PERMISSION_DENIED (7)  -> 403 Forbidden (Suspended account)
   * 3. Return tokens and authenticated user data.
   */
  async login(
    dto: LoginDto,
    clientInfo: ClientConnectionInfo,
  ): Promise<LoginResult> {
    try {
      const response: LoginResponse = await firstValueFrom(
        this.usersServiceClient.login({
          identifier: dto.identifier,
          password: dto.password,
          ipAddress: clientInfo.ipAddress,
          ip_address: clientInfo.ipAddress,
          userAgent: clientInfo.userAgent,
          user_agent: clientInfo.userAgent,
        }),
      );

      return {
        success: true,
        message: response.message || 'Logged in successfully',
        accessToken:
          response.data?.accessToken || response.data?.access_token,
        refreshToken:
          response.data?.refreshToken || response.data?.refresh_token,
        user: response.data?.user,
      };
    } catch (grpcError: any) {
      this.logger.error('gRPC Login call failed:', grpcError);

      const rawErrorMessage =
        grpcError.details || grpcError.message || 'Authentication failed';

      // 429 Too Many Requests: Brute-force lockout / Rate limiting
      if (
        grpcError.code === 8 || // RESOURCE_EXHAUSTED
        rawErrorMessage.toLowerCase().includes('too many') ||
        rawErrorMessage.toLowerCase().includes('15 minutes')
      ) {
        this.handleRateLimitError(rawErrorMessage, 900);
      }

      // 401 Unauthorized: Invalid credentials / wrong password / user not found
      if (
        grpcError.code === 16 || // UNAUTHENTICATED
        rawErrorMessage.toLowerCase().includes('invalid credentials') ||
        rawErrorMessage.toLowerCase().includes('unauthenticated')
      ) {
        throw new UnauthorizedException(rawErrorMessage);
      }

      // 400 Bad Request: Account unverified (PENDING)
      if (
        grpcError.code === 9 || // FAILED_PRECONDITION
        rawErrorMessage.toLowerCase().includes('not verified')
      ) {
        throw new BadRequestException(rawErrorMessage);
      }

      // 403 Forbidden: Account suspended / blocked
      if (
        grpcError.code === 7 || // PERMISSION_DENIED
        rawErrorMessage.toLowerCase().includes('suspended') ||
        rawErrorMessage.toLowerCase().includes('blocked')
      ) {
        throw new ForbiddenException(rawErrorMessage);
      }

      throw new InternalServerErrorException(rawErrorMessage);
    }
  }

  /**
   * Helper to parse dynamic Retry-After seconds and throw 429 Too Many Requests
   */
  private handleRateLimitError(
    rawErrorMessage: string,
    defaultSeconds: number,
  ): never {
    const ttlMatch = rawErrorMessage.match(/\[Retry-After:\s*(\d+)\]/);
    const retryAfterSeconds = ttlMatch
      ? parseInt(ttlMatch[1], 10)
      : defaultSeconds;
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
