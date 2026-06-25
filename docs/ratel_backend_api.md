# Ratel App 鍚庣 API 鍙傝€?
> 鏂囨。鐗堟湰锛?026-06-04  
> 鑼冨洿锛歐ebSocket锛堟崲绁ㄣ€佸湴鍥惧閲忋€佹満鍣ㄧ姸鎬併€佸壊鑽夎繘搴︺€佷綅缃祦锛? HTTP锛堝缓鍥句换鍔°€佸壊鑽変换鍔★級  
> 鏁村悎鑷細`robot_status_ws.md`銆乣mowing_api.md`銆乣mapbuilder_api.md`锛屽苟鍙傜収 `APP绔帴鍙ｆ枃妗?md` 琛ュ叏瀛楁  
> 鍏宠仈锛歚build-docs/mapping-mowing-button-transport.md`銆乣build-docs/backend-status-mapper-update.md`

---

## 鐜涓庡叕鍏辩害瀹?
| 椤圭洰 | 璇存槑 |
|------|------|
| 娴嬭瘯 Gateway | `https://ratel-cxg-test-internal.pudu.work`锛堜笌 `{{ratel-gateway}}` 绛変环锛?|
| HTTP 鍗忚 | HTTPS REST锛宍Content-Type: application/json` |
| WS 鍗忚 | 鍏堟崲绁ㄥ啀鎻℃墜锛岃 [搂1 WebSocket 鎺ュ叆](#1-websocket-鎺ュ叆) |
| 閴存潈 | Header `Authorization`锛歊atel 鐧诲綍鎬?access token锛屾敮鎸?`Bearer <token>` 涓庤８ token |
| 璁惧澶达紙鎺ㄨ崘锛?| `platform: ratel`锛沗X-Device-Id`锛沗X-Device`锛堝 `Android:google:Pixel 8`锛夛紱`X-Device-Version` |
| HTTP 鎴愬姛 | 鍝嶅簲浣?`code === 200` |
| 鏈哄櫒渚ч敊璇?| 閮ㄥ垎鎺ュ彛鍦?`code === -1` 鏃讹紝`data` 鍐呮惡甯?`robot_code` / `robot_message` |

### WS 娑堟伅閫氱敤缁撴瀯

鎵€鏈?WebSocket 娑堟伅鍧囬伒寰互涓嬬粨鏋勶紙瀹㈡埛绔笂琛屻€佹湇鍔＄涓嬭涓€鑷达級锛?
| 瀛楁 | 绫诲瀷 | 蹇呭～ | 鎻忚堪 |
|------|------|------|------|
| `cmd` | string | Y | 鎸囦护鏋氫妇 |
| `cmd_id` | string | Y | 娑堟伅鍞竴 ID锛圲UID锛夛紱鍥炲鏃跺甫涓婃敹鍒扮殑 `cmd_id` |
| `version` | int32 | N | 鍗忚鐗堟湰锛屽綋鍓嶅浐瀹氫负 `1` |
| `data` | object | N | 涓氬姟杞借嵎锛岀粨鏋勯殢 `cmd` 鑰屽畾 |

---

## 鐩綍

1. [WebSocket 鎺ュ叆](#1-websocket-鎺ュ叆)
2. [鏈哄櫒浜虹姸鎬佹帹閫侊紙WS锛塢(#2-鏈哄櫒浜虹姸鎬佹帹閫亀s)
3. [鍦板浘澧為噺鎺ㄩ€侊紙WS锛塢(#3-鍦板浘澧為噺鎺ㄩ€亀s)
4. [寤哄浘浠诲姟锛圚TTP锛塢(#4-寤哄浘浠诲姟http)
5. [鍓茶崏浠诲姟锛圚TTP锛塢(#5-鍓茶崏浠诲姟http)
6. [鍓茶崏杩涘害涓庝綅缃紙WS锛塢(#6-鍓茶崏杩涘害涓庝綅缃畐s)
7. [鍏叡鏁版嵁缁撴瀯](#7-鍏叡鏁版嵁缁撴瀯)
8. [寰呬笌鍚庣瀵归綈椤筣(#8-寰呬笌鍚庣瀵归綈椤?
9. [鍓嶇瀹炵幇瀵圭収](#9-鍓嶇瀹炵幇瀵圭収)

---

## 1. WebSocket 鎺ュ叆

寤虹珛 WebSocket 鍓嶏紝APP 椤诲厛鑾峰彇涓€娆℃€?`ticket`銆?
### 1.1 鑾峰彇 ticket

| 椤圭洰 | 鍊?|
|------|-----|
| 鏂规硶 | `POST` |
| 璺緞 | `/ratel/api/v1/wss/acc_ticket` |

**璇锋眰 Headers**

| Header | 绫诲瀷 | 蹇呭～ | 璇存槑 |
|--------|------|------|------|
| `Authorization` | string | 鏄?| 涓庣櫥褰曟€佷竴鑷寸殑 access token |
| `platform` | string | 鏄?| 璋冪敤鏂瑰钩鍙版爣璇嗭紙澶у皬鍐欎笉鏁忔劅锛夛紝濡?`ratel`锛涢儴鍒嗙幆澧冧害鏀寔 `1001` / `1002` / `1003` |
| `Content-Type` | string | 鏄?| `application/json` |

**鍝嶅簲 Body**

| 瀛楁 | 绫诲瀷 | 璇存槑 |
|------|------|------|
| `code` | int | `200` 琛ㄧず鎴愬姛 |
| `message` | string | 鎻忚堪鏂囨 |
| `ticket` | string | 鍗佸叚杩涘埗瀛楃涓诧紝浠呯敤浜?WS 鎻℃墜鏌ヨ鍙傛暟 |
| `expire_seconds` | int | 绁ㄦ嵁鏈夋晥绉掓暟锛堥粯璁?120锛?|
| `wss_path_hint` | string | 鎻愮ず锛屽 `ws://host/acc?ticket=<ticket>` |

