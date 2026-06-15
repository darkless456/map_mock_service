/**
 * Shared backend-world charging dock pose used by mock map/list and robot pose streams.
 * Coordinates are in BackendWorld (X right, Y down), matching map/list increments and
 * ROBOT_LOCATION payloads consumed by the app.
 */
export const CHARGING_DOCK_BACKEND_POINT = { x: 0, y: 0 } as const;
