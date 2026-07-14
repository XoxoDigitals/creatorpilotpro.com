import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import bcrypt from 'bcryptjs';
import type { Role, User } from '@scp/db';
import { PrismaService } from '../../prisma/prisma.service';
import { SessionService } from '../auth/session.service';
import type { SessionUser } from '../../common/session/session.types';
import type { CreateUserDto } from './dto/user.dto';

const BCRYPT_COST = 12;

/** Public (non-secret) shape of a user returned by the API. */
export interface UserView {
  id: string;
  email: string;
  name: string | null;
  role: Role;
  status: User['status'];
  lastLoginAt: Date | null;
  createdAt: Date;
}

function toView(u: User): UserView {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    role: u.role,
    status: u.status,
    lastLoginAt: u.lastLoginAt,
    createdAt: u.createdAt,
  };
}

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: SessionService,
  ) {}

  /**
   * docs/08 §1 matrix note: Admins manage users but NOT Owner accounts, and
   * cannot mint/promote Owners. Owner can do everything.
   */
  private assertCanManageRole(actor: SessionUser, targetRole: Role): void {
    if (actor.role === 'ADMIN' && targetRole === 'OWNER') {
      throw new ForbiddenException('Admins cannot manage Owner accounts');
    }
  }

  async list(): Promise<UserView[]> {
    const users = await this.prisma.client.user.findMany({
      where: { deletedAt: null },
      orderBy: { createdAt: 'asc' },
    });
    return users.map(toView);
  }

  async create(actor: SessionUser, dto: CreateUserDto): Promise<UserView> {
    this.assertCanManageRole(actor, dto.role);

    const email = dto.email.toLowerCase().trim();
    const existing = await this.prisma.client.user.findUnique({ where: { email } });
    if (existing) throw new ConflictException('A user with that email already exists');

    const passwordHash = await bcrypt.hash(dto.tempPassword, BCRYPT_COST);
    const user = await this.prisma.client.user.create({
      data: { email, name: dto.name ?? null, role: dto.role, passwordHash, status: 'ACTIVE' },
    });
    return toView(user);
  }

  private async loadManageable(actor: SessionUser, id: string): Promise<User> {
    const user = await this.prisma.client.user.findFirst({ where: { id, deletedAt: null } });
    if (!user) throw new NotFoundException('User not found');
    this.assertCanManageRole(actor, user.role);
    return user;
  }

  async setEnabled(actor: SessionUser, id: string, enabled: boolean): Promise<UserView> {
    if (actor.id === id && !enabled) {
      throw new BadRequestException('You cannot disable your own account');
    }
    const target = await this.loadManageable(actor, id);

    if (!enabled && target.role === 'OWNER') {
      const owners = await this.prisma.client.user.count({
        where: { role: 'OWNER', status: 'ACTIVE', deletedAt: null },
      });
      if (owners <= 1) throw new BadRequestException('Cannot disable the last active Owner');
    }

    const user = await this.prisma.client.user.update({
      where: { id },
      data: { status: enabled ? 'ACTIVE' : 'SUSPENDED' },
    });
    if (!enabled) await this.sessions.destroyAllForUser(id);
    return toView(user);
  }

  async resetPassword(actor: SessionUser, id: string, newPassword: string): Promise<UserView> {
    const target = await this.loadManageable(actor, id);
    const passwordHash = await bcrypt.hash(newPassword, BCRYPT_COST);
    const user = await this.prisma.client.user.update({
      where: { id: target.id },
      data: { passwordHash },
    });
    // Force re-login everywhere after a password reset.
    await this.sessions.destroyAllForUser(id);
    return toView(user);
  }

  async changeRole(actor: SessionUser, id: string, role: Role): Promise<UserView> {
    const target = await this.loadManageable(actor, id); // guards current role
    this.assertCanManageRole(actor, role); // guards target role (no promote-to-Owner by Admin)

    if (target.role === 'OWNER' && role !== 'OWNER') {
      const owners = await this.prisma.client.user.count({
        where: { role: 'OWNER', status: 'ACTIVE', deletedAt: null },
      });
      if (owners <= 1) throw new BadRequestException('Cannot demote the last Owner');
    }

    const user = await this.prisma.client.user.update({ where: { id }, data: { role } });
    return toView(user);
  }
}
