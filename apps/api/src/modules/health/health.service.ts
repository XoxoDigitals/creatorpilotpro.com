import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface HealthStatus {
  status: 'ok';
  version: string;
}

@Injectable()
export class HealthService {
  constructor(private readonly config: ConfigService) {}

  check(): HealthStatus {
    return {
      status: 'ok',
      version: this.config.get<string>('version') ?? '0.0.0',
    };
  }
}
