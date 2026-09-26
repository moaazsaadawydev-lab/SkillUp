import {
  IsEmail,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  MinLength,
  MaxLength,
} from 'class-validator';
import { Type } from 'class-transformer';

export class RegisterRequestDto {
  @IsNotEmpty({ message: 'Username is required' })
  @IsString()
  @MinLength(3, { message: 'Username must be at least 3 characters long' })
  @MaxLength(50, { message: 'Username cannot exceed 50 characters' })
  username: string;

  @IsNotEmpty({ message: 'Email is required' })
  @IsEmail({}, { message: 'Must be a valid email address' })
  email: string;

  @IsNotEmpty({ message: 'Password is required' })
  @IsString()
  @MinLength(8, { message: 'Password must be at least 8 characters long' })
  password: string;

  @IsOptional()
  @IsString()
  birth_date?: string;

  @IsOptional()
  @IsString()
  birthDate?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'crop_x must be an integer' })
  @Min(0, { message: 'crop_x cannot be negative' })
  crop_x?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'crop_y must be an integer' })
  @Min(0, { message: 'crop_y cannot be negative' })
  crop_y?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'crop_width must be an integer' })
  @Min(1, { message: 'crop_width must be at least 1' })
  crop_width?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'crop_height must be an integer' })
  @Min(1, { message: 'crop_height must be at least 1' })
  crop_height?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  cropX?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  cropY?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  cropWidth?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  cropHeight?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  rotate?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  scale?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  zoom?: number;
}

