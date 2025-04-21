import { Injectable } from '@nestjs/common';
import { S3 } from '@aws-sdk/client-s3';
import { Readable } from 'stream';
import { ConfigService } from '@nestjs/config';
import { Upload } from '@aws-sdk/lib-storage';

@Injectable()
export class StorageService {
  private s3: S3;
  private endpoint: string;
  private accessKeyId: string;
  private secretAccessKey: string;
  private bucketName: string;

  constructor(private configService: ConfigService) {
    this.endpoint = this.configService.get('MINIO_ENDPOINT')!;
    this.accessKeyId = this.configService.get('MINIO_ACCESS_KEY')!;
    this.secretAccessKey = this.configService.get('MINIO_SECRET_KEY')!;
    this.bucketName = this.configService.get('MINIO_BUCKET')!;
    this.s3 = new S3({
      region: 'ru-1',
      endpoint: this.endpoint,
      forcePathStyle: true,
      credentials: {
        accessKeyId: this.accessKeyId,
        secretAccessKey: this.secretAccessKey,
      },
    });
  }

  async uploadFile(file: Express.Multer.File): Promise<string> {
    const fileStream = Readable.from(file.buffer);
    const fileName = `${Date.now()}-${file.originalname}`;

    const upload = new Upload({
      client: this.s3,
      params: {
        Bucket: this.bucketName,
        Key: fileName,
        Body: fileStream,
        ContentType: file.mimetype,
      },
    });

    await upload.done();
    const fileUrl = `${this.endpoint}/${this.bucketName}/${fileName}`;
    console.log(fileUrl);
    return fileUrl;
  }

  async getFile(key: string): Promise<Readable> {
    const params = {
      Bucket: this.bucketName,
      Key: key,
    };

    const { Body } = await this.s3.getObject(params);
    return Body as Readable;
  }
}
