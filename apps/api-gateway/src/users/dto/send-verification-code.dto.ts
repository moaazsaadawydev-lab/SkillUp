import { IsEmail, IsNotEmpty } from 'class-validator';

export class SendVerificationCodeDto {
  @IsNotEmpty({ message: 'Email is required' })
  @IsEmail({}, { message: 'Must be a valid email address' })
  email: string;
}
