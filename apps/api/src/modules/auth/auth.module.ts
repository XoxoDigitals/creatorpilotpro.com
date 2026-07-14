import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { SessionService } from './session.service';
import { LoginRateLimitGuard } from './login-rate-limit.guard';

/**
 * Auth module (docs/02 §3, docs/08 §1): NestJS-native session auth
 * (bcrypt + DB sessions + signed HttpOnly cookie). SessionService is exported
 * so the global SessionAuthGuard (registered in AppModule) can resolve sessions.
 */
@Module({
  controllers: [AuthController],
  providers: [AuthService, SessionService, LoginRateLimitGuard],
  exports: [SessionService],
})
export class AuthModule {}
