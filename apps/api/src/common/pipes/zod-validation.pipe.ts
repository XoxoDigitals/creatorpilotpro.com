import { BadRequestException, PipeTransform } from '@nestjs/common';
import type { ZodSchema } from 'zod';

/**
 * Validates/parses a request payload against a Zod schema (project uses Zod,
 * not class-validator). Use as `@Body(new ZodBody(schema))`.
 */
export class ZodBody<T> implements PipeTransform {
  constructor(private readonly schema: ZodSchema<T>) {}

  transform(value: unknown): T {
    // Fastify leaves body undefined/null when the client sends no payload
    // (common for trigger-style POSTs with no JSON). Treat as {} so optional
    // object schemas succeed and required-field schemas still report field errors.
    const normalized = value === undefined || value === null ? {} : value;
    const result = this.schema.safeParse(normalized);
    if (!result.success) {
      throw new BadRequestException({
        message: 'Validation failed',
        issues: result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      });
    }
    return result.data;
  }
}
