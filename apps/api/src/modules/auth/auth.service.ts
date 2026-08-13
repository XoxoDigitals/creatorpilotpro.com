import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import bcrypt from 'bcryptjs';
import { PrismaService } from '../../prisma/prisma.service';
import type { SessionUser } from '../../common/session/session.types';

const BCRYPT_COST = 12;

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

  /** Change the signed-in user's password after verifying the current one. */
  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<void> {
    const user = await this.prisma.client.user.findFirst({
      where: { id: userId, deletedAt: null },
    });
    if (!user || user.status === 'SUSPENDED') {
      throw new UnauthorizedException('Not authenticated');
    }

    const ok = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!ok) throw new BadRequestException('Current password is incorrect');
    if (currentPassword === newPassword) {
      throw new BadRequestException('New password must differ from the current password');
    }

    const passwordHash = await bcrypt.hash(newPassword, BCRYPT_COST);
    await this.prisma.client.user.update({
      where: { id: userId },
      data: { passwordHash },
    });
  }
}
