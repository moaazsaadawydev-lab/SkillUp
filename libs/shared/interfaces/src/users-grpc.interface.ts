import { Observable } from 'rxjs';

export const USERS_PACKAGE_NAME = 'users';
export const USERS_SERVICE_NAME = 'UsersService';

// =============================================================================
// Data Contracts (DTOs)
// =============================================================================

export interface ImageTransformations {
  cropX?: number;
  cropY?: number;
  cropWidth?: number;
  cropHeight?: number;
  crop_x?: number;
  crop_y?: number;
  crop_width?: number;
  crop_height?: number;
  rotate?: number;
  scale?: number;
  zoom?: number;
}

export interface CreateUserRequest {
  id?: string;
  username: string;
  email: string;
  password: string;
  birthDate?: string;
  birth_date?: string;
  profilePhoto?: string;
  profile_photo?: string;
  tempPhotoKey?: string;
  temp_photo_key?: string;
  transformations?: ImageTransformations;
}

export interface CreateUserResponse {
  success: boolean;
  message: string;
  userId: string;
}

export interface FindUserByIdRequest {
  id: string;
}

export interface ValidateUserRequest {
  email: string;
  password: string;
}

export interface UserResponse {
  id: string;
  email: string;
  username: string;
  role: string;
  status: string;
  profilePhoto?: string;
  birthDate?: string;
  createdAt: string;
  updatedAt: string;
}

export interface UpdateProfileRequest {
  userId: string;
  tempKey?: string;
  oldPhoto?: string;
  newPhotoKey?: string;
  username?: string;
  birthDate?: string;
  profilePhoto?: string;
}

export interface UpdateProfileResponse {
  success: boolean;
  message: string;
  userId: string;
}

export interface ChangePasswordRequest {
  userId: string;
  oldPassword: string;
  newPassword: string;
  userAgent: string;
  ipAddress: string;
  jti: string;
}

export interface ForgotPasswordRequest {
  email: string;
  ipAddress: string;
}

export interface ResetPasswordRequest {
  email: string;
  code: string;
  newPassword: string;
}

export interface ActionResponse {
  success: boolean;
  message: string;
}

export interface VerifyAccountRequest {
  email: string;
  code: string;
  ipAddress?: string;
  ip_address?: string;
  userAgent?: string;
  user_agent?: string;
}

export interface AuthData {
  accessToken: string;
  refreshToken: string;
  access_token?: string;
  refresh_token?: string;
  user: UserResponse;
}

export interface VerifyAccountResponse {
  success: boolean;
  message: string;
  data: AuthData;
}

// =============================================================================
// gRPC Client & Controller Interfaces
// =============================================================================

export interface UsersServiceClient {
  createUser(request: CreateUserRequest): Observable<CreateUserResponse>;
  verifyAccount(request: VerifyAccountRequest): Observable<VerifyAccountResponse>;
  findUserById(request: FindUserByIdRequest): Observable<UserResponse>;
  validateUser(request: ValidateUserRequest): Observable<UserResponse>;
  updateProfile(request: UpdateProfileRequest): Observable<UpdateProfileResponse>;
  changePassword(request: ChangePasswordRequest): Observable<ActionResponse>;
  forgotPassword(request: ForgotPasswordRequest): Observable<ActionResponse>;
  resetPassword(request: ResetPasswordRequest): Observable<ActionResponse>;
}

export interface UsersServiceController {
  createUser(
    request: CreateUserRequest,
  ): Promise<CreateUserResponse> | Observable<CreateUserResponse> | CreateUserResponse;
  verifyAccount(
    request: VerifyAccountRequest,
  ):
    | Promise<VerifyAccountResponse>
    | Observable<VerifyAccountResponse>
    | VerifyAccountResponse;
  findUserById(
    request: FindUserByIdRequest,
  ): Promise<UserResponse> | Observable<UserResponse> | UserResponse;
  validateUser(
    request: ValidateUserRequest,
  ): Promise<UserResponse> | Observable<UserResponse> | UserResponse;
  updateProfile(
    request: UpdateProfileRequest,
  ):
    | Promise<UpdateProfileResponse>
    | Observable<UpdateProfileResponse>
    | UpdateProfileResponse;
  changePassword(
    request: ChangePasswordRequest,
  ): Promise<ActionResponse> | Observable<ActionResponse> | ActionResponse;
  forgotPassword(
    request: ForgotPasswordRequest,
  ): Promise<ActionResponse> | Observable<ActionResponse> | ActionResponse;
  resetPassword(
    request: ResetPasswordRequest,
  ): Promise<ActionResponse> | Observable<ActionResponse> | ActionResponse;
}
