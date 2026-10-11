import {
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

export class GetPresignedUrlDto {
  @IsString()
  @IsNotEmpty({ message: 'filename is required' })
  filename: string;

  @IsString()
  @IsNotEmpty({ message: 'contentType is required' })
  @IsIn(['image/jpeg', 'image/jpg', 'image/png', 'image/webp'], {
    message: 'contentType must be one of: image/jpeg, image/png, image/webp',
  })
  contentType: string;

  @IsNumber()
  @Min(1, { message: 'fileSize must be greater than 0' })
  @Max(5 * 1024 * 1024, { message: 'fileSize cannot exceed 5MB' })
  fileSize: number;

  @IsOptional()
  @IsString()
  category?: string;
}
