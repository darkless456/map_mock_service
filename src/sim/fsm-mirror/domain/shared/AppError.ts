/* eslint-disable */
// !!! LOCAL TYPE SHIM FOR MIRRORED MowingTask.ts. DO NOT IMPORT FROM SIMULATOR CODE. !!!
// The source mirror list intentionally does not copy mower/domain/shared/AppError.ts.

export interface AppError {
  readonly code: string;
  readonly message?: string;
  readonly kind?: string;
  readonly recoverable?: boolean;
}
