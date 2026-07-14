import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { UsersService, type UserView } from './users.service';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Audit } from '../../common/decorators/audit.decorator';
import { ZodBody } from '../../common/pipes/zod-validation.pipe';
import type { SessionUser } from '../../common/session/session.types';
import {
  changeRoleSchema,
  createUserSchema,
  resetPasswordSchema,
  type ChangeRoleDto,
  type CreateUserDto,
  type ResetPasswordDto,
} from './dto/user.dto';

@ApiTags('users')
@Roles('OWNER', 'ADMIN') // docs/08 §1: user management is Owner/Admin only
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  list(): Promise<UserView[]> {
    return this.users.list();
  }

  @Post()
  @Audit('user.create', 'User')
  create(
    @CurrentUser() actor: SessionUser,
    @Body(new ZodBody(createUserSchema)) body: CreateUserDto,
  ): Promise<UserView> {
    return this.users.create(actor, body);
  }

  @Patch(':id/disable')
  @Audit('user.disable', 'User')
  disable(@CurrentUser() actor: SessionUser, @Param('id') id: string): Promise<UserView> {
    return this.users.setEnabled(actor, id, false);
  }

  @Patch(':id/enable')
  @Audit('user.enable', 'User')
  enable(@CurrentUser() actor: SessionUser, @Param('id') id: string): Promise<UserView> {
    return this.users.setEnabled(actor, id, true);
  }

  @Post(':id/reset-password')
  @Audit('user.reset_password', 'User')
  resetPassword(
    @CurrentUser() actor: SessionUser,
    @Param('id') id: string,
    @Body(new ZodBody(resetPasswordSchema)) body: ResetPasswordDto,
  ): Promise<UserView> {
    return this.users.resetPassword(actor, id, body.newPassword);
  }

  @Patch(':id/role')
  @Audit('user.change_role', 'User')
  changeRole(
    @CurrentUser() actor: SessionUser,
    @Param('id') id: string,
    @Body(new ZodBody(changeRoleSchema)) body: ChangeRoleDto,
  ): Promise<UserView> {
    return this.users.changeRole(actor, id, body.role);
  }
}
