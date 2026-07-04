# Scenario scripts guide

YAML scenarios drive **cloud-accurate** `NOTIFY_RATEL_STATUS` pushes over WebSocket so the mower App FSM and navigation match production.

## How it works

| Layer | Behavior |
|-------|----------|
| `notify` step | Updates mock FSM **and** broadcasts `NOTIFY_RATEL_STATUS` with `work_status` + `sub_status` |
| App (`useWsDeviceListener`) | Parses same payload 鈫?`TaskEventPipeline` 鈫?panel / navigation |
| `POST /mapping/start` | Mock FSM `CMD_START` + WS `mapping` + `precondition` |
| Dedup | Identical `(work_status, sub_status)` is not pushed twice |

**Important:** 鐜板湪鐨?5 涓満鏅潎鑷寘鍚€斺€擿setup: { state: IDLE }` + `emit CMD_START` 鐢卞満鏅嚜琛屽缓浠诲姟锛屾棤闇€ App 鍏堝彂 HTTP `mapping/start` / `ratel_task/create`銆傜洿鎺ュ湪 `/sim/panel` 杩愯鍗冲彲椹卞姩 App FSM 涓庡鑸紱濡傞渶閰嶅悎鐪熸満杞ㄨ抗/鐡︾墖娓叉煋锛孉pp 浠嶉渶杩炰笂 WS锛堝壊鑽夎建杩硅繕闇€ `LOCATION_REGISTER`锛夈€?
## Mapping `sub_status` sequence (搂5.1)

| Step `sub_status` | App FSM / navigation |
|-------------------|----------------------|
| `precondition` | Stay `PREPARING`锛堣澶囪嚜妫€锛屼笉璺冲睆锛?|
| `leave_dock` | `UNDOCKING` 鈫?**DeviceStart** |
| `find_boundary` | `WORKING` + `MAP_SCAN_BOUNDARY` 鈫?**CreateMap** |
| `edge_mapping` | 鑷姩锛歚WORKING/MAP_FOLLOW_BOUNDARY`锛堣嚜鍔ㄦ部杈癸級锛?*鎵嬫憞锛坄mode=remote`锛?*锛歚WORKING` 鈫?`REMOTE_CONTROL` + `MAP_FOLLOW_BOUNDARY_MANUAL` 鈫?**ManualMap** 浜ゆ帴鐢ㄦ埛鎵嬫憞娌胯竟 |
| `map_edge_finish` | `MAP_BOUNDARY_DONE`锛涙墜鎽囨€佺敱姝?*閫€鍑洪仴鎺?*鍥炲埌鑷姩 `WORKING`锛岃繘鍏ャ€孡oading + 纭杩涜鐩栥€嶉椄闂?|
| `bow_cover` | `MAP_COVERAGE_RUN`锛堟墜鎽囨祦绋嬮渶鐢ㄦ埛纭鍚?`emit CMD_START_COVERAGE` 涔愯鍏堣锛?|
| `exit_mapping` | `MAP_COVERAGE_DONE` |
| `work_status: idle` + `sub_status: none` | `mapping鈫抜dle` 鈫?`COMPLETED` |

Between steps, scenarios use `wait: 5s`鈥揱20s` (stream scenario holds 30s in streamable phases).

## Mowing `sub_status` sequence (搂5.2)

| Step `sub_status` | Mock FSM |
|-------------------|----------|
| `map_check` | Stay in early prepare / accept `work_status: mowing` |
| `leave_dock` | `UNDOCKING` |
| `mowing` / `edge` | `WORKING` + `MOW_RUNNING` |
| `return_dock`锛坄work_status: mowing` 鐨?sub锛?| `returning` phase锛堜綆鐢靛洖鍏呰涔夛紝鏃э級 |
| `work_status: idle` + `sub_status: none` | Task completion edge |

