import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  googleAuthSchema,
  loginSchema,
  registerSchema,
  type AuthConfig,
  type GoogleAuthInput,
  type LoginInput,
  type RegisterInput,
  type UserRecord,
} from '@travelclaw/shared';
import type { Request, Response } from 'express';
import { ZodValidationPipe } from '../common/zod-pipe';
import { loadConfig } from '../config';
import { AuthService } from './auth.service';
import { clearSessionCookie, setSessionCookie } from './cookies';
import { AuthGuard } from './auth.guard';
import { CurrentUser } from './current-user.decorator';
import { parseCookies } from './tokens';

@ApiTags('auth')
@Controller('api/auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Get('config')
  @ApiOperation({ summary: 'Whether Google sign-in is enabled' })
  config(): AuthConfig {
    return { googleClientId: loadConfig().googleClientId };
  }

  @Post('register')
  @ApiOperation({ summary: 'Create an account with an email and password' })
  async register(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Body(new ZodValidationPipe(registerSchema)) body: RegisterInput,
  ): Promise<UserRecord> {
    if (!this.auth.registerLimiter.consume(clientKey(req))) {
      throw rateLimited();
    }
    const result = await this.auth.register(body.email, body.password, body.displayName);
    setSessionCookie(res, result.token, result.expiresAt);
    return result.user;
  }

  @Post('login')
  @HttpCode(200)
  @ApiOperation({ summary: 'Sign in with an email and password' })
  async login(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Body(new ZodValidationPipe(loginSchema)) body: LoginInput,
  ): Promise<UserRecord> {
    if (!this.auth.loginLimiter.consume(`${clientKey(req)}:${body.email}`)) {
      throw rateLimited();
    }
    const result = await this.auth.login(body.email, body.password);
    setSessionCookie(res, result.token, result.expiresAt);
    return result.user;
  }

  @Post('google')
  @HttpCode(200)
  @ApiOperation({ summary: 'Sign in (or register) with a Google credential' })
  async google(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Body(new ZodValidationPipe(googleAuthSchema)) body: GoogleAuthInput,
  ): Promise<UserRecord> {
    if (!this.auth.loginLimiter.consume(clientKey(req))) {
      throw rateLimited();
    }
    const result = await this.auth.loginWithGoogle(body.credential);
    setSessionCookie(res, result.token, result.expiresAt);
    return result.user;
  }

  @Post('logout')
  @HttpCode(200)
  @ApiOperation({ summary: 'End the current session' })
  logout(@Req() req: Request, @Res({ passthrough: true }) res: Response): { ok: true } {
    const token = parseCookies(req.headers.cookie)[loadConfig().cookieName];
    if (token) this.auth.logout(token);
    clearSessionCookie(res);
    return { ok: true };
  }

  @Get('me')
  @UseGuards(AuthGuard)
  @ApiOperation({ summary: 'The signed-in account' })
  me(@CurrentUser() user: UserRecord): UserRecord {
    return user;
  }
}

function clientKey(req: Request): string {
  return req.ip || req.socket.remoteAddress || 'unknown';
}

function rateLimited(): HttpException {
  return new HttpException(
    { code: 'rate_limited', message: 'Too many attempts. Wait a bit and try again.' },
    HttpStatus.TOO_MANY_REQUESTS,
  );
}