**鎴愬姛绀轰緥**

```json
{
  "code": 200,
  "message": "Success",
  "ticket": "5f2c6d8a7b9e1f20a4c3d2e1b0f9a8c7",
  "expire_seconds": 120,
  "wss_path_hint": "ws://127.0.0.1:8899/acc?ticket=<ticket>"
}
```

```bash
curl -X POST 'https://ratel-cxg-test-internal.pudu.work/ratel/api/v1/wss/acc_ticket' \
  -H 'Authorization: Bearer eyJhbGciOi...' \
  -H 'platform: ratel' \
  -H 'Content-Type: application/json' \
  -d '{}'
```

**甯歌澶辫触**

- `400`锛氱己灏?`Authorization` / `platform`銆佹湭鐭?platform
- `401`锛歵oken 鏍￠獙澶辫触
- `503`锛氫笟鍔′笉鍙敤

### 1.2 WebSocket 鎻℃墜

```
ws://<WSS_HOST>:<WSS_PORT>/acc?ticket=<ticket>
wss://<WSS_HOST>:<WSS_PORT>/acc?ticket=<ticket>
```

- 蹇呴』甯︽煡璇㈠弬鏁?`ticket`锛涚己澶辨椂鏈嶅姟绔繑鍥?401
- 绁ㄦ嵁涓?*涓€娆℃€?*锛氭彙鎵嬫垚鍔熷嵆澶辨晥锛涙柇绾块噸杩為』**閲嶆柊鎹㈢エ**
- 鎻℃墜鎴愬姛鍚庢湇鍔＄绔嬪嵆寤虹珛鐧诲綍鎬侊紝**鏃?* WS 鍐?login 鎸囦护

### 1.3 蹇冭烦

**瀹㈡埛绔姹?*

```json
{
  "cmd_id": "550e8400-e29b-41d4-a716-446655440000",
  "cmd": "heartbeat",
  "data": {
    "userId": "10086"
  }
}
```

**鏈嶅姟绔搷搴?*

```json
{
  "cmd_id": "涓庤姹備竴鑷?,
  "cmd": "涓庤姹備竴鑷?,
  "data": {
    "code": 200,
    "codeMsg": "Success",
    "data": {}
  }
}
```

---

## 2. 鏈哄櫒浜虹姸鎬佹帹閫侊紙WS锛?
| 灞炴€?| 鍊?|
|------|-----|
| 鏂瑰悜 | 鏈嶅姟绔?鈫?瀹㈡埛绔紙Server Push锛?|
| 鎸囦护 | `NOTIFY_RATEL_STATUS` |
| 瑙﹀彂鏃舵満 | 鏈哄櫒浜虹姸鎬佸彂鐢熷彉鍖栨椂涓诲姩鎺ㄩ€?|

> 鐘舵€佸瓧娈垫槧灏勮 `build-docs/backend-status-mapper-update.md`銆?
### 2.1 椤跺眰瀛楁

| 瀛楁 | 绫诲瀷 | 蹇呭～ | 鎻忚堪 |
|------|------|------|------|
| `cmd` | string | Y | 鍥哄畾鍊?`"NOTIFY_RATEL_STATUS"` |
| `cmd_id` | string | Y | 娑堟伅鍞竴 ID锛圲UID锛?|
| `version` | int | Y | 鍗忚鐗堟湰锛屽綋鍓嶅浐瀹氫负 `1` |
| `data` | object | Y | 涓氬姟鏁版嵁锛岃涓嬭〃 |

### 2.2 `data` 瀛楁

