import { Injectable } from '@nestjs/common';
import { S3ModuleOptions, S3ModuleOptionsFactory } from 'nestjs-s3';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class S3Config implements S3ModuleOptionsFactory {
  constructor(private readonly configService: ConfigService) {}

  createS3ModuleOptions(): S3ModuleOptions {
    return {
      config: {
        credentials: {
          accessKeyId: this.configService.get<string>('MINIO_ACCESS_KEY')!,
          secretAccessKey: this.configService.get<string>('MINIO_SECRET_KEY')!,
        },
        endpoint: this.configService.get<string>('MINIO_URL'),
        forcePathStyle: true,
        region: 'ru-1',
      },
    };
  }
}
