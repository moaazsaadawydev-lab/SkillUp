import { Injectable, Logger } from '@nestjs/common';
import sharp from 'sharp';
import { ImageTransformations } from '@skillup/shared/interfaces';

@Injectable()
export class ImageProcessorService {
  private readonly logger = new Logger(ImageProcessorService.name);

  // SVG circular mask matching the 500x500 dimensions
  private readonly circleMask = Buffer.from(
    '<svg width="500" height="500"><circle cx="250" cy="250" r="250" fill="#fff" /></svg>',
  );

  /**
   * Processes raw profile avatar buffer:
   * 1. Inspects image metadata and applies rotation if requested.
   * 2. CASE A: Explicit valid crop coordinates provided -> clamps coordinates safely and extracts crop area.
   * 3. CASE B: Fallback -> Safe Center Square Crop if no coordinates provided (or if coordinates invalid).
   * 4. Standardizes final avatar to 500x500.
   * 5. Applies circular SVG mask with dest-in blending.
   * 6. Converts to optimized WebP format (quality: 90).
   */
  async processProfileAvatar(
    inputBuffer: Buffer,
    transformations?: ImageTransformations,
  ): Promise<Buffer> {
    try {
      const image = sharp(inputBuffer);
      const metadata = await image.metadata();
      let imgWidth = metadata.width || 500;
      let imgHeight = metadata.height || 500;

      let pipeline = image;

      // Apply rotation if requested
      if (transformations?.rotate) {
        pipeline = pipeline.rotate(transformations.rotate);

        // Swap width and height if rotated 90 or 270 degrees
        if (Math.abs(transformations.rotate) % 180 !== 0) {
          [imgWidth, imgHeight] = [imgHeight, imgWidth];
        }
      }

      const cropX = transformations?.cropX ?? transformations?.crop_x;
      const cropY = transformations?.cropY ?? transformations?.crop_y;
      const cropWidth = transformations?.cropWidth ?? transformations?.crop_width;
      const cropHeight = transformations?.cropHeight ?? transformations?.crop_height;

      // CASE A: Explicit valid crop coordinates provided
      if (
        cropWidth !== undefined &&
        cropHeight !== undefined &&
        cropWidth > 0 &&
        cropHeight > 0
      ) {
        // Clamp boundaries to prevent sharp out-of-bounds error
        const left = Math.max(0, Math.min(Math.round(cropX || 0), imgWidth - 1));
        const top = Math.max(0, Math.min(Math.round(cropY || 0), imgHeight - 1));
        const width = Math.min(Math.round(cropWidth), imgWidth - left);
        const height = Math.min(Math.round(cropHeight), imgHeight - top);

        if (width > 0 && height > 0) {
          pipeline = pipeline.extract({ left, top, width, height });
          this.logger.debug(
            `[CASE A] Applied explicit crop: left=${left}, top=${top}, width=${width}, height=${height} (image dimensions: ${imgWidth}x${imgHeight})`,
          );
        } else {
          // If clamped area resulted in zero, fallback to center square crop
          const minDimension = Math.min(imgWidth, imgHeight);
          pipeline = pipeline.resize(minDimension, minDimension, {
            fit: 'cover',
            position: 'center',
          });
          this.logger.debug(
            `[CASE A Fallback] Crop clamping resulted in zero dimensions; applied center square crop: ${minDimension}x${minDimension}`,
          );
        }
      } else {
        // CASE B: Fallback - Safe Center Square Crop if no coordinates provided
        const minDimension = Math.min(imgWidth, imgHeight);
        pipeline = pipeline.resize(minDimension, minDimension, {
          fit: 'cover',
          position: 'center',
        });
        this.logger.debug(
          `[CASE B Fallback] No crop coordinates provided; applied safe center square crop: ${minDimension}x${minDimension}`,
        );
      }

      // Standardize final avatar to 500x500
      pipeline = pipeline.resize(500, 500);

      // Apply Circular SVG Mask and convert to WebP
      const finalBuffer = await pipeline
        .composite([{ input: this.circleMask, blend: 'dest-in' }])
        .webp({ quality: 90 })
        .toBuffer();

      this.logger.log(
        `Successfully processed profile avatar: input size=${inputBuffer.length} bytes, output size=${finalBuffer.length} bytes`,
      );

      return finalBuffer;
    } catch (error) {
      this.logger.error(
        'Failed to process profile avatar image:',
        error instanceof Error ? error.stack : error,
      );
      throw error;
    }
  }
}
