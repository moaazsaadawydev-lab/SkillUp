import { IsNotEmpty, IsString, MinLength, MaxLength } from 'class-validator';

export class LoginDto {
  @IsNotEmpty({ message: 'Email or username is required.' })
  @IsString({ message: 'Identifier must be a string.' })
  @MaxLength(255, { message: 'Identifier cannot exceed 255 characters.' })
  identifier: string;

  @IsNotEmpty({ message: 'Password is required.' })
  @IsString({ message: 'Password must be a string.' })
  @MinLength(8, { message: 'Password must be at least 8 characters long.' })
  password: string;
}
