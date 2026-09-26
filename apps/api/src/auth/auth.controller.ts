import { Body, Controller, Get, HttpCode, Post, Req, Res, UseGuards } from '@nestjs/common';
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
import { clientKey, rateLimited } from '../common/rate-limit';
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

  /**
   * A visitor who ran into the guest-minting cap has not done anything wrong and does
   * not need an account. Say what the limit is and that signing in is optional, so this
   * never reads as a sign-in wall.
   */
  private static readonly GUEST_PACE =
    'Too many new guest sessions have started from this address. This is a short cooldown, not a sign-in wall — try again in a few minutes, or sign in if you already have an account.';

  @Get('config')
  @ApiOperation({ summary: 'Whether Google sign-in is enabled' })
  config(): AuthConfig {
    return { googleClientId: loadConfig().googleClientId };
  }

  @Post('guest')
  @HttpCode(200)
  @ApiOperation({ summary: 'Start (or resume) a no-signup guest session' })
  async guest(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<UserRecord> {
    const existing = this.auth.verifyToken(currentToken(req));
    // Already signed in — guest or real, does not matter — so this is idempotent and
    // never mints a second identity for a visitor who merely reloaded the page.
    if (existing) return existing;
    if (!this.auth.guestLimiter.consume(clientKey(req))) {
      throw rateLimited(AuthController.GUEST_PACE);
    }
    const result = await this.auth.createGuest();
    setSessionCookie(res, result.token, result.expiresAt);
    return result.user;
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
    const result = await this.auth.register(
      body.email,
      body.password,
      body.displayName,
      currentGuestId(req, this.auth),
    );
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
    const result = await this.auth.login(
      body.email,
      body.password,
      currentGuestId(req, this.auth),
    );
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
    const result = await this.auth.loginWithGoogle(
      body.credential,
      currentGuestId(req, this.auth),
    );
    setSessionCookie(res, result.token, result.expiresAt);
    return result.user;
  }

  @Post('logout')
  @HttpCode(200)
  @ApiOperation({ summary: 'End the current session' })
  logout(@Req() req: Request, @Res({ passthrough: true }) res: Response): { ok: true } {
    const token = currentToken(req);
    if (token) this.auth.logout(token);
    clearSessionCookie(res);
    return { ok: true };
  }

  @Get('me')
  @UseGuards(AuthGuard)
  @ApiOperation({ summary: 'The signed-in account (guest or real)' })
  me(@CurrentUser() user: UserRecord): UserRecord {
    return user;
  }
}

function currentToken(req: Request): string | undefined {
  return parseCookies(req.headers.cookie)[loadConfig().cookieName];
}

/** The caller's guest id, if their current cookie belongs to a guest — else undefined. */
function currentGuestId(req: Request, auth: AuthService): string | undefined {
  const user = auth.verifyToken(currentToken(req));
  return user?.isGuest ? user.id : undefined;
}
