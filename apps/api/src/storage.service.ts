import { BadRequestException, Injectable, ServiceUnavailableException } from "@nestjs/common";
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { randomUUID } from "node:crypto";
import { loadConfig } from "./config.js";

const allowedTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
const maxBytes = 5 * 1024 * 1024;

@Injectable()
export class StorageService {
  private readonly config = loadConfig();

  validateImage(contentType: string, size: number) {
    if (!allowedTypes.has(contentType)) throw new BadRequestException("Only JPEG, PNG, and WebP images are permitted.");
    if (size <= 0 || size > maxBytes) throw new BadRequestException("Image size must be between 1 byte and 5 MiB.");
  }

  client() {
    if (!this.config.S3_ENDPOINT || !this.config.S3_BUCKET || !this.config.S3_ACCESS_KEY_ID || !this.config.S3_SECRET_ACCESS_KEY) {
      throw new ServiceUnavailableException("Object storage is not configured in this environment.");
    }
    return new S3Client({
      endpoint: this.config.S3_ENDPOINT,
      region: this.config.S3_REGION,
      forcePathStyle: this.config.S3_FORCE_PATH_STYLE === "true",
      credentials: { accessKeyId: this.config.S3_ACCESS_KEY_ID, secretAccessKey: this.config.S3_SECRET_ACCESS_KEY },
    });
  }

  private extension(contentType: string) {
    return ({ "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" } as const)[contentType as "image/jpeg" | "image/png" | "image/webp"];
  }

  async putItemImage(itemId: string, bytes: Uint8Array, contentType: string, declaredSize: number) {
    this.validateImage(contentType, declaredSize);
    if (bytes.byteLength !== declaredSize) throw new BadRequestException("Image byte length does not match the declared upload size.");
    const extension = this.extension(contentType);
    if (!extension) throw new BadRequestException("Unsupported image content type.");
    const key = `items/${itemId}/${randomUUID()}.${extension}`;
    const client = this.client();
    await client.send(new PutObjectCommand({ Bucket: this.config.S3_BUCKET!, Key: key, Body: bytes, ContentType: contentType, ContentLength: bytes.byteLength }));
    return key;
  }

  async signedItemImageUrl(key: string) {
    if (!key.startsWith("items/")) throw new BadRequestException("Invalid item image reference.");
    const client = this.client();
    return getSignedUrl(client, new GetObjectCommand({ Bucket: this.config.S3_BUCKET!, Key: key }), { expiresIn: 300 });
  }

  async removeItemImage(key: string | null | undefined) {
    if (!key) return;
    if (!key.startsWith("items/")) throw new BadRequestException("Invalid item image reference.");
    const client = this.client();
    await client.send(new DeleteObjectCommand({ Bucket: this.config.S3_BUCKET!, Key: key }));
  }
}
