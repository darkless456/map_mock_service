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
  "map_id": "mock_map_001",
  "base_version": 1,
  "timestamp": 1779247395760,
  "unit": "meter",
  "increments": [
    {
      "element_id": "864e6ed1-add3-4070-84ba-9e63053ab276",
      "type": 251,
      "shape": "rect",
      "points": [
        {
          "x": 7.082406624693581,
          "y": 10.127967876160502
        },
        {
          "x": 11.80295047971377,
          "y": 9.856281353411253
        },
        {
          "x": 12.06574135391247,
          "y": 14.422263625189194
        },
        {
          "x": 7.345197498892281,
          "y": 14.693950147938443
        }
      ],
      "properties": {}
    },
    {
      "element_id": "3af8ca02-4e74-450e-9234-86e33074c6aa",
      "type": 201,
      "shape": "polygon",
      "points": [
        {
          "x": 13.472582273130064,
          "y": 7.783616016529225
        },
        {
          "x": 15.081918702302154,
          "y": 8.999716779920792
        }
      ],
      "properties": {}
    },
    {
      "element_id": "0a2821f1-1390-459d-889b-dbe07e9b7ede",
      "type": 254,
      "shape": "line",
      "points": [
        {
          "x": 13.225205654568143,
          "y": 12.243492783440484
        },
        {
          "x": 16.79287552303738,
          "y": 14.918286980523003
        }
      ],
      "properties": {}
    }
  ]
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
