import type { RouteHandler } from '../shared/http';
import { methodIs, readJsonBody, sendError, sendJson, sendOk } from '../shared/http';
import { loadAllPatches } from '../../assets/PatchLoader';
import { applyFault, listFaults } from '../../sim/faults';
import { renderPanelHtml } from '../../sim/panel';
import { parseRobotDomain, type RobotDomain } from '../../sim/virtualRobot';
import type { AppRouteContext } from '../router';

function simDisabled(): boolean {
  return process.env.SIM_PANEL === '0';
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
        realism: ctx.chaos.realismSnapshot(),
        scenario: ctx.scenarioEngine.snapshot(),
        recorder: ctx.recorder.snapshot(),
        dataset: {
          name: ctx.mapStream.dataset,
          patchCount: ctx.mapStream.patchCount,
        },
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

  if (url.pathname === '/sim/scenario/guide' && methodIs(req, 'GET')) {
    const name = url.searchParams.get('name')?.trim();
    if (!name) {
      sendError(res, 400, 'query name is required');
      return true;
    }
    const guide = ctx.scenarioEngine.getScenarioGuide(name);
    if (!guide) {
      sendError(res, 404, `scenario guide not found: ${name}`);
      return true;
    }
    sendOk(res, guide);
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

  if (url.pathname === '/sim/scenario/pause' && methodIs(req, 'POST')) {
    ctx.scenarioEngine.pause();
    sendOk(res, ctx.scenarioEngine.snapshot());
    return true;
  }

  if (url.pathname === '/sim/scenario/resume' && methodIs(req, 'POST')) {
    ctx.scenarioEngine.resume();
    sendOk(res, ctx.scenarioEngine.snapshot());
    return true;
  }

  if (url.pathname === '/sim/scenario/stop' && methodIs(req, 'POST')) {
    const wasRunning = ctx.scenarioEngine.snapshot().running != null;
    ctx.scenarioEngine.stop();
    // 中止场景仅停止脚本循环；WS 推流（mapTimer/locationTimer）由机器人 FSM 状态驱动，
    // 若不复位机器人，停止后仍会持续广播 MAP_INCREMENTAL / ROBOT_LOCATION。
    // 复位后 activeTask 置空、shouldStreamMap 为 false，两个推流定时器立即停止。
    if (wasRunning) ctx.robot.reset();
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
    const domain = parseRobotDomain(body.domain, ctx.robot.activeDomain ?? 'mapping');
    ctx.robot.dispatchRaw(event as never, domain);
    sendOk(res, ctx.robot.snapshot());
    return true;
  }

  // mapping_snapshot_recovery_design.md §19.5 item 2: inject the track/query fault scenario.
  if (url.pathname === '/sim/track-query' && methodIs(req, 'POST')) {
    const body = await readJsonBody(req);
    sendOk(res, ctx.robot.setTrackQueryScenario({
      mode: typeof body.mode === 'string' ? body.mode as never : undefined,
      delayMs: typeof body.delayMs === 'number' ? body.delayMs : undefined,
      errorStatus: typeof body.errorStatus === 'number' ? body.errorStatus : undefined,
      pointCount: body.pointCount === null || typeof body.pointCount === 'number' ? body.pointCount as never : undefined,
    }));
    return true;
  }

  // §19.5 item 3: force the active mapping task terminal (COMPLETE/CANCEL/FAILED),
  // optionally backdating update_time via `ageMs` to cross the 120s countdown boundary.
  if (url.pathname === '/sim/mapping-task/status' && methodIs(req, 'POST')) {
    const body = await readJsonBody(req);
    const status = typeof body.status === 'string' ? body.status.trim().toUpperCase() : '';
    const allowed = ['ON_THE_WAY', 'PAUSE', 'COMPLETE', 'CANCEL', 'FAILED'];
    if (!allowed.includes(status)) {
      sendError(res, 400, `status must be one of ${allowed.join('|')}`);
      return true;
    }
    sendOk(res, ctx.robot.forceMappingTaskStatus(status as never, {
      ageMs: typeof body.ageMs === 'number' ? body.ageMs : undefined,
      mapId: typeof body.mapId === 'string' ? body.mapId : undefined,
      mode: typeof body.mode === 'string' ? body.mode : undefined,
      message: typeof body.message === 'string' ? body.message : undefined,
      errorCode: typeof body.errorCode === 'number' ? body.errorCode : undefined,
    }));
    return true;
  }

  if (url.pathname === '/sim/reset' && methodIs(req, 'POST')) {
    ctx.robot.reset();
    sendOk(res, ctx.robot.snapshot());
    return true;
  }

  if (url.pathname === '/sim/dataset' && methodIs(req, 'GET')) {
    sendOk(res, {
      name: ctx.mapStream.dataset,
      patchCount: ctx.mapStream.patchCount,
    });
    return true;
  }

  if (url.pathname === '/sim/dataset' && methodIs(req, 'POST')) {
    const body = await readJsonBody(req);
    const name = typeof body.name === 'string'
      ? body.name.trim()
      : url.searchParams.get('name')?.trim() ?? '';
    if (!name) {
      sendError(res, 400, 'dataset name is required');
      return true;
    }
    const patches = loadAllPatches(name);
    if (patches.length === 0) {
      sendError(res, 404, `dataset not found or empty: ${name}`);
      return true;
    }
    ctx.mapStream.switchDataset(name, patches);
    sendOk(res, {
      name: ctx.mapStream.dataset,
      patchCount: ctx.mapStream.patchCount,
    });
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

  if (url.pathname === '/sim/realism' && methodIs(req, 'GET')) {
    sendOk(res, ctx.chaos.realismSnapshot());
    return true;
  }

  if (url.pathname === '/sim/realism' && methodIs(req, 'POST')) {
    const body = await readJsonBody(req);
    sendOk(res, ctx.chaos.updateRealism({
      enabled: typeof body.enabled === 'boolean' ? body.enabled : undefined,
      httpDelayMinMs: typeof body.httpDelayMinMs === 'number' ? body.httpDelayMinMs : undefined,
      httpDelayMaxMs: typeof body.httpDelayMaxMs === 'number' ? body.httpDelayMaxMs : undefined,
      wsDelayMinMs: typeof body.wsDelayMinMs === 'number' ? body.wsDelayMinMs : undefined,
      wsDelayMaxMs: typeof body.wsDelayMaxMs === 'number' ? body.wsDelayMaxMs : undefined,
    }));
    return true;
  }

  if (url.pathname === '/sim/faults' && methodIs(req, 'GET')) {
    sendOk(res, listFaults());
    return true;
  }

  if (url.pathname === '/sim/fault' && methodIs(req, 'POST')) {
    const body = await readJsonBody(req);
    const name = typeof body.name === 'string'
      ? body.name.trim()
      : url.searchParams.get('name')?.trim() ?? '';
    if (!name) {
      sendError(res, 400, 'fault name is required');
      return true;
    }
    const result = applyFault(name, {
      robot: ctx.robot,
      chaos: ctx.chaos,
      switchDataset: (datasetName) => {
        const patches = loadAllPatches(datasetName);
        if (patches.length === 0) return { ok: false, error: `dataset not found or empty: ${datasetName}` };
        ctx.mapStream.switchDataset(datasetName, patches);
        return { ok: true, name: datasetName, patchCount: patches.length };
      },
    });
    if (!result.ok) {
      sendError(res, 400, result.error ?? `fault failed: ${name}`, 400, { data: result });
      return true;
    }
    sendOk(res, result);
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
