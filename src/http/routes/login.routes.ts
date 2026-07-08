import type { RouteHandler } from '../shared/http';
import { methodIs, readJsonBody, sendError, sendJson, stringBodyField } from '../shared/http';
import { generateTokenPair, verifyRefreshToken, type TokenPair } from '../../auth/jwt';
import type { AppRouteContext } from '../router';

const LOGIN_PATH = '/ratel/account-personal-service/api/v1/sso/getTokenByApp';
const REFRESH_PATH = '/ratel/account-personal-service/api/v1/sso/refreshToken';

function sendTokenPair(res: Parameters<RouteHandler<AppRouteContext>>[1], pair: TokenPair): void {
  sendJson(res, 200, {
    code: 200,
    message: 'Success',
    data: {
      access_token: pair.accessToken,
      refresh_token: pair.refreshToken,
      expire_time: pair.expireTime,
    },
  });
}

export const handleLoginRoutes: RouteHandler<AppRouteContext> = async (req, res, url, ctx) => {
  if (url.pathname === LOGIN_PATH && methodIs(req, 'POST')) {
    const body = await readJsonBody(req);
    // Mock: credentials arrive RSA-encrypted from real clients and are never decrypted here;
    // any non-empty account/password is accepted.
    if (!stringBodyField(body, 'account') || !stringBodyField(body, 'password')) {
      sendError(res, 400, 'account and password are required');
      return true;
    }
    sendTokenPair(res, generateTokenPair());
    return true;
  }

  if (url.pathname === REFRESH_PATH && methodIs(req, 'POST')) {
    const body = await readJsonBody(req);
    const authHeader = req.headers.authorization;
    const bearer = typeof authHeader === 'string' && authHeader.startsWith('Bearer ')
      ? authHeader.slice(7)
      : null;
    const refreshToken = stringBodyField(body, 'refresh_token') ?? bearer;
    if (!refreshToken) {
      sendError(res, 400, 'refresh_token is required');
      return true;
    }
    const auth = verifyRefreshToken(refreshToken);
    if (!auth.valid) {
      sendError(res, 401, auth.error ?? 'Invalid refresh token');
      return true;
    }
    const userId = typeof auth.payload === 'object' && auth.payload !== null && typeof auth.payload.userId === 'string'
      ? auth.payload.userId
      : undefined;
    sendTokenPair(res, generateTokenPair(userId));
    return true;
  }

  void ctx;
  return false;
};