| 瀛楁 | 绫诲瀷 | 蹇呭～ | 鎻忚堪 |
|------|------|------|------|
| `sn` | string | Y | 鏈哄櫒 SN |
| `mac` | string | N | 鏈哄櫒 MAC |
| `work_status` | string | Y | 鏈哄櫒宸ヤ綔鐘舵€侊紝瑙?[work_status 鏋氫妇](#work_status-鏋氫妇) |
| `sub_status` | string | N | 涓荤姸鎬佸唴闃舵锛沗none` 鎴栫┖琛ㄧず鏃犳湁鏁堝瓙鐘舵€侊紙App 浼氬洖閫€璇?legacy `phase`锛?|
| `work_msg` | string | N | `work_status` 琛ュ厖璇存槑锛堝鏁呴殰鍘熷洜锛?|
| `battery` | object | N | 鐢垫睜鐘舵€侊紝瑙?[battery](#data-battery) |
| `signals` | object | N | 缃戠粶淇″彿锛岃 [signals](#data-signals) |
| `phase` | string | N | **閬楃暀瀛楁**锛氶儴鍒?mock/鏃у浐浠跺湪 `sub_status` 鏃犳晥鏃舵惡甯﹂樁娈靛悕锛堝 `MOW_RUNNING`锛?|
| `state` | string | N | **璋冭瘯/杈呭姪**锛氭湇鍔＄ FSM 蹇収锛堝 `PREPARING`銆乣WORKING`锛夛紝闈?App 涓绘秷璐硅矾寰?|
| `capabilities` | object | N | 鑳藉姏寮€鍏筹紙濡?`can_switch_manual`銆乣can_switch_auto`锛?|
| `estop` | object | N | 鎬ュ仠鐘舵€侊紙濡?`{ "active": false }`锛?|
| `notices` | array | N | 閫氱煡鍒楄〃 |
| `error` | object | N | 閿欒璇︽儏 |

#### `work_status` 鏋氫妇

| 鍊?| 鍚箟 |
|----|------|
| `idle` | 绌洪棽涓?|
| `mowing` | 鍓茶崏涓?|
| `charging` | 鍏呯數涓?|
| `mapping` | 寤哄浘涓?|
| `error` | 鏁呴殰 |

### 2.3 `data.battery`

| 瀛楁 | 绫诲瀷 | 蹇呭～ | 鎻忚堪 |
|------|------|------|------|
| `level` | int | Y | 鐢甸噺鐧惧垎姣旓紙0 ~ 100锛?|
| `charging` | int | Y | 鏄惁鍏呯數锛歚1` = 鍏呯數涓紝`-1` = 鏈厖鐢?|
| `temperature` | float | Y | 鐢垫睜娓╁害锛堚剝锛?|
| `cycles` | int | Y | 鍏呯數寰幆娆℃暟 |

### 2.4 `data.signals`

| 瀛楁 | 绫诲瀷 | 蹇呭～ | 鎻忚堪 |
|------|------|------|------|
| `bluetooth` | object | N | 瑙佷笅琛?|
| `wifi` | object | N | 瑙佷笅琛?|
| `cellular` | object | N | 瑙佷笅琛?|

**`data.signals.bluetooth`**

| 瀛楁 | 绫诲瀷 | 蹇呭～ | 鎻忚堪 |
|------|------|------|------|
| `connected` | int | Y | `1` = 宸茶繛鎺ワ紝`-1` = 鏈繛鎺?|
| `rssi` | int | Y | 淇″彿寮哄害锛坉Bm锛岃秺澶ц秺寮猴級 |

**`data.signals.wifi`**

| 瀛楁 | 绫诲瀷 | 蹇呭～ | 鎻忚堪 |
|------|------|------|------|
| `connected` | int | Y | `1` = 宸茶繛鎺ワ紝`-1` = 鏈繛鎺?|
| `ssid` | string | Y | 宸茶繛鎺?WiFi 鍚嶇О |
| `rssi` | int | Y | 淇″彿寮哄害锛坉Bm锛?|
| `signal_strength` | string | Y | `good` / `medium` / `poor` |

**`data.signals.cellular`**

| 瀛楁 | 绫诲瀷 | 蹇呭～ | 鎻忚堪 |
|------|------|------|------|
| `connected` | int | Y | `1` = 宸茶繛鎺ワ紝`-1` = 鏈繛鎺?|
| `signal_strength` | string | Y | `good` / `medium` / `poor` / `none` |

### 2.5 瀹㈡埛绔?ACK

| 瀛楁 | 绫诲瀷 | 蹇呭～ | 鎻忚堪 |
|------|------|------|------|
| `result` | string | Y | `"SUCCESS"` 琛ㄧず鎺ユ敹鎴愬姛 |

### 2.6 瀹屾暣绀轰緥

```json
{
  "cmd": "NOTIFY_RATEL_STATUS",
  "cmd_id": "12345678-abcdefghi-111111111",
  "version": 1,
  "data": {
    "sn": "TSAABBC1C2C4C2",
    "sub_status": "none",
    "work_status": "mowing",
    "work_msg": "姝ｅ父鍓茶崏涓?,
    "battery": {
      "level": 78,
      "charging": -1,
      "temperature": 28.5,
      "cycles": 42
    },
    "signals": {
      "bluetooth": { "connected": 1, "rssi": -55 },
      "wifi": {
        "connected": 1,
        "ssid": "HomeWiFi",
        "rssi": -62,
        "signal_strength": "good"
      },
      "cellular": { "connected": -1, "signal_strength": "none" }
    }
  }
}
```

---

## 3. 鍦板浘澧為噺鎺ㄩ€侊紙WS锛?
**cmd锛?* `MAP_INCREMENTAL`

**鏂瑰悜锛?* 鏈嶅姟绔?鈫?瀹㈡埛绔紙鍦板浘澧為噺锛夛紱瀹㈡埛绔?鈫?鏈嶅姟绔紙ACK锛?
### 3.1 鏈嶅姟绔?鈫?瀹㈡埛绔?`data`

| 瀛楁 | 绫诲瀷 | 蹇呭～ | 鎻忚堪 |
|------|------|------|------|
| `sn` | string | Y | 鏈哄櫒 SN |
| `map_header` | object | Y | 鍦板浘澧為噺澶翠俊鎭?|
| `map_data` | string | Y | 澧為噺鏁版嵁锛氬缓鍥惧閲忓抚涓?`base64`锛堜笉鍘嬬缉锛夛紱Mock 榛樿涓庝箣涓€鑷达紝鍙敤 `MMR_GZIP=1` 鍒囧洖 `base64 + gzip` |

**`data.map_header` 涓昏瀛楁**

| 瀛楁 | 绫诲瀷 | 璇存槑 |
|------|------|------|
| `version` | int32 | 鍗忚鐗堟湰锛屽浐瀹?`1` |
| `header_len` | uint32 | header 闀垮害 |
| `data_len` | uint32 | 瑙ｇ爜鍚庡浘鍍忓瓧鑺傛暟 |
| `msg_type` | uint32 | `0x01` 鐏板害鍥撅紱`0x02` 璇箟鍥?|
| `timestamp_sec` / `timestamp_nsec` | uint64 | Unix 鏃堕棿鎴?|
| `width` / `height` | uint32 | 澧為噺瀹介珮锛坈ell 鏁帮級 |
| `resolution` | float | 绫?cell |
| `origin_x` / `origin_y` | double | 鍦板浘鍘熺偣锛堢背锛?|
| `robot_x` / `robot_y` / `robot_theta` | double | 鏈哄櫒浜轰綅濮?|
| `format` | string | 濡?`png` |
| `map_id` | string / uint64 | 鍦板浘 ID |
| `frame_id` | uint64 | 褰撳墠甯?ID锛圓CK 椤诲洖浼狅級 |
| `frame_slicing_total` | uint32 | 鍒囩墖鎬绘暟 |
| `frame_slicing_id` | uint64 | 鍒囩墖 ID锛圓CK 椤诲洖浼狅級 |
| `frame_slicing_index` | uint32 | 鍒囩墖绱㈠紩锛屼粠 0 璧?|
| `crc32` | uint32 | 鏁版嵁 CRC32 |
| `lawn_area` | float | 寤哄浘闈㈢Н锛堝崟浣嶄互鍥轰欢/浜у搧涓哄噯锛?|

> 閮ㄥ垎鍥轰欢浜︿娇鐢?`map_package_total`銆乣map_transfer_id`銆乣map_package_index` 绛夊瓧娈靛懡鍚嶏紝璇箟涓庡垏鐗囧瓧娈电被浼硷紝浠ュ疄闄?payload 涓哄噯銆?
**鎺ユ敹绀轰緥**

```json
{
  "cmd": "MAP_INCREMENTAL",
  "cmd_id": "<鎸囦护鍞竴id>",
  "version": 1,
  "data": {
    "sn": "69:32:3B:eD:AA:64",
    "map_header": {
      "version": 1,
      "header_len": 36,
      "data_len": 1600,
      "msg_type": 2,
      "timestamp_sec": 1773890709,
      "timestamp_nsec": 416000000,
      "width": 40,
      "height": 40,
      "resolution": 0.05,
      "origin_x": 34.75,
      "origin_y": 25.65,
      "robot_x": 0.0,
      "robot_y": 0.0,
      "robot_theta": 0.0,
      "format": "png",
      "map_id": "0",
      "frame_id": 45545,
      "frame_slicing_total": 1,
      "frame_slicing_id": 522231,
      "frame_slicing_index": 0,
      "crc32": 363052545,
      "lawn_area": 20.2
    },
    "map_data": "<base64>"
  }
}
```

### 3.2 瀹㈡埛绔?鈫?鏈嶅姟绔?ACK `data`

App 澶勭悊鎴愬姛鍚庨』鍥炲锛圧ustKit 鍙嚜鍔?ACK锛涘瓧娈典互鍗忚涓哄噯锛夛細

| 瀛楁 | 绫诲瀷 | 蹇呭～ | 鎻忚堪 |
|------|------|------|------|
| `result` | string | Y | `SUCCESS` 琛ㄧず澶勭悊鎴愬姛 |
| `payload` | object | N | 閫忎紶鍥炴満鍣ㄧ |

**`payload`锛堟帹鑽愶級**

| 瀛楁 | 绫诲瀷 | 蹇呭～ | 鎻忚堪 |
|------|------|------|------|
| `session_id` | string | Y | 甯у敮涓€缂栧彿 |
| `ack` | bool | Y | `true` 琛ㄧず App 纭鏀跺埌 |

**绠€鍖?ACK 绀轰緥锛坄APP绔帴鍙ｆ枃妗 褰㈡€侊級**

```json
{
  "cmd": "MAP_INCREMENTAL",
  "cmd_id": "涓庢敹鍒扮殑 cmd_id 涓€鑷?,
  "version": 1,
  "data": {
    "code": 200,
    "msg": ""
  }
}
```

---

## 4. 寤哄浘浠诲姟锛圚TTP锛?
璺緞鍓嶇紑锛歚/ratel/api/v1/mapping/`锛堣嚜妫€涓?`/ratel/api/v1/robot/self_check`锛夈€?
**寤哄浘妯″紡 `mode` 鏋氫妇**锛坄start` / `mode` 鍏辩敤锛夛細

| 鍊?| 鍚箟 |
|----|------|
| `auto` | 鑷姩鎺㈢储寤哄浘 |
| `remote` | 鎵嬪姩閬ユ帶寤哄浘 |
| `follow` | 璺熼殢鐢ㄦ埛寤哄浘 |

### 4.0 閫氱煡鏈哄櫒寮€濮嬭嚜妫€

寤哄浘鍓嶇疆椤甸』**鍏?*璋冪敤鏈帴鍙ｏ紝鍐嶈疆璇?[4.1 寤哄浘鏉′欢妫€娴媇(#41-寤哄浘鏉′欢妫€娴?銆?
| 椤圭洰 | 鍊?|
|------|-----|
| 鏂规硶 | `POST` |
| 璺緞 | `/ratel/api/v1/robot/self_check` |

**璇锋眰 Body**

| 瀛楁 | 绫诲瀷 | 蹇呭～ | 璇存槑 |
|------|------|------|------|
| `sn` | string | 鏄?| 鏈哄櫒 SN |

**鍝嶅簲 `data`**

| 瀛楁 | 绫诲瀷 | 璇存槑 |
|------|------|------|
| `checked_at` | int64 | 鑷鏃堕棿鎴筹紙姣锛?|
| `overall` | string | 缁煎悎鐘舵€侊細`ok` / `warning` / `error` |
| `blade` | string | 鍒€鐗囷細`normal` / `warning` / `error` |
| `wheel` | string | 杞﹁疆鐘舵€?|
| `sensor` | string | 浼犳劅鍣ㄧ姸鎬?|
| `motor` | string | 鐢垫満鐘舵€?|
| `gps` | string | GPS 鐘舵€?|

鍓嶇锛歚postRobotSelfCheck` 鈫?`runMappingPrepareChecks`锛堣疆璇㈢粏鑺傝 `src/features/mapping/prepare/README.md`锛夈€?
### 4.1 寤哄浘鏉′欢妫€娴?
鍦?[4.0](#40-閫氱煡鏈哄櫒寮€濮嬭嚜妫€) 鎴愬姛鍚?*杞**锛圓pp 榛樿闂撮殧 1.5s銆佽秴鏃?60s锛夈€?
| 椤圭洰 | 鍊?|
|------|-----|
| 鏂规硶 | `POST` |
| 璺緞 | `/ratel/api/v1/mapping/check` |

**璇锋眰 Body**

| 瀛楁 | 绫诲瀷 | 蹇呭～ | 璇存槑 |
|------|------|------|------|
| `sn` | string | 鏄?| 鏈哄櫒 SN |

**鍝嶅簲 `data`锛堟墎骞崇粨鏋勶紝`APP绔帴鍙ｆ枃妗 2026-06-04锛?*

> **杩佺Щ**锛氭棫鐗堟浘浣跨敤 `data.all_ok` + `data.conditions.*` 宓屽锛涘綋鍓嶅崗璁皢涓嬪垪瀛楁鐩存帴鎸傚湪 `data` 涓嬨€侫pp 鍦?`postMappingCheck` 鍏ュ彛鐢?`normalizeMappingCheckData` 鍏煎鏃х綉鍏炽€?
| 瀛楁 | 绫诲瀷 | 璇存槑 | 鍓嶇疆椤?id |
|------|------|------|-----------|
| `bluetooth_status` | string | `ok` / `warning` / `error` | `bluetooth` |
| `bluetooth_msg` | string | 钃濈墮寮傚父鏂囨 | 鈥?|
| `cellular` | string | 铚傜獫缃戠粶 | `4g` |
| `wifi` | string | WiFi | `wifi` |
| `battery` | string | 鐢甸噺 | `battery` |
| `docking_station` | string | 鍏呯數搴?/ 褰掍綅 | `charger` |
| `light` | string | 鍏夌嚎 | `light` |

**杞缁撴潫**锛氫笂杩板叚椤癸紙涓嶅惈 `bluetooth_msg`锛夊潎鏈夐潪绌鸿繑鍥炲€笺€? 
**鏄惁鍙缓鍥撅紙App锛?*锛氬叚椤归綈鍏ㄤ笖鍧囦负 `ok`锛坄isServerAllOk`锛夛紝涓嶅啀璇诲彇 `all_ok`銆?
```bash
curl -X POST 'https://ratel-cxg-test-internal.pudu.work/ratel/api/v1/mapping/check' \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer <token>' \
  -d '{"sn":"TSAABBC1C2C4C2"}'
```

### 4.2 寮€濮嬪缓鍥?
| 鏂规硶 | `POST` |
| 璺緞 | `/ratel/api/v1/mapping/start` |

**Body锛?* `sn`锛坰tring锛夈€乣map_id`锛坰tring锛夈€乣mode`锛坄auto` \| `remote` \| `follow`锛?
**鏈哄櫒閿欒鏃?`data`锛?* `robot_code`銆乣robot_message`

### 4.3 鏆傚仠寤哄浘

| 鏂规硶 | `POST` |
| 璺緞 | `/ratel/api/v1/mapping/pause` |

**Body锛?* `{ "sn": "<SN>" }`

### 4.4 鎭㈠寤哄浘

| 鏂规硶 | `POST` |
| 璺緞 | `/ratel/api/v1/mapping/resume` |

**Body锛?* `{ "sn": "<SN>" }`

### 4.5 鍋滄寤哄浘

| 鏂规硶 | `POST` |
| 璺緞 | `/ratel/api/v1/mapping/stop` |

**Body锛?* `sn`锛坰tring锛夈€乣save`锛坆ool锛宍true` 淇濆瓨鍦板浘锛?
### 4.6 鍒囨崲寤哄浘妯″紡

| 鏂规硶 | `POST` |
| 璺緞 | `/ratel/api/v1/mapping/mode` |

**Body锛?* `sn`锛坰tring锛夈€乣mode`锛坄auto` \| `remote` \| `follow`锛?
---

## 5. 鍓茶崏浠诲姟锛圚TTP锛?
璺緞鍓嶇紑锛歚/ratel/central-control-service/api/v1/ratel_task/`

### 5.1 鍙戣捣鍓茶崏浠诲姟

| 鏂规硶 | `POST` |
| 璺緞 | `/ratel/central-control-service/api/v1/ratel_task/create` |

**璇锋眰 Body**

| 瀛楁 | 绫诲瀷 | 蹇呭～ | 璇存槑 |
|------|------|------|------|
| `sn` | string | 鏄?| 璁惧 SN |
| `task_info` | object | 鏄?| 鍓茶崏浠诲姟鍙傛暟 |

**`task_info`**

| 瀛楁 | 绫诲瀷 | 蹇呭～ | 鍗曚綅 | 璇存槑 |
|------|------|------|------|------|
| `task_mode` | string | 鏄?| 鈥?| `"global"` 鍏ㄥ眬 \| `"area"` 灞€閮?|
| `map_id` | string | 鏄?| 鈥?| 鍦板浘 ID |
| `area_id` | string[] | 鏉′欢 | 鈥?| `task_mode="area"` 鏃跺繀濉?|
| `mow_height` | float | 鏄?| mm | 鍓茶崏楂樺害 |
| `mow_speed` | float | 鏄?| m/s | 0.3 ~ 1.0锛屾杩?0.1 |
| `texture` | object | 鏄?| 鈥?| 寮撳舰绾圭悊鍙傛暟 |

**`task_info.texture`**

| 瀛楁 | 绫诲瀷 | 蹇呭～ | 璇存槑 |
|------|------|------|------|
| `mode` | string | 鏄?| `"global"` \| `"area"` |
| `bow_shaped_spacing` | number | 鏄?| 寮撳舰闂磋窛锛坢m锛涙枃妗ｄ害鏈?int32 鎻忚堪锛?|
| `texture_angle` | int32 | 鏄?| 绾圭悊瑙掑害 [0, 180) 搴?|
| `intelligent_alternation_mode` | boolean | 鏄?| 鏅鸿兘浜ゆ浛妯″紡 |

**鍝嶅簲 `data`锛?* `task_id`銆乣robot_code`銆乣robot_message`

```bash
curl -X POST 'https://ratel-cxg-test-internal.pudu.work/ratel/central-control-service/api/v1/ratel_task/create' \
  -H 'Content-Type: application/json' \
  -H 'Authorization: <token>' \
  -H 'platform: ratel' \
  -H 'X-Device-Id: <device-id>' \
  -H 'X-Device: Android:google:Pixel 8' \
  -H 'X-Device-Version: 16' \
  -d '{
    "sn": "TSAABBC1C2C4C2",
    "task_info": {
      "task_mode": "global",
      "map_id": "123",
      "mow_height": 60,
      "mow_speed": 0.5,
      "texture": {
        "mode": "global",
        "bow_shaped_spacing": 6,
        "texture_angle": 0,
        "intelligent_alternation_mode": true
      }
    }
  }'
```

### 5.2 鍓茶崏浠诲姟 Action锛堟殏鍋?/ 缁х画 / 鍙栨秷锛?
| 鏂规硶 | `POST` |
| 璺緞 | `/ratel/central-control-service/api/v1/ratel_task/action` |

**Body锛?* `sn`銆乣task_id`銆乣action`锛坄PAUSE` \| `RESUME` \| `CANCEL`锛?
**鍝嶅簲 `data`锛?* `robot_code`銆乣robot_message`

### 5.3 鍓茶崏浠诲姟鍒楄〃

| 鏂规硶 | `POST` |
| 璺緞 | `/ratel/central-control-service/api/v1/ratel_task/list` |

**Body锛?* `{ "sn": "<SN>" }`

**鍝嶅簲 `data`**

| 瀛楁 | 绫诲瀷 | 璇存槑 |
|------|------|------|
| `total` | int32 | 浠诲姟鎬绘暟 |
| `list` | TaskSummary[] | 浠诲姟鎽樿鍒楄〃 |
| `task_info` | object | 褰撳墠鎵ц涓换鍔″弬鏁帮紙缁撴瀯鍚?搂5.1 `task_info`锛?|
| `task_notify` | object | 鏈哄櫒鏈€鍚庝竴娆′笂鎶ヨ繘搴︼紝瑙?[TaskNotify](#tasknotify) |

**`list[]` 鏉＄洰锛坄APP绔帴鍙ｆ枃妗 鎵╁睍锛?*

| 瀛楁 | 绫诲瀷 | 璇存槑 |
|------|------|------|
| `task_id` | string | 浠诲姟 ID |
| `task_status` | string | 瑙?[TaskStatus](#taskstatus-鏋氫妇) |
| `task_info` | object | 涓嬪彂浠诲姟鍙傛暟 |
| `task_notify` | object | 鏈€杩戣繘搴?|
| `create_time` | int64 | 鍒涘缓鏃堕棿锛堢锛?|
| `update_time` | int64 | 鏇存柊鏃堕棿锛堢锛?|

---

## 6. 鍓茶崏杩涘害涓庝綅缃紙WS锛?
### 6.1 鍓茶崏浠诲姟鐘舵€佹帹閫?鈥?`NOTIFY_MOW_STATUS`

| 灞炴€?| 鍊?|
|------|-----|
| 鏂瑰悜 | 鏈嶅姟绔?鈫?瀹㈡埛绔?|
| 瑙﹀彂 | 鍓茶崏浠诲姟鐘舵€佹垨杩涘害鍙樺寲 |

**娑堟伅缁撴瀯**

| 瀛楁 | 绫诲瀷 | 璇存槑 |
|------|------|------|
| `cmd` | string | `"NOTIFY_MOW_STATUS"` |
| `cmd_id` | string | UUID |
| `version` | int | `1` |
| `data.sn` | string | 璁惧 SN |
| `data.payload` | object | 浠诲姟杩涘害锛屽瓧娈佃 [TaskNotify](#tasknotify) + `task_id` / `task_status` |

> App 瑙ｆ瀽锛歚data.payload` 鍙兘宓屽鍦?`data` 椤跺眰閲嶅涓€浠斤紱浠?`payload` 涓哄噯锛堣 `mowStatusPayload.ts`锛夈€?
**鎺ユ敹绀轰緥**

```json
{
  "cmd": "NOTIFY_MOW_STATUS",
  "cmd_id": "2aa8d21f-ba5c-4cbd-a33c-6f82cd386837",
  "version": 1,
  "data": {
    "sn": "TSD29C35EFD104",
    "payload": {
      "sn": "TSD29C35EFD104",
      "task_id": "mock-task-001",
      "task_status": "ON_THE_WAY",
      "task_type": "cloud",
      "task_message": "",
      "task_error_code": 0,
      "mow_area": 256.5,
      "mow_progress": 100,
      "estimated_time": 0,
      "timestamp": 1779891513,
      "notify_timestamp": 1779891513108
    }
  }
}
```

### 6.2 浣嶇疆鎺ㄩ€佺櫥璁?鈥?`LOCATION_REGISTER`

**鏂瑰悜锛?* 瀹㈡埛绔?鈫?鏈嶅姟绔?
鍓茶崏浠诲姟寮€濮嬫椂鐧昏涓€娆★紱浠诲姟缁撴潫鍙?[鍙栨秷鐧昏](#63-浣嶇疆鎺ㄩ€佸彇娑堢櫥璁?-location_unregister)銆?
| 瀛楁 | 绫诲瀷 | 蹇呭～ | 璇存槑 |
|------|------|------|------|
| `cmd` | string | 鏄?| `"LOCATION_REGISTER"` |
| `cmd_id` | string | 鏄?| UUID |
| `version` | int | 鏄?| `1` |
| `data.sn` | string | 鏄?| 鏈哄櫒 SN |

```json
{
  "cmd": "LOCATION_REGISTER",
  "cmd_id": "loc-1730000000000",
  "version": 1,
  "data": { "sn": "SF3198423328000" }
}
```

> 椤婚€氳繃 RustKit `wsSend` 鍐欏叆宸插缓绔嬬殑 WS 杩炴帴锛涚櫥璁版垚鍔熷悗鏈嶅姟绔墠鎺ㄩ€?`ROBOT_LOCATION`銆?
### 6.3 浣嶇疆鎺ㄩ€佸彇娑堢櫥璁?鈥?`LOCATION_UNREGISTER`

**鏂瑰悜锛?* 瀹㈡埛绔?鈫?鏈嶅姟绔?
| 瀛楁 | 绫诲瀷 | 蹇呭～ | 璇存槑 |
|------|------|------|------|
| `cmd` | string | 鏄?| `"LOCATION_UNREGISTER"` |
| `data.sn` | string | 鏄?| 鏈哄櫒 SN |

### 6.4 鏈哄櫒浣嶇疆鎺ㄩ€?鈥?`ROBOT_LOCATION`

**鏂瑰悜锛?* 鏈嶅姟绔?鈫?瀹㈡埛绔紙瀹屾垚 `LOCATION_REGISTER` 涓斾换鍔′负娲昏穬鍓茶崏鎬佸悗鎸佺画鎺ㄩ€侊紝鍏稿瀷闂撮殧 300ms锛?
| 瀛楁 | 绫诲瀷 | 鍗曚綅 | 蹇呭～ | 璇存槑 |
|------|------|------|------|------|
| `cmd` | string | 鈥?| 鏄?| `"ROBOT_LOCATION"` |
| `data.sn` | string | 鈥?| 鏄?| 鏈哄櫒 SN |
| `data.mac` | string | 鈥?| 鏄?| MAC |
| `data.map_id` | string | 鈥?| 鏄?| 褰撳墠鍦板浘 ID |
| `data.x` | float | m | 鏄?| X 鍧愭爣 |
| `data.y` | float | m | 鏄?| Y 鍧愭爣 |
| `data.angle` | float | rad | 鏄?| 鏈濆悜 |
| `data.timestamp` | int64 | s | 鏄?| 鏈哄櫒涓婃姤鏃堕棿鎴?|
| `data.notify_time` | int64 | ms | 鏄?| 鏈嶅姟绔帹閫佹椂闂存埑 |

```json
{
  "cmd": "ROBOT_LOCATION",
  "cmd_id": "<uuid>",
  "version": 1,
  "data": {
    "sn": "SF3198423328000",
    "mac": "B4:ED:D5:75:6E:BC",
    "map_id": "123",
    "x": -0.019724773,
    "y": 0.042629186,
    "angle": -0.21470512,
    "timestamp": 1779866504,
    "notify_time": 1779866504001
  }
}
```

---

## 7. 鍏叡鏁版嵁缁撴瀯

### TaskSummary

| 瀛楁 | 绫诲瀷 | 璇存槑 |
|------|------|------|
| `task_id` | string | 鍓茶崏浠诲姟 ID |
| `task_status` | string | 瑙?[TaskStatus](#taskstatus-鏋氫妇) |

### TaskNotify

鐢ㄤ簬 `list.task_notify` 鍙?`NOTIFY_MOW_STATUS.data.payload`銆?
| 瀛楁 | 绫诲瀷 | 璇存槑 |
|------|------|------|
| `task_id` | string | 浠诲姟 ID锛圵S payload 涓級 |
| `task_status` | string | 浠诲姟鐘舵€?|
| `task_type` | string | `"cloud"` 浜戠 \| `"button"` 鎸夐敭 |
| `task_message` | string | 鐘舵€佹弿杩?|
| `task_error_code` | int32 | 閿欒鐮?|
| `mow_area` | float | 鎬诲壊鑽夐潰绉紙鍗曚綅寰呯‘璁わ級 |
| `mow_progress` | float | 鍓茶崏杩涘害锛堟帹鏂负 0鈥?00 鐧惧垎姣旓級 |
| `estimated_time` | float | 棰勮瀹屾垚鏃堕棿锛堝崟浣嶅緟纭锛?|
| `timestamp` | int64 | 鏈哄櫒涓婃姤鏃堕棿锛堢锛?|
| `notify_timestamp` | int64 | 閫氱煡鏃堕棿锛堟绉掞級 |

### TaskStatus 鏋氫妇

| 鍊?| 鍚箟 |
|----|------|
| `ON_THE_WAY` | 杩涜涓紙鍚墠寰€鍓茶崏鍖哄煙閫斾腑锛?|
| `PAUSE` | 宸叉殏鍋?|
| `COMPLETE` | 宸插畬鎴?|
| `CANCEL` | 宸插彇娑?|
| `FAILED` | 澶辫触锛堟満鍣ㄦ嫆缁濅换鍔★紝鐢卞悗绔洿鏂帮級 |

---

## 8. 寰呬笌鍚庣瀵归綈椤?
> 浠ヤ笅闂闇€涓庡悗绔‘璁ゅ悗濉叆姝ｅ紡鍙栧€笺€?
### 8.1 瀛楁绫诲瀷 / 鍙栧€艰寖鍥?
| # | 瀛楁 | 寰呯‘璁?|
|---|------|--------|
| T1 | `task_info.bow_shaped_spacing` | `float` 杩樻槸 `int32`锛?.1mm 鏁存暟锛夛紵鍙栧€艰寖鍥达紵 |
| T2 | `mow_progress` | 鏄惁涓?`[0, 100]` 鐧惧垎姣旓紵 |

### 8.2 缂哄皯鍗曚綅

| # | 瀛楁 | 寰呯‘璁ゅ崟浣?|
|---|------|------------|
| U1 | `mow_area` | m虏 鎴栧叾浠?|
| U2 | `estimated_time` | 绉掋€佸垎閽熸垨姣 |

### 8.3 缂哄皯閿欒鐮佸畾涔?
| # | 瀛楁 | 寰呯‘璁?|
|---|------|--------|
| E1 | `robot_code` | 鏋氫妇琛?|
| E2 | `task_error_code` | 瀹屾暣鏄犲皠 |
| E3 | HTTP `code` | 闄?`200` 澶栫殑涓氬姟鐮?|

### 8.4 绌哄€?/ 鍙€夋€?
| # | 鍦烘櫙 | 寰呯‘璁?|
|---|------|--------|
| N1 | 浠诲姟 `FAILED` / `CANCEL` | `task_info` / `task_notify` 涓?`null` 杩樻槸鐪佺暐锛?|
| N2 | 鏃犳墽琛屼腑浠诲姟 | `task_info` 涓?`null`銆乣{}` 杩樻槸涓嶈繑鍥烇紵 |

---

## 9. 鍓嶇瀹炵幇瀵圭収

### 寤哄浘 HTTP锛堟埅鑷?2026-06-04锛?
璇﹁ `build-docs/mapping-mowing-button-transport.md`銆?
| 鎺ュ彛 | App 灏佽 | 瑙﹁揪 |
|------|----------|------|
| 寮€濮嬭嚜妫€ | `postRobotSelfCheck` | HTTP 鈫?`runMappingPrepareChecks` |
| 鏉′欢妫€娴?| `postMappingCheck` 鈫?`normalizeMappingCheckData` | HTTP 杞鑷冲叚椤归綈鍏?|
| 寮€濮?/ 鏆傚仠 / 鎭㈠ / 鍋滄 / 鍒囨崲妯″紡 | `postStartMapping` 绛?| HTTP锛屽け璐?BLE 鍥為€€ |

### 鍓茶崏 WS / HTTP

| 鑳藉姏 | App 妯″潡 |
|------|----------|
| `NOTIFY_MOW_STATUS` | `useWsDeviceListener` 鈫?mowing FSM |
| `LOCATION_REGISTER` | `useLocationRegistration` 鈫?`wsSend`锛涙垚鍔熷悗 30s 鍐呮棤 `ROBOT_LOCATION` 鎵?WARN `location.register.no_robot_location` |
| `ROBOT_LOCATION` | `useWsDeviceListener` 鈫?`useRobotTrajectory` |
| 鍒涘缓 / Action / List | `useMowingCommands` / `mowingApi` |

### 鏈哄櫒鐘舵€?WS

| 鑳藉姏 | App 妯″潡 |
|------|----------|
| `NOTIFY_RATEL_STATUS` | `useWsDeviceListener` 鈫?`EventAdapter` 鈫?mapping/mowing FSM锛堝疄鐜板眰瀵瑰巻鍙?mock 鍒悕鐨勫吋瀹硅浠ｇ爜锛屼笉鍦ㄥ崗璁寖鍥达級 |

---

**鍘嗗彶鏂囨。**锛氭湰鏂囨。鍙栦唬 `robot_status_ws.md`銆乣mowing_api.md`銆乣mapbuilder_api.md`銆傛洿瀹屾暣鐨勯潪寤哄浘/鍓茶崏鎺ュ彛锛堝洖鍏呫€佸湴鍥惧垪琛ㄣ€侀仴鎺х瓑锛変粛瑙?`APP绔帴鍙ｆ枃妗?md`銆?

