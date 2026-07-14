import { Injectable, UnauthorizedException } from '@nestjs/common';
import bcrypt from 'bcryptjs';
import { PrismaService } from '../../prisma/prisma.service';
import type { SessionUser } from '../../common/session/session.types';

@Injectable()
export class AuthService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Verify email + password against a seeded/active user (bcrypt).
   * Throws 401 with a generic message (no user-enumeration leak).
   */
  async validateCredentials(email: string, password: string): Promise<SessionUser> {
    const user = await this.prisma.client.user.findFirst({
      where: { email: email.toLowerCase().trim(), deletedAt: null },
    });

    const invalid = new UnauthorizedException('Invalid email or password');
    if (!user || user.status === 'SUSPENDED') {
      // Still run a compare to reduce timing side-channel on missing users.
      await bcrypt.compare(password, '$2a$12$0000000000000000000000000000000000000000000000000000');
      throw invalid;
    }

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) throw invalid;

    await this.prisma.client.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    return { id: user.id, email: user.email, name: user.name, role: user.role };
  }
}
