import {
  IsEmail,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';

export class RegisterRequestDto {
  @IsNotEmpty({ message: 'Username is required' })
  @IsString({ message: 'Username must be a string' })
  @MinLength(3, { message: 'Username must be at least 3 characters long' })
  @MaxLength(50, { message: 'Username cannot exceed 50 characters' })
  username: string;

  @IsNotEmpty({ message: 'Email is required' })
  @IsEmail({}, { message: 'Must be a valid email address' })
  email: string;

  @IsNotEmpty({ message: 'Password is required' })
  @IsString({ message: 'Password must be a string' })
  @MinLength(8, { message: 'Password must be at least 8 characters long' })
  password: string;

  @IsOptional()
  @IsString()
  birthDate?: string;

  @IsOptional()
  @IsString()
  birth_date?: string;

  @IsOptional()
  @IsString({ message: 'tempPhotoKey must be a string' })
  @Matches(/^temp_uploads\/avatars\/[a-zA-Z0-9._-]+$/, {
    message: 'tempPhotoKey must be a valid key under temp_uploads/avatars/',
  })
  tempPhotoKey?: string;

  @IsOptional()
  @IsString({ message: 'temp_photo_key must be a string' })
  @Matches(/^temp_uploads\/avatars\/[a-zA-Z0-9._-]+$/, {
    message: 'temp_photo_key must be a valid key under temp_uploads/avatars/',
  })
  temp_photo_key?: string;

  // Crop coordinates: optional (backend automatically applies smart face/center crop if omitted)
  @IsOptional()
  @IsInt({ message: 'cropX must be an integer' })
  @Min(0, { message: 'cropX cannot be negative' })
  cropX?: number;

  @IsOptional()
  @IsInt({ message: 'cropY must be an integer' })
  @Min(0, { message: 'cropY cannot be negative' })
  cropY?: number;

  @IsOptional()
  @IsInt({ message: 'cropWidth must be an integer' })
  @Min(1, { message: 'cropWidth must be at least 1' })
  cropWidth?: number;

  @IsOptional()
  @IsInt({ message: 'cropHeight must be an integer' })
  @Min(1, { message: 'cropHeight must be at least 1' })
  cropHeight?: number;

  // Optional aliases for snake_case
  @IsOptional()
  @IsInt({ message: 'crop_x must be an integer' })
  @Min(0, { message: 'crop_x cannot be negative' })
  crop_x?: number;

  @IsOptional()
  @IsInt({ message: 'crop_y must be an integer' })
  @Min(0, { message: 'crop_y cannot be negative' })
  crop_y?: number;

  @IsOptional()
  @IsInt({ message: 'crop_width must be an integer' })
  @Min(1, { message: 'crop_width must be at least 1' })
  crop_width?: number;

  @IsOptional()
  @IsInt({ message: 'crop_height must be an integer' })
  @Min(1, { message: 'crop_height must be at least 1' })
  crop_height?: number;

  @IsOptional()
  @IsInt({ message: 'rotate must be an integer' })
  rotate?: number;

  @IsOptional()
  @IsNumber({}, { message: 'scale must be a number' })
  scale?: number;

  @IsOptional()
  @IsNumber({}, { message: 'zoom must be a number' })
  zoom?: number;
}
