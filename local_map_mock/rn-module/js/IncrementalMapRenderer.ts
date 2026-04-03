/**
 * IncrementalMapRenderer.tsx
 *
 * Three.js / react-three-fiber based incremental map renderer for RN 0.82.
 *
 * Core idea:
 *  - Maintain a large "global map" FBO (FrameBuffer Object / RenderTarget).
 *  - Each incoming map fragment is converted to a DataTexture, then drawn
 *    (composited) onto the global FBO at the correct world position.
 *  - The main scene simply renders the global FBO texture on a fullscreen quad.
 *
 * This file demonstrates the key Three.js integration patterns.
 * Adapt for expo-gl / react-three-fiber as needed.
 */

import * as THREE from 'three';
import type { MapMetadata, DecodedMapFrame } from './useMapDecoder';

// ─── Configuration ────────────────────────────────────────────────────────
const GLOBAL_MAP_SIZE = 4096; // pixels, power-of-2 for GPU efficiency
const WORLD_EXTENT = 100;     // meters, the world-space extent mapped to the FBO

// ─── Global Map FBO Manager ───────────────────────────────────────────────
export class IncrementalMapRenderer {
  private renderer: THREE.WebGLRenderer;
  private globalTarget: THREE.WebGLRenderTarget;
  private compositeScene: THREE.Scene;
  private compositeCamera: THREE.OrthographicCamera;
  private fragmentMesh: THREE.Mesh;
  private fragmentMaterial: THREE.MeshBasicMaterial;

  // Reusable DataTexture to avoid GC pressure
  private fragmentTexture: THREE.DataTexture | null = null;

  constructor(renderer: THREE.WebGLRenderer) {
    this.renderer = renderer;

    // Create the accumulation FBO
    this.globalTarget = new THREE.WebGLRenderTarget(
      GLOBAL_MAP_SIZE,
      GLOBAL_MAP_SIZE,
      {
        minFilter: THREE.NearestFilter,
        magFilter: THREE.NearestFilter,
        format: THREE.RGBAFormat,
        type: THREE.UnsignedByteType,
        depthBuffer: false,
        stencilBuffer: false,
      }
    );

    // Orthographic camera mapping world coords → FBO UV space
    const halfExtent = WORLD_EXTENT / 2;
    this.compositeCamera = new THREE.OrthographicCamera(
      -halfExtent, halfExtent,   // left, right
       halfExtent, -halfExtent,  // top, bottom (Y-down for map convention)
      0.1, 10
    );
    this.compositeCamera.position.z = 1;

    // Scene for compositing fragments
    this.compositeScene = new THREE.Scene();

    // Reusable plane mesh for stamping fragments
    this.fragmentMaterial = new THREE.MeshBasicMaterial({
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    const planeGeo = new THREE.PlaneGeometry(1, 1);
    this.fragmentMesh = new THREE.Mesh(planeGeo, this.fragmentMaterial);
    this.compositeScene.add(this.fragmentMesh);
  }

  /**
   * Stamp a decoded map fragment onto the global FBO.
   *
   * @param frame - Output from C++ decodeMapFrame() JSI call
   */
  applyFragment(frame: DecodedMapFrame): void {
    const { metadata, rgbaBuffer } = frame;
    const { origin_x, origin_y, resolution, map_cols, map_rows } = metadata;

    // ─── 1. Create / update DataTexture from RGBA ArrayBuffer ─────
    const rgbaArray = new Uint8Array(rgbaBuffer);

    if (
      this.fragmentTexture &&
      this.fragmentTexture.image.width === map_cols &&
      this.fragmentTexture.image.height === map_rows
    ) {
      // Reuse existing texture, just update data (avoid allocation)
      (this.fragmentTexture.image.data as Uint8Array).set(rgbaArray);
      this.fragmentTexture.needsUpdate = true;
    } else {
      // Dispose old texture if dimensions changed
      if (this.fragmentTexture) {
        this.fragmentTexture.dispose();
      }
      this.fragmentTexture = new THREE.DataTexture(
        rgbaArray,
        map_cols,
        map_rows,
        THREE.RGBAFormat,
        THREE.UnsignedByteType
      );
      this.fragmentTexture.minFilter = THREE.NearestFilter;
      this.fragmentTexture.magFilter = THREE.NearestFilter;
      this.fragmentTexture.needsUpdate = true;
    }

    this.fragmentMaterial.map = this.fragmentTexture;
    this.fragmentMaterial.needsUpdate = true;

    // ─── 2. Compute world-space placement ─────────────────────────
    // The fragment covers map_cols * resolution meters wide,
    // map_rows * resolution meters tall, centered at (origin_x, origin_y).
    const widthMeters = map_cols * resolution;
    const heightMeters = map_rows * resolution;

    this.fragmentMesh.scale.set(widthMeters, heightMeters, 1);
    this.fragmentMesh.position.set(origin_x, origin_y, 0);

    // ─── 3. Render to FBO (additive compositing) ─────────────────
    // Save current render target
    const prevTarget = this.renderer.getRenderTarget();
    const prevAutoClear = this.renderer.autoClear;

    this.renderer.autoClear = false; // Do NOT clear — accumulate!
    this.renderer.setRenderTarget(this.globalTarget);
    this.renderer.render(this.compositeScene, this.compositeCamera);

    // Restore
    this.renderer.setRenderTarget(prevTarget);
    this.renderer.autoClear = prevAutoClear;
  }

  /**
   * Get the accumulated global map texture for rendering in the main scene.
   */
  getGlobalMapTexture(): THREE.Texture {
    return this.globalTarget.texture;
  }

  /**
   * Clean up GPU resources.
   */
  dispose(): void {
    this.globalTarget.dispose();
    this.fragmentMaterial.dispose();
    this.fragmentMesh.geometry.dispose();
    if (this.fragmentTexture) {
      this.fragmentTexture.dispose();
    }
  }
}

// ─── Usage Example (pseudo-code for RN + react-three-fiber) ──────────────
//
//   import { Canvas, useThree } from '@react-three/fiber/native';
//   import { IncrementalMapRenderer } from './IncrementalMapRenderer';
//
//   function MapScene() {
//     const { gl } = useThree();
//     const rendererRef = useRef<IncrementalMapRenderer>();
//
//     useEffect(() => {
//       rendererRef.current = new IncrementalMapRenderer(gl);
//       return () => rendererRef.current?.dispose();
//     }, [gl]);
//
//     // On MQTT message received:
//     const onMqttMessage = useCallback(async (binaryPayload: ArrayBuffer) => {
//       // C++ JSI decode: binary → { metadata, rgbaBuffer }
//       const frame = await decodeMapFrame(binaryPayload);
//       rendererRef.current?.applyFragment(frame);
//     }, []);
//
//     // Render the global map texture on a fullscreen quad
//     return (
//       <mesh>
//         <planeGeometry args={[100, 100]} />
//         <meshBasicMaterial
//           map={rendererRef.current?.getGlobalMapTexture()}
//         />
//       </mesh>
//     );
//   }
