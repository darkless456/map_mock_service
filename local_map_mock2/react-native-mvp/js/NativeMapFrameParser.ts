import { TurboModule, TurboModuleRegistry } from 'react-native';

/**
 * Codegen (recommended): add to your app's `package.json`:
 *   "codegenConfig": { "name": "YourAppSpec", "type": "modules", "jsSrcsDir": "src/specs" }
 * and place this file under `src/specs/NativeMapFrameParser.ts`, then run `npx react-native codegen`.
 *
 * Native returns a plain object (sync). For non-blocking decode, schedule work on a native
 * thread and resolve a Promise on the JS thread using your RuntimeScheduler (see ARCHITECTURE.md).
 */
export interface Spec extends TurboModule {
  decodeIncrementFrame(frame: ArrayBuffer): {
    metaJson: string;
    width: number;
    height: number;
    rgba: ArrayBuffer;
  };
}

export default TurboModuleRegistry.getEnforcing<Spec>('MapFrameParser');
