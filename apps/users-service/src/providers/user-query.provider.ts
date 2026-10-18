import { Injectable, Logger } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { status } from '@grpc/grpc-js';
import { DataSource } from 'typeorm';
import { User } from '@skillup/shared/entities';
import {
  FindUserByIdRequest,
  UserResponse,
  ValidateUserRequest,
} from '@skillup/shared/interfaces';

@Injectable()
export class UserQueryProvider {
  private readonly logger = new Logger(UserQueryProvider.name);

  constructor(private readonly dataSource: DataSource) {}

  async findUserById(request: FindUserByIdRequest): Promise<UserResponse> {
    const user = await this.dataSource.getRepository(User).findOne({
      where: { id: request.id },
    });

    if (!user) {
      throw new RpcException({
        code: status.NOT_FOUND,
        message: `User with id "${request.id}" not found`,
      });
    }

    return {
      id: user.id,
      email: user.email,
      username: user.username,
      role: user.role,
      status: user.status,
      createdAt: user.createdAt.toISOString(),
      updatedAt: user.updatedAt.toISOString(),
    };
  }

  async validateUser(request: ValidateUserRequest): Promise<UserResponse> {
    const user = await this.dataSource.getRepository(User).findOne({
      where: { email: request.email },
    });

    if (!user) {
      throw new RpcException({
        code: status.NOT_FOUND,
        message: 'Invalid credentials',
      });
    }

    return {
      id: user.id,
      email: user.email,
      username: user.username,
      role: user.role,
      status: user.status,
      createdAt: user.createdAt.toISOString(),
      updatedAt: user.updatedAt.toISOString(),
    };
  }
}