### 鍥炴々锛堥《灞?`work_status: return_dock`锛屄?3锛?
銆屽洖鍏呫€嶆寜閽粨鏉熷壊鑽変换鍔″悗锛岃澶囦笂鎶?*椤跺眰** `work_status: return_dock` 鐨勫洖妗╁瓙娴佺▼锛?
| Step `sub_status`锛坄work_status: return_dock`锛?| Mock FSM |
|-------------------|----------|
| `go_to_pre_dock_point` | `RETURNING_DOCK` + `RETURN_PRE_DOCK` |
| `seek_charger_dock` | `RETURN_SEEK_CHARGER` |
| `enter_dock` | `RETURN_ENTER_DOCK` |
| `at_dock` | `RETURN_AT_DOCK`锛?*涓嶇洿鎺ュ畬鎴?*锛?|
| `failed` | `RETURN_DOCK_FAILED`锛堝彲鎭㈠閿欒锛岀暀鍦?`RETURNING_DOCK`锛?|
| `work_status: idle` + `sub_status: none` | `RETURNING_DOCK 鈫?COMPLETED` |

HTTP `POST /ratel/api/v1/robot/recharge/task` 浼氳Е鍙戝洖鍏呬换鍔″苟鑷姩鎺ㄩ€佷笂杩?`return_dock`
瀛愭祦绋?+ WS `cmd: RECHARGE`锛坄ON_THE_WAY 鈫?COMPLETE`锛岄┍鍔ㄥ洖鍏呮Ы鎸夐挳锛夈€俙mowing_recharge.yaml`
鍦烘櫙浠?`notify` 鐩存帴椹卞姩鍥炴々瀛愭祦绋嬶紝鏃犻渶 App 璋?HTTP銆?
Mowing 鍦烘櫙浣跨敤 `domain: mowing` 涓旇嚜琛?`emit CMD_START` 寤轰换鍔★紙`mowing_happy_auto`銆乣mowing_trajectory_stream` 鍧囪嚜鍖呭惈锛夈€傛敞鎰忥細鍓茶崏 `work_status: mowing` 鍦?`PREPARING` 涓嬩細鐩存帴杩涘叆 `UNDOCKING`锛堜笌寤哄浘涓嶅悓锛屽缓鍥?`work_status: mapping` 鍦ㄨ嚜妫€闃舵淇濇寔 `PREPARING`锛屼粎 `leave_dock` 鎵嶇妗╋級銆?
## 鍦烘櫙璇存槑锛圥anel / API锛?
姣忎釜 `scenarios/*.yaml` 鍙寘鍚?`guide:` 鍧楋紙涓枃鏍囬銆佺敤閫斻€佸墠缃潯浠躲€佹搷浣滄楠ゃ€佽嚜鍔ㄨ涓恒€佽€楁椂銆佹帹閫佺被鍨嬶級銆傚湪鎺у埗鍙伴槄璇伙細

