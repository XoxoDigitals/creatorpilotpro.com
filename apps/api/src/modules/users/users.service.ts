import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import bcrypt from 'bcryptjs';
import type { Role, User } from '@scp/db';
import { hasGlobalAccountAccess } from '@scp/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { SessionService } from '../auth/session.service';
import { AccountAccessService } from '../../common/account-access/account-access.service';
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
  /** Granted SocialAccount ids. OWNER/ADMIN ignore these (see all accounts). */
  accountIds: string[];
  /** True when role bypasses grants and sees every account. */
  allAccountsAccess: boolean;
}

function toView(u: User, accountIds: string[] = []): UserView {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    role: u.role,
    status: u.status,
    lastLoginAt: u.lastLoginAt,
    createdAt: u.createdAt,
    accountIds,
    allAccountsAccess: hasGlobalAccountAccess(u.role),
  };
}

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: SessionService,
    private readonly accountAccess: AccountAccessService,
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
      include: { accountAccess: { select: { accountId: true } } },
      orderBy: { createdAt: 'asc' },
    });
    return users.map((u) =>
      toView(
        u,
        u.accountAccess.map((g) => g.accountId),
      ),
    );
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

    let accountIds: string[] = [];
    if (dto.accountIds && dto.accountIds.length > 0) {
      accountIds = await this.accountAccess.replaceGrants(user.id, dto.accountIds);
    }
    return toView(user, accountIds);
  }

  private async loadManageable(actor: SessionUser, id: string): Promise<User> {
    const user = await this.prisma.client.user.findFirst({ where: { id, deletedAt: null } });
    if (!user) throw new NotFoundException('User not found');
    this.assertCanManageRole(actor, user.role);
    return user;
  }

  private async viewWithGrants(user: User): Promise<UserView> {
    const accountIds = await this.accountAccess.listAccountIdsForUser(user.id);
    return toView(user, accountIds);
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
    return this.viewWithGrants(user);
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
    return this.viewWithGrants(user);
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
    return this.viewWithGrants(user);
  }

  async listAccounts(actor: SessionUser, id: string): Promise<{ accountIds: string[]; allAccountsAccess: boolean }> {
    const target = await this.loadManageable(actor, id);
    const accountIds = await this.accountAccess.listAccountIdsForUser(target.id);
    return {
      accountIds,
      allAccountsAccess: hasGlobalAccountAccess(target.role),
    };
  }

  async setAccounts(actor: SessionUser, id: string, accountIds: string[]): Promise<UserView> {
    const target = await this.loadManageable(actor, id);
    const saved = await this.accountAccess.replaceGrants(target.id, accountIds);
    return toView(target, saved);
  }
}
