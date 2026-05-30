import type { RouteHandler } from '../shared/http';
import { methodIs, readJsonBody, sendError, sendJson, sendOk } from '../shared/http';
import { renderPanelHtml } from '../sim/panel';
import type { RobotDomain } from '../sim/virtualRobot';
import type { AppRouteContext } from './router';

function simDisabled(): boolean {
  return process.env.SIM_PANEL === '0';
}

function readDomain(value: unknown, fallback: RobotDomain): RobotDomain {
  return value === 'mapping' || value === 'mowing' || value === 'mapEdit' ? value : fallback;
}

function normalizeEvent(body: Record<string, unknown>): Record<string, unknown> | null {
  const type = typeof body.type === 'string' ? body.type : '';
  if (!type) return null;
  const event: Record<string, unknown> = { ...body, type };
  if (type === 'CMD_START' && event.mode == null) event.mode = 'auto';
  if (type.startsWith('DEVICE_')) {
    if (event.source == null) event.source = 'ws';
    if (event.ts == null) event.ts = Date.now();
  }
  if (type === 'DEVICE_CAPABILITIES') {
    const capabilities = typeof body.capabilities === 'object' && body.capabilities !== null
      ? body.capabilities as Record<string, unknown>
      : {};
    event.canSwitchManual = body.canSwitchManual ?? body.can_switch_manual ?? capabilities.canSwitchManual ?? capabilities.can_switch_manual ?? false;
    event.canSwitchAuto = body.canSwitchAuto ?? body.can_switch_auto ?? capabilities.canSwitchAuto ?? capabilities.can_switch_auto ?? false;
  }
  return event;
}

export const handleSimRoutes: RouteHandler<AppRouteContext> = async (req, res, url, ctx) => {
  if (!url.pathname.startsWith('/sim/')) return false;
  if (simDisabled()) {
    sendError(res, 404, 'sim namespace disabled');
    return true;
  }

  if (url.pathname === '/sim/state' && methodIs(req, 'GET')) {
    sendJson(res, 200, {
      code: 200,
      message: 'Success',
      data: {
        ...ctx.robot.snapshot(),
        chaos: ctx.chaos.snapshot(),
        scenario: ctx.scenarioEngine.snapshot(),
        recorder: ctx.recorder.snapshot(),
      },
    });
    return true;
  }

  if (url.pathname === '/sim/panel' && methodIs(req, 'GET')) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(renderPanelHtml());
    return true;
  }

  if (url.pathname === '/sim/scenarios' && methodIs(req, 'GET')) {
    sendOk(res, ctx.scenarioEngine.snapshot());
    return true;
  }

  if (url.pathname === '/sim/scenario/run' && methodIs(req, 'POST')) {
    const body = await readJsonBody(req);
    const result = await ctx.scenarioEngine.run({
      name: typeof body.name === 'string' ? body.name : undefined,
      inline: typeof body.inline === 'string' || typeof body.inline === 'object' ? body.inline as never : undefined,
    });
    sendOk(res, result);
    return true;
  }

  if (url.pathname === '/sim/scenario/stop' && methodIs(req, 'POST')) {
    ctx.scenarioEngine.stop();
    sendOk(res, ctx.scenarioEngine.snapshot());
    return true;
  }

  if (url.pathname === '/sim/event' && methodIs(req, 'POST')) {
    const body = await readJsonBody(req);
    const event = normalizeEvent(body);
    if (!event) {
      sendError(res, 400, 'type is required');
      return true;
    }
    const domain = readDomain(body.domain, ctx.robot.activeDomain ?? 'mapping');
    ctx.robot.dispatchRaw(event as never, domain);
    sendOk(res, ctx.robot.snapshot());
    return true;
  }

  if (url.pathname === '/sim/reset' && methodIs(req, 'POST')) {
    ctx.robot.reset();
    sendOk(res, ctx.robot.snapshot());
    return true;
  }

  if (url.pathname === '/sim/chaos' && methodIs(req, 'POST')) {
    const body = await readJsonBody(req);
    sendOk(res, ctx.chaos.update({
      latencyMs: typeof body.latencyMs === 'number' ? body.latencyMs : undefined,
      dropRate: typeof body.dropRate === 'number' ? body.dropRate : undefined,
      reorderWindowMs: typeof body.reorderWindowMs === 'number' ? body.reorderWindowMs : undefined,
    }));
    return true;
  }

  if (url.pathname === '/sim/recorder/start' && methodIs(req, 'POST')) {
    const body = await readJsonBody(req);
    const label = typeof body.label === 'string' ? body.label : undefined;
    sendOk(res, ctx.recorder.start(label));
    return true;
  }

  if (url.pathname === '/sim/recorder/stop' && methodIs(req, 'POST')) {
    sendOk(res, ctx.recorder.stop());
    return true;
  }

  if (url.pathname === '/sim/recorder/replay' && methodIs(req, 'POST')) {
    const body = await readJsonBody(req);
    const inline = Array.isArray(body.inline) ? body.inline as never : undefined;
    const result = await ctx.recorder.replay(ctx.robot, {
      file: typeof body.file === 'string' ? body.file : undefined,
      inline,
      preserveTiming: body.preserveTiming === true,
      speed: typeof body.speed === 'number' ? body.speed : undefined,
    });
    sendOk(res, result);
    return true;
  }

  if (url.pathname === '/sim/recorder/list' && methodIs(req, 'GET')) {
    sendOk(res, ctx.recorder.snapshot());
    return true;
  }

  if (url.pathname === '/sim/ble/register' && methodIs(req, 'POST')) {
    sendOk(res, { registered: true });
    return true;
  }

  if (url.pathname === '/sim/ble/notify' && methodIs(req, 'POST')) {
    const body = await readJsonBody(req);
    sendOk(res, { accepted: true, echo: body });
    return true;
  }

  return false;
};
