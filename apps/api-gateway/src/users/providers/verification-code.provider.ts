import {
  BadRequestException,
  ForbiddenException,
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
} from '@skillup/shared/interfaces';
import { SendVerificationCodeDto } from '../dto/send-verification-code.dto';

@Injectable()
export class VerificationCodeProvider implements OnModuleInit {
  private readonly logger = new Logger(VerificationCodeProvider.name);
  private usersServiceClient: UsersServiceClient;

  constructor(
    @Inject(USERS_SERVICE_NAME) private readonly usersGrpcClient: ClientGrpc,
  ) {}

  onModuleInit() {
    this.usersServiceClient =
      this.usersGrpcClient.getService<UsersServiceClient>(USERS_SERVICE_NAME);
  }

  /**
   * Re-send verification code subject to 60-second cooldown timer
   */
  async sendVerificationCode(dto: SendVerificationCodeDto) {
    try {
      const response = await firstValueFrom(
        this.usersServiceClient.sendVerificationCode({
          email: dto.email,
        }),
      );

      return {
        success: response.success,
        message: response.message,
      };
    } catch (grpcError: any) {
      this.logger.error('gRPC SendVerificationCode call failed:', grpcError);

      const rawErrorMessage =
        grpcError.details ||
        grpcError.message ||
        'Failed to send verification code';

      // 429 Too Many Requests: 60-second cooldown active or 15-min lockout
      if (
        grpcError.code === 8 || // RESOURCE_EXHAUSTED
        rawErrorMessage.toLowerCase().includes('please wait') ||
        rawErrorMessage.toLowerCase().includes('too many') ||
        rawErrorMessage.toLowerCase().includes('locked')
      ) {
        this.handleRateLimitError(rawErrorMessage, 60);
      }

      // 400 Bad Request: Account already active / preconditions
      if (
        grpcError.code === 3 || // INVALID_ARGUMENT
        grpcError.code === 9 || // FAILED_PRECONDITION
        rawErrorMessage.toLowerCase().includes('already active')
      ) {
        throw new BadRequestException(rawErrorMessage);
      }

      // 403 Forbidden: Account blocked or deleted
      if (
        grpcError.code === 7 || // PERMISSION_DENIED
        rawErrorMessage.toLowerCase().includes('not eligible')
      ) {
        throw new ForbiddenException(rawErrorMessage);
      }

      // 404 Not Found: User not found
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
