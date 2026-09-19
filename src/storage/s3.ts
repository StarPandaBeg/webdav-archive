import {
  S3Client,
  PutObjectCommand,
  CreateMultipartUploadCommand,
  UploadPartCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { createUuid, parseHttpUrl } from "./transfer";
import type {
  DownloadContext,
  DownloadResult,
  StorageProvider,
  TransferProgress,
  UploadedObject,
  UploadSource,
} from "./types";
import { t } from "../i18n";

const MULTIPART_THRESHOLD = 8 * 1024 * 1024; // 8 MiB
const PART_SIZE = 8 * 1024 * 1024; // 8 MiB

export interface S3StorageConfig {
  endpoint?: string;
  region?: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  remotePrefix?: string;
  forcePathStyle?: boolean;
  presignedExpiration?: number;
}

export class S3StorageProvider implements StorageProvider {
  readonly storageType = "s3" as const;
  private client: S3Client | null = null;

  constructor(private readonly config: S3StorageConfig) {}

  validateConfiguration(): void {
    if (!this.config.bucket.trim()) {
      throw new Error(t("error.configureS3Bucket"));
    }
    if (!this.config.accessKeyId.trim() || !this.config.secretAccessKey.trim()) {
      throw new Error(t("error.configureS3Credentials"));
    }
    if (this.config.endpoint?.trim()) {
      parseHttpUrl(this.config.endpoint.trim(), t("error.s3InvalidEndpoint"));
    }
  }

  private getClient(): S3Client {
    if (!this.client) {
      const endpoint = this.config.endpoint?.trim() || undefined;
      const region = this.config.region?.trim() || "us-east-1";
      this.client = new S3Client({
        endpoint,
        region,
        credentials: {
          accessKeyId: this.config.accessKeyId.trim(),
          secretAccessKey: this.config.secretAccessKey.trim(),
        },
        forcePathStyle: Boolean(this.config.forcePathStyle),
      });
    }
    return this.client;
  }

  toObjectKey(relativePath: string): string {
    const prefix = (this.config.remotePrefix ?? "").replace(/^\/+|\/+$/g, "");
    return prefix ? `${prefix}/${relativePath}` : relativePath;
  }

  async upload(
    source: ArrayBuffer | UploadSource,
    mimeTypeOrProgress?: string | TransferProgress,
    onProgress?: TransferProgress,
  ): Promise<UploadedObject> {
    this.validateConfiguration();
    const relativePath = createUuid();
    const key = this.toObjectKey(relativePath);
    const client = this.getClient();

    let totalBytes: number;
    let mimeType: string;
    let progressCallback: TransferProgress | undefined;
    let localPath: string | undefined;
    let dataBuffer: Buffer | undefined;

    if (source instanceof ArrayBuffer) {
      totalBytes = source.byteLength;
      mimeType = typeof mimeTypeOrProgress === "string" ? mimeTypeOrProgress : "application/octet-stream";
      progressCallback = onProgress;
      dataBuffer = Buffer.from(source);
    } else {
      totalBytes = source.size;
      mimeType = source.mimeType;
      progressCallback = typeof mimeTypeOrProgress === "function" ? mimeTypeOrProgress : onProgress;
      localPath = source.localPath;
      if (source.data) {
        dataBuffer = Buffer.from(source.data);
      }
    }

    try {
      if (totalBytes <= MULTIPART_THRESHOLD) {
        let body: Buffer;
        if (dataBuffer) {
          body = dataBuffer;
        } else if (localPath) {
          const fs = require("node:fs/promises");
          body = await fs.readFile(localPath);
        } else {
          throw new Error("No data or localPath available for upload");
        }

        await client.send(
          new PutObjectCommand({
            Bucket: this.config.bucket,
            Key: key,
            Body: body,
            ContentType: mimeType,
          }),
        );
        progressCallback?.(totalBytes, totalBytes);
      } else {
        await this.uploadMultipart(client, key, mimeType, totalBytes, localPath, dataBuffer, progressCallback);
      }

      // Verify uploaded object exists and size matches
      const head = await client.send(
        new HeadObjectCommand({
          Bucket: this.config.bucket,
          Key: key,
        }),
      );

      if (head.ContentLength !== undefined && head.ContentLength !== totalBytes) {
        throw new Error(
          t("error.uploadSize", {
            expected: totalBytes,
            actual: head.ContentLength,
          }),
        );
      }
    } catch (error) {
      await this.delete(relativePath).catch(() => undefined);
      throw this.wrapS3Error(error);
    }

    return {
      relativePath,
      fileUrl: "",
    };
  }

  private async uploadMultipart(
    client: S3Client,
    key: string,
    mimeType: string,
    totalBytes: number,
    localPath?: string,
    dataBuffer?: Buffer,
    onProgress?: TransferProgress,
  ): Promise<void> {
    const createRes = await client.send(
      new CreateMultipartUploadCommand({
        Bucket: this.config.bucket,
        Key: key,
        ContentType: mimeType,
      }),
    );

    const uploadId = createRes.UploadId;
    if (!uploadId) {
      throw new Error("Failed to initialize S3 multipart upload: no UploadId returned");
    }

    const parts: { PartNumber: number; ETag: string }[] = [];
    let fileHandle: any = null;

    try {
      let offset = 0;
      let partNumber = 1;
      let transferred = 0;

      if (localPath) {
        const fs = require("node:fs/promises");
        fileHandle = await fs.open(localPath, "r");
      }

      while (offset < totalBytes) {
        const chunkSize = Math.min(PART_SIZE, totalBytes - offset);
        let chunk: Buffer;

        if (fileHandle) {
          chunk = Buffer.alloc(chunkSize);
          await fileHandle.read(chunk, 0, chunkSize, offset);
        } else if (dataBuffer) {
          chunk = dataBuffer.subarray(offset, offset + chunkSize);
        } else {
          throw new Error("No source data available for multipart upload");
        }

        const uploadPartRes = await client.send(
          new UploadPartCommand({
            Bucket: this.config.bucket,
            Key: key,
            UploadId: uploadId,
            PartNumber: partNumber,
            Body: chunk,
          }),
        );

        if (!uploadPartRes.ETag) {
          throw new Error(`Part ${partNumber} upload failed: no ETag returned`);
        }

        parts.push({
          PartNumber: partNumber,
          ETag: uploadPartRes.ETag,
        });

        offset += chunkSize;
        transferred += chunkSize;
        partNumber += 1;
        onProgress?.(transferred, totalBytes);
      }

      await client.send(
        new CompleteMultipartUploadCommand({
          Bucket: this.config.bucket,
          Key: key,
          UploadId: uploadId,
          MultipartUpload: {
            Parts: parts,
          },
        }),
      );
    } catch (error) {
      await client
        .send(
          new AbortMultipartUploadCommand({
            Bucket: this.config.bucket,
            Key: key,
            UploadId: uploadId,
          }),
        )
        .catch(() => undefined);
      throw error;
    } finally {
      if (fileHandle) {
        await fileHandle.close().catch(() => undefined);
      }
    }
  }

  async download(
    relativePath: string,
    onProgress?: TransferProgress,
    context?: DownloadContext,
  ): Promise<ArrayBuffer | DownloadResult> {
    this.validateConfiguration();
    const key = this.toObjectKey(relativePath);
    const client = this.getClient();

    try {
      const response = await client.send(
        new GetObjectCommand({
          Bucket: this.config.bucket,
          Key: key,
        }),
      );

      const stream = response.Body as any;
      if (!stream) {
        throw new Error(t("error.download", { status: 404 }));
      }

      const totalBytes = response.ContentLength ?? context?.expectedSize ?? null;

      if (context?.localPath) {
        const fs = require("node:fs");
        const crypto = require("node:crypto");
        const tempPath = `${context.localPath}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}.restore.tmp`;
        const writeStream = fs.createWriteStream(tempPath);
        const hash = crypto.createHash("sha256");
        let receivedBytes = 0;

        try {
          if (typeof stream[Symbol.asyncIterator] === "function") {
            for await (const chunk of stream) {
              const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
              receivedBytes += buf.length;
              hash.update(buf);
              writeStream.write(buf);
              onProgress?.(receivedBytes, totalBytes);
            }
          } else {
            throw new Error("S3 GetObject body is not a stream");
          }

          await new Promise<void>((resolve, reject) => {
            writeStream.end((err: Error | null) => (err ? reject(err) : resolve()));
          });

          // Verify downloaded size
          if (context.expectedSize !== undefined && receivedBytes !== context.expectedSize) {
            await fs.promises.unlink(tempPath).catch(() => undefined);
            throw new Error(t("restore.sizeMismatch", { expected: context.expectedSize, actual: receivedBytes }));
          }

          // Verify checksum
          const calculatedSha = hash.digest("hex");
          if (context.expectedSha256 && calculatedSha !== context.expectedSha256) {
            await fs.promises.unlink(tempPath).catch(() => undefined);
            throw new Error(t("restore.integrityFailed"));
          }

          // Rename temp file to destination
          await fs.promises.rename(tempPath, context.localPath);
          return { writtenToLocalPath: true };
        } catch (streamErr) {
          await fs.promises.unlink(tempPath).catch(() => undefined);
          throw streamErr;
        }
      } else {
        // In-memory buffering (fallback for mobile/mock environments)
        const chunks: Buffer[] = [];
        let receivedBytes = 0;
        if (typeof stream[Symbol.asyncIterator] === "function") {
          for await (const chunk of stream) {
            const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
            receivedBytes += buf.length;
            chunks.push(buf);
            onProgress?.(receivedBytes, totalBytes);
          }
        } else {
          throw new Error("S3 GetObject body is not a stream");
        }

        const fullBuffer = Buffer.concat(chunks);
        return fullBuffer.buffer.slice(fullBuffer.byteOffset, fullBuffer.byteOffset + fullBuffer.byteLength);
      }
    } catch (error) {
      throw this.wrapS3Error(error);
    }
  }

  async exists(relativePath: string): Promise<boolean> {
    try {
      const key = this.toObjectKey(relativePath);
      await this.getClient().send(
        new HeadObjectCommand({
          Bucket: this.config.bucket,
          Key: key,
        }),
      );
      return true;
    } catch (err: any) {
      if (err.name === "NotFound" || err.$metadata?.httpStatusCode === 404) {
        return false;
      }
      throw this.wrapS3Error(err);
    }
  }

  async verify(relativePath: string, expectedSize?: number): Promise<boolean> {
    try {
      const key = this.toObjectKey(relativePath);
      const head = await this.getClient().send(
        new HeadObjectCommand({
          Bucket: this.config.bucket,
          Key: key,
        }),
      );
      if (expectedSize !== undefined && head.ContentLength !== undefined) {
        return head.ContentLength === expectedSize;
      }
      return true;
    } catch (err: any) {
      if (err.name === "NotFound" || err.$metadata?.httpStatusCode === 404) {
        return false;
      }
      throw this.wrapS3Error(err);
    }
  }

  async delete(relativePath: string): Promise<void> {
    try {
      const key = this.toObjectKey(relativePath);
      await this.getClient().send(
        new DeleteObjectCommand({
          Bucket: this.config.bucket,
          Key: key,
        }),
      );
    } catch (error) {
      throw this.wrapS3Error(error);
    }
  }

  async getFileUrl(relativePath: string): Promise<string> {
    this.validateConfiguration();
    try {
      const key = this.toObjectKey(relativePath);
      const command = new GetObjectCommand({
        Bucket: this.config.bucket,
        Key: key,
      });
      const expiresIn = this.config.presignedExpiration && this.config.presignedExpiration > 0
        ? this.config.presignedExpiration
        : 3600;

      return await getSignedUrl(this.getClient(), command, { expiresIn });
    } catch (error) {
      throw this.wrapS3Error(error);
    }
  }

  private wrapS3Error(error: unknown): Error {
    if (error instanceof Error) {
      const err = error as any;
      const name = err.name || "";
      const code = err.code || err.$metadata?.httpStatusCode;
      const message = err.message || "";

      if (name === "NoSuchBucket" || (code === 404 && message.toLowerCase().includes("bucket"))) {
        return new Error(t("error.s3BucketNotFound"));
      }
      if (name === "NoSuchKey" || name === "NotFound" || code === 404) {
        return new Error(t("error.s3NotFound"));
      }
      if (
        name === "AccessDenied" ||
        name === "InvalidAccessKeyId" ||
        name === "SignatureDoesNotMatch" ||
        code === 403
      ) {
        return new Error(t("error.s3AccessDenied"));
      }
      if (
        name === "TimeoutError" ||
        name === "EndpointConnectionError" ||
        err.code === "ENOTFOUND" ||
        err.code === "ECONNREFUSED"
      ) {
        return new Error(`${t("error.network")}: ${message}`);
      }
      return error;
    }
    return new Error(String(error));
  }
}
