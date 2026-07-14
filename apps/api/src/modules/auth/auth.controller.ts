import { Body, Controller, Get, HttpCode, Post, Req, Res, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';
import { AuthService } from './auth.service';
import { SessionService } from './session.service';
import { LoginRateLimitGuard } from './login-rate-limit.guard';
import { loginSchema, type LoginDto } from './dto/login.dto';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ZodBody } from '../../common/pipes/zod-validation.pipe';
import {
  SESSION_COOKIE,
  type AuthedRequest,
  type SessionUser,
} from '../../common/session/session.types';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly sessions: SessionService,
    private readonly config: ConfigService,
  ) {}

  @Public()
  @UseGuards(LoginRateLimitGuard)
  @Post('login')
  @HttpCode(200)
  @ApiOkResponse({ description: 'Authenticate; sets an HttpOnly session cookie.' })
  async login(
    @Body(new ZodBody(loginSchema)) body: LoginDto,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<{ user: SessionUser }> {
    const user = await this.auth.validateCredentials(body.email, body.password);
    const { token, expires } = await this.sessions.create(user.id);

    reply.setCookie(SESSION_COOKIE, token, {
      httpOnly: true,
      secure: this.config.get<boolean>('isProduction') ?? false,
      sameSite: 'lax',
      signed: true,
      path: '/',
      expires,
    });

    return { user };
  }

  @Post('logout')
  @HttpCode(200)
  @ApiOkResponse({ description: 'Destroy the current session and clear the cookie.' })
  async logout(
    @Req() req: AuthedRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<{ ok: true }> {
    const raw = req.cookies?.[SESSION_COOKIE];
    if (raw) {
      const unsigned = req.unsignCookie(raw);
      if (unsigned.valid && unsigned.value) await this.sessions.destroy(unsigned.value);
    }
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  }

  @Get('me')
  @ApiOkResponse({ description: 'The currently authenticated user.' })
  me(@CurrentUser() user: SessionUser): { user: SessionUser } {
    return { user };
  }
}
