import type { MappingActionErrorKind } from '../../sim/virtualRobot';

// mapping-v4-final-spec.md §0 #14: real HTTP status per error kind (404/409/422; 400 is the
// mock's own bucket for malformed input, see MappingActionErrorKind doc). Shared by
// `ratel_mapping_task/action` and `mapping/expansion` so the two stay in step.
export const MAPPING_ERROR_STATUS: Readonly<Record<MappingActionErrorKind, number>> = {
  bad_request: 400,
  not_found: 404,
  conflict: 409,
  unprocessable: 422,
};
