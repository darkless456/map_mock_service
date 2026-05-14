// annotation-store.js — Per-map annotation packages served via REST API.
//
// Each entry is a full `IncrementPackage` (protocol format) keyed by `map_id`.
// Routes that use this module:
//   GET /api/annotations/:mapId  — returns the IncrementPackage for a given map.
//
// To add a new map's annotations, call `setAnnotationPackage(mapId, pkg)` at startup.

'use strict';

/** @type {Map<string, object>} */
const store = new Map();

// ── Seed: mock_map_001 ────────────────────────────────────────────────────────
//
// Three annotations that match the original MapRendererScreen MOCK_INCREMENT_PACKAGE:
//   251 – Forbidden zone (polygon, ~16 m × 8 m)
//   99  – Partition line  (line,    ~14 m long)
//   254 – Virtual wall   (rect,     ~2.5 m × 8.4 m)
store.set('mock_map_001', {
  map_id: 'mock_map_001',
  base_version: 1,
  timestamp: 1778314165808,
  unit: 'meter',
  increments: [
    {
      element_id: 'd2e7a38e-e7cb-476c-86d2-29dcdaab2a8b',
      type: 251, // 禁区
      action: 'add',
      shape: 'polygon',
      points: [
        { x: 6.463675213675216,  y: 16.94563152896486  },
        { x: 15.972222222222221, y: 15.972222222222221  },
        { x: 15.972222222222221, y: 9.027777777777779   },
        { x: 7.7932098765432105, y: 9.099002849002849   },
      ],
      properties: {},
    },
    {
      element_id: 'e125752d-4568-4425-8a02-2cf17160d36a',
      type: 99, // 分区线
      action: 'add',
      shape: 'line',
      points: [
        { x: 7.840693257359925,  y: 5.187559354226023  },
        { x: 21.266619183285847, y: 5.021367521367522   },
      ],
      properties: {},
    },
    {
      element_id: '92e86edc-bb72-4edf-a575-6b633febc2f3',
      type: 254, // 虚拟墙
      action: 'add',
      shape: 'rect',
      points: [
        { x: 3.1517094017094003, y: 6.457739791073125   },
        { x: 5.703941120607787,  y: 6.457739791073125   },
        { x: 5.703941120607787,  y: 14.814814814814815  },
        { x: 3.1517094017094003, y: 14.814814814814815  },
      ],
      properties: {},
    },
  ],
});

/**
 * Retrieve the IncrementPackage for a given map_id.
 * @param {string} mapId
 * @returns {object | undefined}
 */
function getAnnotationPackage(mapId) {
  return store.get(mapId);
}

/**
 * Register or replace the IncrementPackage for a map_id.
 * @param {string} mapId
 * @param {object} pkg  Full IncrementPackage object.
 */
function setAnnotationPackage(mapId, pkg) {
  store.set(mapId, pkg);
}

module.exports = { getAnnotationPackage, setAnnotationPackage };
