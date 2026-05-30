import type { RouteHandler } from '../shared/http';
import { methodIs, sendJson } from '../shared/http';
import { generateTicket, verifyJwt } from '../auth/jwt';
import type { AppRouteContext } from './router';

export const handleAccRoutes: RouteHandler<AppRouteContext> = (req, res, url, ctx) => {
  if (url.pathname !== '/ratel/api/v1/wss/acc_ticket' || !methodIs(req, 'POST')) return false;

  const platform = req.headers.platform;
  if (!platform) {
    sendJson(res, 400, {
      code: 400,
      message: 'platform is required',
      ticket: '',
      expire_seconds: 0,
      wss_path_hint: '',
    });
    return true;
  }

  const auth = verifyJwt(req.headers.authorization);
  if (!auth.valid) {
    sendJson(res, 401, {
      code: 401,
      message: auth.error,
      ticket: '',
      expire_seconds: 0,
      wss_path_hint: '',
    });
    return true;
  }

  const { ticket, expire_seconds } = generateTicket(auth.payload);
  const host = req.headers.host || `localhost:${ctx.port}`;
  sendJson(res, 200, {
    code: 200,
    message: 'Success',
    ticket,
    expire_seconds,
    wss_path_hint: `ws://${host}/acc?ticket=${ticket}`,
  });
  return true;
};