1. 鍚姩鏈嶅姟鍚庢墦寮€ [http://localhost:9900/sim/panel](http://localhost:9900/sim/panel)
2. 鍦ㄣ€屽満鏅剼鏈€嶄笅鎷夋閫夋嫨鍦烘櫙锛堥€夐」鏄剧ず `[鍩焆 鏍囬 鈥?鏂囦欢鍚峘锛?3. 鐐瑰嚮 **闃呰璇存槑** 灞曞紑/鏀惰捣褰撳墠鍦烘櫙鐨勯€愭璇存槑锛涘垏鎹㈠満鏅椂浼氳嚜鍔ㄥ埛鏂拌鏄庡唴瀹?
API锛?
| 鏂规硶 | 璺緞 | 璇存槑 |
|------|------|------|
| GET | `/sim/scenarios` | 杩斿洖 `scenarios` 鍒楄〃銆乣catalog` 鎽樿銆乣running`銆乣paused` |
| GET | `/sim/scenario/guide?name=<鍦烘櫙鍚?` | 杩斿洖瀹屾暣 `guide` 鏂囨。锛圝SON锛?|
| POST | `/sim/scenario/run` | 杩愯鍦烘櫙锛坄name` 鎴?`inline`锛夛紝闃诲鑷冲畬鎴?鍋滄 |
| POST | `/sim/scenario/pause` | **鏆傚仠褰撳墠鍦烘櫙鑴氭湰**锛堝喕缁撴楠ゆ帹杩涗笌 `wait` 璁℃椂锛?|
| POST | `/sim/scenario/resume` | **鎭㈠鍦烘櫙鑴氭湰**锛屼粠鏆傚仠澶勭户缁悗缁楠?|
| POST | `/sim/scenario/stop` | 鍋滄鍦烘櫙鑴氭湰骞?`robot.reset()`锛堝仠鎺ㄦ祦锛?|

## Run

1. `npm start` mock service; App `mock/config.local.ts` 鈫?mock base URL.
2. `/sim/panel` 鈫?閫夋嫨鍦烘櫙 鈫?**璇存槑** 鏌ョ湅鐢ㄩ€?鈫?**杩愯鍦烘櫙**锛堣嚜鍖呭惈锛屾棤闇€ App 鍏堝缓浠诲姟锛夈€?3. 鏃犻檺寰幆鍦烘櫙锛坄*_stream`锛夋祴璇曞畬鎴愬悗鐐瑰嚮 **鍋滄鍦烘櫙**锛涜繍琛屼腑鍙敤 **鏆傚仠 / 鎭㈠**銆?
> **鏆傚仠 / 鎭㈠浼氱湡姝ｅ喕缁撳満鏅剼鏈湰韬?*锛堣€岄潪浠呮殏鍋滄満鍣ㄤ汉 FSM锛夛紝渚夸簬鍋滃湪鏌愪釜鐗瑰畾娴佺▼鐘舵€佽皟璇曘€備袱鏉¤矾寰勯兘鐢熸晥锛?> - **Web 闈㈡澘** 鏆傚仠 / 鎭㈠鎸夐挳锛堝唴閮ㄨ皟 `/sim/scenario/pause`銆乣/sim/scenario/resume`锛屽苟鍚屾涓嬪彂 `CMD_PAUSE`/`CMD_RESUME` 淇濇寔鏈哄櫒浜虹姸鎬佷竴鑷达級锛?> - **App 璋冪湡瀹?API** 鏆傚仠 / 鎭㈠锛坄mapping/pause`銆乣ratel_task/action` 绛夋渶缁堝鏈哄櫒浜轰笅鍙?`CMD_PAUSE`/`CMD_RESUME`锛夆€斺€旀満鍣ㄤ汉浼氬箍鎾?`controlPause`/`controlResume`锛屽紩鎿庢嵁姝よ嚜鍔ㄦ殏鍋?/ 鎭㈠銆?>
> 鏆傚仠鏈熼棿 `wait` 璁℃椂琚喕缁擄紙涓嶆秷鑰楃瓑寰呮椂闀匡級锛屾仮澶嶅悗浠庡師澶勭户缁€傚綋鍓嶆殏鍋滄€佸彲鐢?`GET /sim/state` 鐨?`scenario.paused` 璇诲彇锛岄潰鏉胯繍琛屼腑浼氭樉绀恒€屽満鏅? 杩愯涓?鈻?/ 宸叉殏鍋?鈴搞€嶃€?>
> ```bash
> curl -s -X POST http://localhost:9900/sim/scenario/pause -d '{}'
> curl -s -X POST http://localhost:9900/sim/scenario/resume -d '{}'
> ```

```bash
curl -s -X POST http://localhost:9900/sim/scenario/run \
  -H 'Content-Type: application/json' \
  -d '{"name":"mapping_happy_auto"}'
```

## Emergency-stop scenarios

Two dedicated emergency-stop scenarios are now available:

- `mapping_estop_edge_follow.yaml`: trigger `work_status: emergency_stop` after `MAP_FOLLOW_BOUNDARY`, verify `ESTOPPED`, release via a real `mapping` frame, then `CMD_RESET` into `RESUMING` and continue to `COMPLETED`.
- `mowing_estop_running.yaml`: trigger `work_status: emergency_stop` during `WORKING/MOW_RUNNING`, verify `ESTOPPED`, release via a real `mowing` frame, then `CMD_RESET` into `RESUMING` and continue to `COMPLETED`.

Both scenarios rely on the mirrored mower FSM where `work_status: emergency_stop` is a protocol input that the shared pipeline normalizes into `DEVICE_ESTOP` instead of forwarding as a normal `DEVICE_WORK_STATUS`.

## Checked-in scenarios

> 鏇存柊鏃ユ湡锛?026-06-11銆? 涓牳蹇冨満鏅紙涓嶅啀妯℃嫙寮傚父锛夈€備袱涓?stream 鍦烘櫙鍧囦负**鏃犻檺寰幆**锛岄渶鍦?`/sim/panel` 鐐瑰嚮銆屽仠姝㈠満鏅€嶇粨鏉熴€傛墍鏈夊満鏅潎**鑷寘鍚?*锛坄emit CMD_START` 鑷缓浠诲姟锛夛紝鏃犻渶 App 鍏堣皟 HTTP `mapping/start` 鎴?`ratel_task/create`銆?
| File | 鐢ㄩ€?| 缁撴潫鏂瑰紡 |
|------|------|----------|
| `mapping_happy_auto.yaml` | 姝ｅ父寤哄浘 happy flow锛氬畬鏁?NOTIFY 閾?鈫?`COMPLETED` | 鑷姩缁撴潫锛堢害 1.5 鍒嗛挓锛?|
| `mapping_happy_manual.yaml` | 鎵嬪姩閬ユ帶寤哄浘 happy flow锛氬鍒拌竟浜ゆ帴鎵嬫憞娌胯竟锛坄REMOTE_CONTROL`锛夆啋 娌胯竟闂悎 鈫?纭杩涜鐩?鈫?`COMPLETED` | 鑷姩缁撴潫锛堢害 1.5 鍒嗛挓锛?|
| `mowing_happy_auto.yaml` | 姝ｅ父鍓茶崏 happy flow锛歚map_check 鈫?mowing 鈫?return_dock 鈫?idle` 鈫?`COMPLETE` | 鑷姩缁撴潫锛堢害 40 绉掞級 |
| `mowing_recharge.yaml` | 鍓茶崏骞跺洖鍏咃紙鍥炴々锛夛細鍓茶崏涓Е鍙戝洖鍏?鈫?`RETURNING_DOCK` 鍥炴々瀛愰樁娈?鈫?`at_dock` 绛?`idle` 鈫?`COMPLETED` | 鑷姩缁撴潫锛堢害 35 绉掞級 |
| `mapping_estop_edge_follow.yaml` | 建图沿边后急停：`MAP_FOLLOW_BOUNDARY` → `emergency_stop` → `ESTOPPED` → release + `CMD_RESET` → `RESUMING` → `COMPLETED` | 自动结束（约 1 分钟） |
| `mowing_estop_running.yaml` | 割草执行中急停：`MOW_RUNNING` → `emergency_stop` → `ESTOPPED` → release + `CMD_RESET` → `RESUMING` → `COMPLETED` | 自动结束（约 45 秒） |
| `mapping_stream_incremental.yaml` | **鏃犻檺寰幆**锛氬湪鍙帹娴佸缓鍥鹃樁娈甸棿寰幆锛屾寔缁箍鎾?`MAP_INCREMENTAL`锛堟祴寤哄浘娓叉煋锛?| 鎵嬪姩鍋滄 |
| `mowing_trajectory_stream.yaml` | **鏃犻檺寰幆**锛氫繚鎸?`ON_THE_WAY`锛屾部璇箟鍦板浘璺嚎鎸佺画鎺?`ROBOT_LOCATION`锛堟祴鍓茶崏杞ㄨ抗娓叉煋锛?| 鎵嬪姩鍋滄 |

## Manual mapping with passages (v1.6)

The `mapping_happy_manual.yaml` scenario now supports the full DVT remote mapping workflow:

1. **Switch to remote**: App sends `POST /ratel/api/v1/mapping/mode { mode: "remote" }` or scenario emits `CMD_SWITCH_MANUAL`
2. **Add new lawn**: App sends `POST /ratel/api/v1/mapping/add_lawn` -> mock records `passageStartPoint`
3. **Robot moves**: WS `NOTIFY_RATEL_STATUS` carries `in_lawn: 1` and `edge_start_available: 1`
4. **Confirm edge start**: App sends `POST /ratel/api/v1/mapping/manual { edge_start: 1 }` -> mock records `passageEndPoint`, WS clears `edge_start_available`
5. **App computes passage**: Call `RustKit.queryTrajectorySegment()` between start/end -> construct `BoundaryFeature` -> render in `MapBuilder.passages`
6. **Region closure**: When robot returns near start, WS pushes `region_closeable: 1` -> user clicks confirm -> `POST /ratel/api/v1/mapping/manual { region_closure: 1 }`

### Recovery flow (APP killed and reopened)

1. `POST /ratel/api/v1/mapping/status` -> get `trajectory_url` + `passage_checkpoints`
2. `RustKit.loadTrajectoryFromUrl()` -> restore trajectory engine
3. For each checkpoint pair, call `RustKit.queryTrajectorySegment()` -> rebuild passages
4. Pass reconstructed `BoundaryFeature[]` to `MapBuilder.passages`

### New supported steps

| Step | Purpose |
|------|---------|
| `notify` | Now carries `in_lawn`, `edge_start_available`, `region_closeable` in WS payload |
| `emit` | New events: `CONFIRM_EDGE_START`, `CONFIRM_REGION_CLOSURE`, `RECORD_PASSAGE_START` |

## Supported steps

| Step | Purpose |
|------|---------|
| `notify` | `NOTIFY_RATEL_STATUS` (+ mock FSM via EventAdapter mirror) |
| `emit` | Raw FSM event (`CMD_START` / `CMD_PAUSE` / `CMD_RESUME` / `CMD_RESET` / `DEVICE_*` 鈥? |
| `expect` | Assert mock FSM snapshot |
| `wait` | Delay between WS pushes锛堝湪 `loop` 鍐呭彲琚€屽仠姝㈠満鏅€嶄腑鏂紝绾?50ms 绮掑害锛?|
| `loop` | 閲嶅鍐呭眰 `steps`锛涚渷鐣?`maxIterations`锛堟垨 `<= 0`锛夊嵆鏃犻檺寰幆锛岀洿鍒板満鏅鍋滄 |
| `chaos` | Update WS chaos config: `{ latencyMs, dropRate, reorderWindowMs }` |
| `realism` | Toggle/update real-world latency: `{ enabled, httpDelayMinMs, httpDelayMaxMs, wsDelayMinMs, wsDelayMaxMs }` |
| `fault` | Apply a named preset from `fixtures/faults/*.json`, e.g. `fault: mapping_estop` |
| `record` / `stopRecord` | Start/stop JSONL recording. `record: true` uses the scenario name as file prefix. |

Top-level scenario fields now also support:

| Field | Purpose |
|---|---|
| `dataset` | Switch `MapStream` to `fixtures/datasets/<dataset>/frames` before steps run. |
| `fixtures` | Temporarily override fixture reads while the scenario is running. |

Example:

```yaml
name: self_check_fault_smoke
domain: mapping
dataset: mapping_happy
fixtures:
  device/self_check.jsonc: { overall: "error", blade: "warning" }
steps:
  - fault: network_delay
  - realism: { enabled: true, httpDelayMinMs: 500, httpDelayMaxMs: 3000, wsDelayMinMs: 2000, wsDelayMaxMs: 8000 }
  - emit: { type: CMD_START, mode: auto, taskMode: MAP_BUILD }
```

### `loop` 鐢ㄦ硶

```yaml
steps:
  - loop:
      maxIterations: 0   # 鐪佺暐鎴?<=0 鈫?鏃犻檺寰幆锛堟墜鍔ㄥ仠姝級
      steps:
        - notify: { work_status: mapping, sub_status: bow_cover }
        - wait: 8s
```

鏃犻檺寰幆鍦烘櫙涓嬶紝寮曟搸浼氳嚜鍔ㄩ檺鍒惰繍琛屾棩蹇楁暟閲忥紙鏈€澶氫繚鐣欐渶杩?500 鏉★級锛屽苟鍦ㄥ仠姝㈡椂杩斿洖 `{ ok: true, stopped: true }`锛圥anel 鏄剧ず銆屽満鏅凡鍋滄銆嶏紝闈炲け璐ワ級銆?
> **鍋滄鍗冲仠鎺ㄦ祦**锛歚POST /sim/scenario/stop`锛圥anel銆屽仠姝㈠満鏅€嶏級鍦ㄤ腑姝㈣繍琛屼腑鐨勮剼鏈惊鐜悗浼氫竴骞?`robot.reset()`銆傚惁鍒欐満鍣ㄤ汉浼氬仠鐣欏湪 `WORKING`/`ON_THE_WAY`锛宍mapTimer`/`locationTimer` 浠嶆寜鐘舵€佹寔缁箍鎾?`MAP_INCREMENTAL` / `ROBOT_LOCATION`銆傚浣嶅悗 `activeTask` 缃┖銆乣shouldStreamMap` 杞?false锛屾帹娴佺珛鍗冲仠姝€?
See [backend-status-mapper-update.md](../../pudu_ratel_app_mower/build-docs/backend-status-mapper-update.md) and APP 绔帴鍙ｆ枃妗?搂WS鎺ユ敹鏈哄櫒鐘舵€佸彉鍖?
