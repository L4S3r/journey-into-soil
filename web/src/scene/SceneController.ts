import { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import { Engine } from "@babylonjs/core/Engines/engine";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { Matrix, Quaternion, Vector3, Vector4 } from "@babylonjs/core/Maths/math.vector";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { LinesMesh } from "@babylonjs/core/Meshes/linesMesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import "@babylonjs/core/Meshes/thinInstanceMesh";
import "@babylonjs/core/Culling/ray";
import { PointerEventTypes } from "@babylonjs/core/Events/pointerEvents";
import { Scene } from "@babylonjs/core/scene";
import type {
  AnalysisResult,
  CameraPreset,
  DiveStage,
  Layer,
  LayerInspectData,
  Quality,
  SceneTelemetry,
  Strategy,
  StrategyId,
} from "./types";

/**
 * Imperative scene API. React never touches Babylon objects: it only calls these methods.
 * Layout: a museum-grade cutaway monolith seen from -z. Layers are data-driven
 * (colour from texture + OM, darkness + sheen from simulated moisture, salt crystallization from ECe).
 * Roots grow with crop-specific morphology; canopy blades sway in field breezes.
 */

const W = 8; // block width (x)
const D = 4; // block depth (z)
const GAP = 0.65; // gap between layers when exploded
const LAYER_H = [1.3, 1.4, 1.6, 1.9]; // world height per layer

const TIERS: Record<Quality, { scale: number; blades: number; roots: number; outerCols: number; outerRows: number }> = {
  high: { scale: 1, blades: 768, roots: 24, outerCols: 36, outerRows: 28 },
  medium: { scale: 1.25, blades: 480, roots: 14, outerCols: 26, outerRows: 20 },
  low: { scale: 1.75, blades: 240, roots: 8, outerCols: 18, outerRows: 14 },
};

const TAPROOT_CROPS = new Set([
  "cotton",
  "sugar_beet",
  "sunflower",
  "faba",
  "lentil",
  "soybean",
  "cowpea",
  "peanut",
  "tomato",
  "potato",
  "pepper",
  "squash",
  "cucumber",
]);

const CROP_LOOK: Record<string, { h: number; c: [number, number, number] }> = {
  wheat: { h: 1.0, c: [0.62, 0.66, 0.22] },
  barley: { h: 0.9, c: [0.66, 0.66, 0.26] },
  maize: { h: 2.4, c: [0.28, 0.58, 0.2] },
  rice: { h: 1.3, c: [0.4, 0.68, 0.28] },
  sorghum: { h: 2.2, c: [0.5, 0.6, 0.22] },
  berseem: { h: 0.8, c: [0.2, 0.55, 0.25] },
  faba: { h: 1.2, c: [0.22, 0.5, 0.26] },
  lentil: { h: 0.7, c: [0.3, 0.55, 0.3] },
  peanut: { h: 0.6, c: [0.2, 0.5, 0.24] },
  soybean: { h: 1.0, c: [0.25, 0.55, 0.22] },
  cowpea: { h: 0.8, c: [0.24, 0.55, 0.28] },
  tomato: { h: 1.4, c: [0.24, 0.5, 0.2] },
  potato: { h: 0.9, c: [0.22, 0.48, 0.2] },
  pepper: { h: 1.0, c: [0.22, 0.5, 0.2] },
  squash: { h: 0.7, c: [0.26, 0.52, 0.22] },
  cucumber: { h: 0.8, c: [0.26, 0.54, 0.24] },
  onion: { h: 0.7, c: [0.32, 0.62, 0.3] },
  garlic: { h: 0.7, c: [0.34, 0.6, 0.3] },
  cotton: { h: 1.8, c: [0.28, 0.5, 0.2] },
  sugar_beet: { h: 0.9, c: [0.22, 0.52, 0.24] },
  spinach: { h: 0.5, c: [0.18, 0.5, 0.2] },
  sunflower: { h: 2.4, c: [0.36, 0.55, 0.16] },
};
const DEFAULT_LOOK = { h: 1.1, c: [0.3, 0.55, 0.25] as [number, number, number] };

const clamp = (x: number, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, x));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const LAYER_PALETTE = [
  Color3.FromHexString("#241911"), // Layer 0: Dark humus topsoil (0-20 cm)
  Color3.FromHexString("#45311f"), // Layer 1: Warm earthy subsoil (20-50 cm)
  Color3.FromHexString("#60291b"), // Layer 2: Reddish clay loam (50-90 cm)
  Color3.FromHexString("#5d5647"), // Layer 3: Mineral gravel substratum (90-150 cm)
];

function baseColor(layer: Layer, layerIdx: number): Color3 {
  const palette = LAYER_PALETTE[layerIdx] ?? LAYER_PALETTE[0];
  const omDark = 1 - Math.min(0.25, (layer.om ?? 1.5) * 0.05);
  return new Color3(palette.r * omDark, palette.g * omDark, palette.b * omDark);
}

export class SceneController {
  private engine: Engine;
  private scene: Scene;
  private camera: ArcRotateCamera;
  private sun: DirectionalLight;
  private ambient: HemisphericLight;
  private rimLight: DirectionalLight;
  private layerMeshes: Mesh[] = [];
  private layerMats: StandardMaterial[] = [];
  private saltMats: StandardMaterial[] = [];
  private saltPlanes: Mesh[] = [];
  private layerBase: Color3[] = [];
  private pedestalMesh: Mesh | null = null;
  private shadowMesh: Mesh | null = null;
  private rainMesh: Mesh | null = null;
  private dustMesh: Mesh | null = null;
  private fieldNode: TransformNode;
  private rootNode: TransformNode;
  private blade: Mesh | null = null;
  private outerBladeNorth: Mesh | null = null;
  private outerBladeSouth: Mesh | null = null;
  private bladeMat: StandardMaterial;
  private rootMat: StandardMaterial;
  private result: AnalysisResult | null = null;
  private strategy: Strategy | null = null;
  private dayIdx = 0;
  private currentCrop = "";
  private rootMaxCm = 100;
  private explode = 0;
  private targetExplode = 0;
  private tier: Quality = "high";
  private auto = true;
  private frames = 0;
  private theme: "light" | "dark" = "light";
  private disposed = false;
  private resizeObs: ResizeObserver | null = null;
  private time = 0;

  // Surrounding farmland terrain & parcel core reticle
  private fieldGroundNode: TransformNode | null = null;
  private frontGroundNode: TransformNode | null = null;
  private targetFrontGroundY = 0;
  private reticleMesh: LinesMesh | null = null;
  private topsoilCap: Mesh | null = null;
  private diveStage: DiveStage = "field";
  private diveTimeouts: ReturnType<typeof setTimeout>[] = [];

  clearDiveTimeouts(): void {
    this.diveTimeouts.forEach((t) => clearTimeout(t));
    this.diveTimeouts = [];
  }

  // Camera preset animation & target smoothing
  private targetCamAlpha = -Math.PI / 2;
  private targetCamBeta = 1.34;
  private targetCamRadius = 24;
  private targetCamTarget: Vector3 = new Vector3(0, 0.7, -2.5);
  private isAnimatingCam = false;

  // Inspection, Telemetry, Focus & Stage callbacks
  private onDay?: (day: number) => void;
  private onInspect?: (data: LayerInspectData | null) => void;
  private onTelemetry?: (data: SceneTelemetry) => void;
  private onStageChange?: (stage: DiveStage) => void;
  private onDiveProgress?: (captionKey: string | null, canSkip: boolean) => void;
  private onLayerFocusChange?: (idx: number | null) => void;
  private inspectedLayerIdx: number | null = null;
  private focusedLayerIdx: number | null = null;

  constructor(
    canvas: HTMLCanvasElement,
    onDay?: (day: number) => void,
  ) {
    this.onDay = onDay;
    this.engine = new Engine(canvas, true, { preserveDrawingBuffer: false, stencil: false }, true);
    this.scene = new Scene(this.engine);
    this.scene.clearColor = new Color4(0, 0, 0, 0);

    this.camera = new ArcRotateCamera("cam", -Math.PI / 2, 1.34, 24, new Vector3(0, 0.7, -2.5), this.scene);
    this.camera.lowerRadiusLimit = 5;
    this.camera.upperRadiusLimit = 36;
    this.camera.lowerBetaLimit = 0.15;
    this.camera.upperBetaLimit = 1.62;
    this.camera.wheelPrecision = 30;
    this.camera.panningSensibility = 0;
    this.camera.attachControl(canvas, true);

    // Three-point solar & studio lighting
    this.ambient = new HemisphericLight("amb", new Vector3(0, 1, -0.3), this.scene);
    this.ambient.intensity = 0.65;
    this.ambient.diffuse = new Color3(0.75, 0.85, 0.96);
    this.ambient.groundColor = new Color3(0.35, 0.28, 0.2);

    this.sun = new DirectionalLight("sun", new Vector3(-0.45, -1, 0.65), this.scene);
    this.sun.intensity = 0.95;
    this.sun.diffuse = new Color3(1.0, 0.96, 0.88);

    this.rimLight = new DirectionalLight("rim", new Vector3(0.3, 0.8, -1.0), this.scene);
    this.rimLight.intensity = 0.35;
    this.rimLight.diffuse = new Color3(0.85, 0.92, 1.0);

    this.fieldNode = new TransformNode("field", this.scene);
    this.rootNode = new TransformNode("roots", this.scene);
    this.bladeMat = new StandardMaterial("blade", this.scene);
    this.bladeMat.specularColor = new Color3(0.08, 0.12, 0.08);
    this.rootMat = new StandardMaterial("root", this.scene);
    this.rootMat.diffuseColor = new Color3(0.92, 0.88, 0.78);
    this.rootMat.emissiveColor = new Color3(0.06, 0.05, 0.04);
    this.rootMat.specularColor = new Color3(0.22, 0.20, 0.16);
    this.rootMat.specularPower = 36;

    this.buildLayers();
    this.buildPedestal();
    this.buildRainMesh();
    this.buildDustMesh();
    this.buildReticle();
    this.buildSurroundingField();
    this.positionLayers();
    this.updateFog();
    this.applyTier("high");

    const reduced = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) {
      this.explode = 1;
      this.targetExplode = 1;
      this.diveStage = "layers";
    }

    // Tap detection for layer inspection & focus (differentiates tap from orbit/drag, ignores roots/blades)
    this.scene.onPointerObservable.add((pointerInfo) => {
      if (pointerInfo.type === PointerEventTypes.POINTERTAP) {
        const pick = this.scene.pick(
          this.scene.pointerX,
          this.scene.pointerY,
          (mesh) => mesh.name.startsWith("layer")
        );
        if (pick && pick.hit && pick.pickedMesh) {
          const idx = parseInt(pick.pickedMesh.name.replace("layer", ""), 10);
          if (!isNaN(idx)) this.focusLayer(idx);
        }
      }
    });

    this.scene.onBeforeRenderObservable.add(() => this.tick(this.engine.getDeltaTime() / 1000));
    this.engine.runRenderLoop(() => {
      if (!this.disposed) this.scene.render();
    });
    this.resizeObs = new ResizeObserver(() => this.engine.resize());
    this.resizeObs.observe(canvas.parentElement ?? canvas);
  }

  // ------------------------------------------------------------------ public API
  setOnInspect(cb: (data: LayerInspectData | null) => void): void {
    this.onInspect = cb;
  }

  setOnTelemetry(cb: (data: SceneTelemetry) => void): void {
    this.onTelemetry = cb;
  }

  setOnStageChange(cb: (stage: DiveStage) => void): void {
    this.onStageChange = cb;
  }

  setOnLayerFocusChange(cb: (idx: number | null) => void): void {
    this.onLayerFocusChange = cb;
  }

  setOnDiveProgress(cb: (captionKey: string | null, canSkip: boolean) => void): void {
    this.onDiveProgress = cb;
  }

  setDiveStage(stage: DiveStage, fromAutoSequence = false): void {
    if (!fromAutoSequence) {
      this.clearDiveTimeouts();
      this.onDiveProgress?.(null, false);
    }
    this.diveStage = stage;
    this.isAnimatingCam = true;
    this.targetCamAlpha = -Math.PI / 2;

    if (stage === "field") {
      this.targetCamBeta = 1.34;
      this.targetCamRadius = 24;
      this.targetCamTarget = new Vector3(0, 0.7, -2.5);
      this.targetExplode = 0;
      this.targetFrontGroundY = 0;
      this.fieldGroundNode?.setEnabled(true);
      this.reticleMesh?.setEnabled(false);
      this.pedestalMesh?.setEnabled(false);
      this.shadowMesh?.setEnabled(false);
      this.dustMesh?.setEnabled(false);
    } else if (stage === "underground") {
      this.targetCamBeta = 1.25;
      this.targetCamRadius = 13.5;
      this.targetCamTarget = new Vector3(0, -3.1, 0);
      this.targetExplode = 0;
      this.targetFrontGroundY = -15;
      this.reticleMesh?.setEnabled(false);
      this.pedestalMesh?.setEnabled(true);
      this.shadowMesh?.setEnabled(true);
      this.dustMesh?.setEnabled(true);
    } else if (stage === "layers") {
      this.targetCamBeta = 1.28;
      this.targetCamRadius = 16.5;
      this.targetCamTarget = new Vector3(0, -4.0, 0);
      this.targetExplode = 1;
      this.targetFrontGroundY = -15;
      this.fieldGroundNode?.setEnabled(false);
      this.reticleMesh?.setEnabled(false);
      this.pedestalMesh?.setEnabled(true);
      this.shadowMesh?.setEnabled(true);
      this.dustMesh?.setEnabled(true);
    }

    this.updateFog();
    this.positionLayers();

    if (this.onStageChange) this.onStageChange(stage);
  }

  getDiveStage(): DiveStage {
    return this.diveStage;
  }

  replayDive(): void {
    const reduced = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) {
      this.setDiveStage("layers");
      this.onDiveProgress?.(null, false);
      return;
    }
    this.clearDiveTimeouts();
    this.setDiveStage("field", true);
    this.onDiveProgress?.("ui.dive_caption_field", true);

    this.diveTimeouts.push(
      setTimeout(() => {
        if (!this.disposed) {
          this.setDiveStage("underground", true);
          this.onDiveProgress?.("ui.dive_caption_underground", true);
        }
      }, 2800),
      setTimeout(() => {
        if (!this.disposed) {
          this.setDiveStage("layers", true);
          this.onDiveProgress?.("ui.dive_caption_layers", false);
        }
      }, 5400),
      setTimeout(() => {
        if (!this.disposed) {
          this.onDiveProgress?.(null, false);
        }
      }, 7600)
    );
  }

  skipDive(): void {
    this.clearDiveTimeouts();
    this.setDiveStage("layers");
    this.camera.beta = this.targetCamBeta;
    this.camera.radius = this.targetCamRadius;
    this.camera.target.copyFrom(this.targetCamTarget);
    this.explode = 1;
    this.targetExplode = 1;
    this.positionLayers();
    this.isAnimatingCam = false;
    this.onDiveProgress?.(null, false);
  }

  setCameraPreset(preset: CameraPreset): void {
    this.isAnimatingCam = true;
    this.targetCamAlpha = -Math.PI / 2;
    if (preset === "perspective") {
      this.setDiveStage("layers");
    } else if (preset === "cutaway") {
      this.setDiveStage("underground");
    } else if (preset === "canopy") {
      this.targetCamBeta = 0.22;
      this.targetCamRadius = 12.5;
      this.targetCamTarget = new Vector3(0, 0, 0);
    }
  }

  setExploded(exploded: boolean): void {
    this.targetExplode = exploded ? 1 : 0;
  }

  getExploded(): boolean {
    return this.targetExplode > 0.5;
  }

  focusLayer(idx: number | null): void {
    if (idx === null || idx < 0 || !this.result || idx >= this.result.layers.length) {
      this.clearFocus();
      return;
    }

    if (this.diveStage !== "layers") {
      this.setDiveStage("layers");
    }

    this.focusedLayerIdx = idx;
    this.isAnimatingCam = true;

    const isRtl = typeof document !== "undefined" && document.documentElement.dir === "rtl";
    const xSign = isRtl ? 1 : -1;
    const isDesktop = typeof window !== "undefined" && window.innerWidth >= 768;
    this.targetCamAlpha = isDesktop ? -Math.PI / 2 - xSign * 0.10 : -Math.PI / 2;
    this.targetCamBeta = 1.34;
    this.targetCamRadius = isDesktop ? 6.2 : 7.0;

    const box = this.layerMeshes[idx];
    const targetY = box ? box.position.y : -2.5;
    const targetX = isDesktop ? xSign * 1.35 : 0;
    this.targetCamTarget = new Vector3(targetX, targetY, 0);

    // Warm luminous highlight on the selected stratum; subtle darkening on others
    this.layerMats.forEach((mat, i) => {
      mat.emissiveColor = i === idx ? new Color3(0.42, 0.36, 0.22) : new Color3(0.015, 0.015, 0.015);
    });

    this.saltPlanes.forEach((_, i) => {
      const smat = this.saltMats[i];
      if (smat) {
        if (smat.metadata?.simAlpha === undefined) {
          smat.metadata = { ...(smat.metadata || {}), simAlpha: smat.alpha };
        }
        if (i === idx) {
          smat.alpha = Math.min(1.0, (smat.metadata?.simAlpha ?? 0.25) + 0.35);
        } else {
          smat.alpha = (smat.metadata?.simAlpha ?? 0.25) * 0.4;
        }
      }
    });

    this.inspectLayer(idx);
    this.onLayerFocusChange?.(idx);
  }

  clearFocus(): void {
    this.focusedLayerIdx = null;
    this.isAnimatingCam = true;
    this.targetCamAlpha = -Math.PI / 2;
    this.targetCamBeta = this.targetExplode > 0.5 ? 1.28 : 1.25;
    this.targetCamRadius = this.targetExplode > 0.5 ? 16.5 : 13.5;
    this.targetCamTarget = new Vector3(0, this.targetExplode > 0.5 ? -4.0 : -3.1, 0);

    this.layerMats.forEach((mat) => {
      mat.emissiveColor = Color3.Black();
    });

    this.saltPlanes.forEach((_, i) => {
      const smat = this.saltMats[i];
      if (smat && smat.metadata?.simAlpha !== undefined) {
        smat.alpha = smat.metadata.simAlpha;
      }
    });

    this.clearInspection();
    this.onLayerFocusChange?.(null);
  }

  getFocusedLayer(): number | null {
    return this.focusedLayerIdx;
  }

  inspectLayer(idx: number): void {
    if (!this.result || !this.strategy || idx < 0 || idx >= this.result.layers.length) {
      this.clearInspection();
      return;
    }
    this.inspectedLayerIdx = idx;
    const l = this.result.layers[idx];
    const sim = this.strategy.sim;
    const m = sim.moisture[idx]?.[this.dayIdx] ?? 0.5;
    const ece = sim.ece[idx]?.[this.dayIdx] ?? 0;

    // Available water share: 0 at wilting point, 1.0 (100%) at field capacity
    const availableWaterPct = Math.round(m * 100);
    const moistureStatus =
      m < 0.25 ? "dry" : m < 0.5 ? "stress" : m <= 1.05 ? "optimal" : "saturated";
    const salinityDsm = Number(ece.toFixed(1));
    const salinityStatus = ece < 2.0 ? "low" : ece < 4.0 ? "moderate" : "high";

    // Highlight selected layer mesh
    this.layerMats.forEach((mat, i) => {
      mat.emissiveColor =
        i === idx
          ? this.focusedLayerIdx === idx
            ? new Color3(0.42, 0.36, 0.22)
            : new Color3(0.18, 0.16, 0.12)
          : this.focusedLayerIdx !== null
            ? new Color3(0.015, 0.015, 0.015)
            : Color3.Black();
    });

    this.onInspect?.({
      layerIndex: idx,
      nameKey: l.name_key,
      topCm: l.top_cm,
      bottomCm: l.bottom_cm,
      sand: l.sand,
      silt: l.silt,
      clay: l.clay,
      availableWaterPct,
      moistureStatus,
      salinityDsm,
      salinityStatus,
      organicMatter: l.om,
    });
  }

  clearInspection(): void {
    this.inspectedLayerIdx = null;
    this.layerMats.forEach((mat) => {
      mat.emissiveColor = Color3.Black();
    });
    this.onInspect?.(null);
    if (this.focusedLayerIdx !== null) {
      this.focusedLayerIdx = null;
      this.onLayerFocusChange?.(null);
    }
  }

  loadResult(result: AnalysisResult, replay = true): void {
    this.result = result;
    this.rebuildLayersFromResult();
    this.dayIdx = Math.min(this.dayIdx, result.timeline.days - 1);
    this.setStrategy(this.strategy?.id ?? result.strategies.find((s) => s.id === "primary")?.id ?? result.strategies[0].id);
    if (replay) this.replay();
  }

  setStrategy(id: StrategyId): void {
    const s = this.result?.strategies.find((x) => x.id === id);
    if (!s) return;
    this.strategy = s;
    this.currentCrop = "?"; // force blades and roots rebuild
    this.applyDay(this.dayIdx);
  }

  setSeasonTime(t: number): void {
    if (!this.result) return;
    this.dayIdx = Math.round(clamp(t) * (this.result.timeline.days - 1));
    this.applyDay(this.dayIdx);
  }

  setQuality(q: Quality | "auto"): void {
    if (q === "auto") {
      this.auto = true;
      this.frames = 0;
      return;
    }
    this.auto = false;
    this.applyTier(q);
  }

  setTheme(theme: "light" | "dark"): void {
    this.theme = theme;
    this.updateFog();
    this.applyDay(this.dayIdx);
  }

  replay(): void {
    const reduced = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) {
      this.setDiveStage("layers");
      return;
    }
    this.replayDive();
  }

  getQuality(): Quality {
    return this.tier;
  }

  dispose(): void {
    this.disposed = true;
    this.clearDiveTimeouts();
    this.resizeObs?.disconnect();
    this.engine.stopRenderLoop();
    this.topsoilCap?.dispose();
    this.topsoilCap = null;
    this.scene.dispose();
    this.engine.dispose();
  }

  // ------------------------------------------------------------------ construction
  private createSaltTexture(seed: number): DynamicTexture {
    const size = 512;
    const salt = new DynamicTexture(`saltTex${seed}`, { width: size, height: size }, this.scene, true);
    const sctx = salt.getContext();
    sctx.clearRect(0, 0, size, size);
    const r = rng(seed);

    for (let i = 0; i < 900; i++) {
      const sx = r() * size;
      const sy = r() * size;
      const radius = 1.0 + r() * 3.0;
      const alpha = 0.45 + r() * 0.55;
      sctx.fillStyle = `rgba(255, 255, 255, ${alpha})`;
      sctx.beginPath();
      sctx.arc(sx, sy, radius, 0, Math.PI * 2);
      sctx.fill();
      if (r() < 0.28) {
        sctx.fillRect(sx - radius * 1.4, sy - 0.5, radius * 2.8, 1);
        sctx.fillRect(sx - 0.5, sy - radius * 1.4, 1, radius * 2.8);
      }
    }
    salt.hasAlpha = true;
    salt.update();
    return salt;
  }

  private buildLayers(): void {
    let top = 0;
    const uRepeat = 2.0;
    const faceUV = [
      new Vector4(0, 0, uRepeat, 1), // 0: back (+z)
      new Vector4(0, 0, uRepeat, 1), // 1: front (-z, cutaway)
      new Vector4(0, 0, 1, 1),       // 2: right (+x)
      new Vector4(0, 0, 1, 1),       // 3: left (-x)
      new Vector4(0, 0, uRepeat, 1), // 4: top (+y)
      new Vector4(0, 0, uRepeat, 1), // 5: bottom (-y)
    ];

    LAYER_H.forEach((h, i) => {
      const box = MeshBuilder.CreateBox(`layer${i}`, { width: W, height: h, depth: D, faceUV }, this.scene);
      const tex = new Texture(`/textures/soil/layer_${i}.jpg`, this.scene);
      tex.wrapU = Texture.MIRROR_ADDRESSMODE;
      tex.wrapV = Texture.CLAMP_ADDRESSMODE;

      const mat = new StandardMaterial(`layerMat${i}`, this.scene);
      mat.diffuseTexture = tex;
      mat.specularPower = 28;
      box.material = mat;

      const salt = this.createSaltTexture(11 + i);
      const plane = MeshBuilder.CreatePlane(`salt${i}`, { width: W, height: h }, this.scene);
      const smat = new StandardMaterial(`saltMat${i}`, this.scene);
      smat.diffuseTexture = salt;
      smat.useAlphaFromDiffuseTexture = true;
      smat.emissiveColor = new Color3(0.98, 0.98, 0.98);
      smat.specularColor = new Color3(0.8, 0.8, 0.8);
      smat.specularPower = 64;
      smat.alpha = 0;
      plane.material = smat;

      this.layerMeshes.push(box);
      this.layerMats.push(mat);
      this.saltPlanes.push(plane);
      this.saltMats.push(smat);
      this.layerBase.push(LAYER_PALETTE[i] || new Color3(0.45, 0.32, 0.2));
      box.metadata = { top, h };
      top += h;
    });
    this.positionLayers();
  }

  private buildPedestal(): void {
    const pedestal = MeshBuilder.CreateBox("pedestal", { width: W + 0.4, height: 0.25, depth: D + 0.4 }, this.scene);
    const pMat = new StandardMaterial("pedestalMat", this.scene);
    pMat.diffuseColor = new Color3(0.18, 0.17, 0.16);
    pMat.specularColor = new Color3(0.1, 0.1, 0.1);
    pedestal.material = pMat;
    this.pedestalMesh = pedestal;

    const shadowPlane = MeshBuilder.CreatePlane("groundShadow", { width: W + 2.4, height: D + 2.4 }, this.scene);
    shadowPlane.rotation.x = Math.PI / 2;
    const sMat = new StandardMaterial("groundShadowMat", this.scene);
    const sTex = new DynamicTexture("shadowTex", { width: 128, height: 128 }, this.scene, true);
    const sCtx = sTex.getContext();
    const grad = sCtx.createRadialGradient(64, 64, 12, 64, 64, 64);
    grad.addColorStop(0, "rgba(0, 0, 0, 0.55)");
    grad.addColorStop(0.65, "rgba(0, 0, 0, 0.2)");
    grad.addColorStop(1, "rgba(0, 0, 0, 0)");
    sCtx.fillStyle = grad;
    sCtx.fillRect(0, 0, 128, 128);
    sTex.hasAlpha = true;
    sTex.update();
    sMat.diffuseTexture = sTex;
    sMat.useAlphaFromDiffuseTexture = true;
    sMat.specularColor = Color3.Black();
    shadowPlane.material = sMat;
    this.shadowMesh = shadowPlane;
    this.positionLayers();
  }

  private buildRainMesh(): void {
    const n = 120;
    const r = rng(99);
    const buf = new Float32Array(n * 16);
    for (let i = 0; i < n; i++) {
      const x = (r() - 0.5) * (W + 1.2);
      const y = r() * 5.5;
      const z = (r() - 0.5) * (D + 1.2);
      Matrix.Compose(
        new Vector3(0.018, 0.38, 0.018),
        Quaternion.Identity(),
        new Vector3(x, y, z),
      ).copyToArray(buf, i * 16);
    }
    const drop = MeshBuilder.CreateCylinder("raindrop", { height: 1, diameter: 1, tessellation: 3 }, this.scene);
    const rMat = new StandardMaterial("rainMat", this.scene);
    rMat.diffuseColor = new Color3(0.65, 0.82, 0.96);
    rMat.emissiveColor = new Color3(0.5, 0.72, 0.92);
    rMat.alpha = 0.5;
    drop.material = rMat;
    drop.thinInstanceSetBuffer("matrix", buf, 16, true);
    drop.alwaysSelectAsActiveMesh = true;
    drop.setEnabled(false);
    this.rainMesh = drop;
  }

  private buildDustMesh(): void {
    const n = 140;
    const r = rng(42);
    const buf = new Float32Array(n * 16);
    for (let i = 0; i < n; i++) {
      const x = (r() - 0.5) * 16;
      const y = -r() * 10.5;
      const z = (r() - 0.5) * 10;
      const s = 0.025 + r() * 0.035;
      Matrix.Compose(
        new Vector3(s, s, s),
        Quaternion.Identity(),
        new Vector3(x, y, z),
      ).copyToArray(buf, i * 16);
    }
    const dot = MeshBuilder.CreateBox("dustDot", { size: 1 }, this.scene);
    const dMat = new StandardMaterial("dustMat", this.scene);
    dMat.emissiveColor = new Color3(0.95, 0.88, 0.72);
    dMat.diffuseColor = new Color3(0.8, 0.7, 0.5);
    dMat.alpha = 0.38;
    dot.material = dMat;
    dot.thinInstanceSetBuffer("matrix", buf, 16, true);
    dot.alwaysSelectAsActiveMesh = true;
    dot.setEnabled(false);
    this.dustMesh = dot;
  }

  private buildReticle(): void {
    const halfW = W / 2 + 0.04;
    const halfD = D / 2 + 0.04;
    const y = 0.02;
    const pts = [
      new Vector3(-halfW, y, -halfD),
      new Vector3(halfW, y, -halfD),
      new Vector3(halfW, y, halfD),
      new Vector3(-halfW, y, halfD),
      new Vector3(-halfW, y, -halfD),
    ];
    const reticle = MeshBuilder.CreateLines("coreReticle", { points: pts }, this.scene);
    reticle.color = new Color3(0.85, 0.72, 0.45);
    reticle.setEnabled(false);
    this.reticleMesh = reticle;
  }

  private buildSurroundingField(): void {
    this.fieldGroundNode = new TransformNode("surroundingField", this.scene);
    this.frontGroundNode = new TransformNode("frontGround", this.scene);
    this.frontGroundNode.parent = this.fieldGroundNode;

    const sMat = new StandardMaterial("surroundingFieldMat", this.scene);
    const sTex = new Texture("/textures/soil/layer_0.jpg", this.scene);
    sTex.uScale = 24.0;
    sTex.vScale = 24.0;
    sTex.wrapU = Texture.WRAP_ADDRESSMODE;
    sTex.wrapV = Texture.WRAP_ADDRESSMODE;
    sMat.diffuseTexture = sTex;
    sMat.diffuseColor = new Color3(0.42, 0.36, 0.28);
    sMat.specularColor = new Color3(0.04, 0.04, 0.03);
    sMat.specularPower = 16;

    const span = 48;
    const h = 8.0;
    const y = -h / 2;

    const north = MeshBuilder.CreateBox("fieldNorth", { width: W + 2 * span, height: h, depth: span }, this.scene);
    north.position.set(0, y, D / 2 + span / 2);
    north.material = sMat;
    north.parent = this.fieldGroundNode;

    const south = MeshBuilder.CreateBox("fieldSouth", { width: W + 2 * span, height: h, depth: span }, this.scene);
    south.position.set(0, y, -D / 2 - span / 2);
    south.material = sMat;
    south.parent = this.frontGroundNode;

    const east = MeshBuilder.CreateBox("fieldEast", { width: span, height: h, depth: D }, this.scene);
    east.position.set(W / 2 + span / 2, y, 0);
    east.material = sMat;
    east.parent = this.fieldGroundNode;

    const west = MeshBuilder.CreateBox("fieldWest", { width: span, height: h, depth: D }, this.scene);
    west.position.set(-W / 2 - span / 2, y, 0);
    west.material = sMat;
    west.parent = this.fieldGroundNode;

    // Seamless topsoil cap covering the central monolith surface in field stage
    if (this.layerMeshes[0]) {
      const topsoilCap = MeshBuilder.CreatePlane("topsoilCap", { width: W + 0.04, height: D + 0.04 }, this.scene);
      topsoilCap.rotation.x = Math.PI / 2;
      topsoilCap.position.set(0, LAYER_H[0] / 2 + 0.002, 0);
      topsoilCap.material = sMat;
      topsoilCap.parent = this.layerMeshes[0];
      this.topsoilCap = topsoilCap;
    }

    this.fieldGroundNode.setEnabled(true);
  }

  private updateFog(): void {
    if (this.diveStage === "field") {
      this.scene.fogMode = Scene.FOGMODE_EXP2;
      this.scene.fogDensity = 0.016;
      if (this.theme === "dark") {
        this.scene.fogColor = new Color3(0.16, 0.17, 0.20);
      } else {
        this.scene.fogColor = new Color3(0.85, 0.90, 0.93);
      }
    } else {
      this.scene.fogMode = Scene.FOGMODE_EXP2;
      this.scene.fogDensity = 0.006;
      this.scene.fogColor = this.theme === "dark"
        ? new Color3(0.06, 0.04, 0.03)
        : new Color3(0.12, 0.09, 0.06);
    }
  }

  private positionLayers(): void {
    const gap = GAP * this.explode;
    let top = 0;
    this.layerMeshes.forEach((box, i) => {
      const h = LAYER_H[i];
      const y = -(top + h / 2) - i * gap;
      box.position.set(0, y, 0);
      this.saltPlanes[i].position.set(0, y, -D / 2 - 0.02);
      top += h;
    });
    if (this.pedestalMesh) {
      const pedY = -(top + 3 * gap + 0.13);
      this.pedestalMesh.position.set(0, pedY, 0);
      if (this.shadowMesh) {
        this.shadowMesh.position.set(0, pedY - 0.14, 0);
      }
    }
    if (this.focusedLayerIdx !== null) {
      const box = this.layerMeshes[this.focusedLayerIdx];
      if (box) {
        const isRtl = typeof document !== "undefined" && document.documentElement.dir === "rtl";
        const xSign = isRtl ? 1 : -1;
        const isDesktop = typeof window !== "undefined" && window.innerWidth >= 768;
        this.targetCamTarget = new Vector3(isDesktop ? xSign * 1.35 : 0, box.position.y, 0);
      }
    }
  }

  private rebuildLayersFromResult(): void {
    if (!this.result) return;
    this.result.layers.forEach((l, i) => {
      this.layerBase[i] = baseColor(l, i);
    });
  }

  private cmToY(cm: number): number {
    const layers = this.result?.layers ?? [];
    let top = 0;
    for (let i = 0; i < LAYER_H.length; i++) {
      const l = layers[i];
      const span = l ? l.bottom_cm - l.top_cm : [20, 30, 40, 60][i];
      const start = l ? l.top_cm : [0, 20, 50, 90][i];
      if (cm <= start + span || i === LAYER_H.length - 1) {
        const frac = clamp((cm - start) / span);
        return -(top + frac * LAYER_H[i] + i * GAP * this.explode);
      }
      top += LAYER_H[i];
    }
    return -top;
  }

  private applyTier(q: Quality): void {
    this.tier = q;
    this.engine.setHardwareScalingLevel(TIERS[q].scale);
    this.currentCrop = "?";
    if (this.strategy) this.applyDay(this.dayIdx);
  }

  private currentCropId(): string | null {
    if (!this.strategy) return null;
    const list = this.strategy.seasons.filter((s) => s.crop);
    const idx = this.strategy.sim.crop_idx[this.dayIdx];
    return idx >= 0 && list[idx] ? (list[idx].crop as string) : null;
  }

  private buildBlades(cropId: string): void {
    this.blade?.dispose();
    this.blade = null;
    this.outerBladeNorth?.dispose();
    this.outerBladeNorth = null;
    this.outerBladeSouth?.dispose();
    this.outerBladeSouth = null;
    if (!cropId) return;
    const look = CROP_LOOK[cropId] ?? DEFAULT_LOOK;
    this.bladeMat.diffuseColor = new Color3(...look.c);
    this.bladeMat.specularColor = new Color3(0.08, 0.12, 0.08);

    // Rich botanical wheat/crop tuft:
    // 1. Central stem
    const stem = MeshBuilder.CreateCylinder("stem", { height: 1.15, diameterTop: 0.035, diameterBottom: 0.065, tessellation: 5 }, this.scene);
    stem.bakeTransformIntoVertices(Matrix.Compose(new Vector3(1, 1, 1), Quaternion.FromEulerAngles(0.04, 0, 0), new Vector3(0, 0.575, 0)));

    // 2. Grain Ear / Spikelet head at the top
    const ear = MeshBuilder.CreateCylinder("ear", { height: 0.38, diameterTop: 0.045, diameterBottom: 0.095, tessellation: 6 }, this.scene);
    ear.bakeTransformIntoVertices(Matrix.Compose(new Vector3(1.3, 1, 1.3), Quaternion.FromEulerAngles(0.08, 0.4, 0), new Vector3(0.015, 1.05, 0)));

    // 3-8. Broad curved leaves arching outward in 6 compass directions (flattened for wide blade profile)
    const leafGeom = (h: number, rotY: number, lean: number, yOffset: number) => {
      const l = MeshBuilder.CreateCylinder("l", { height: h, diameterTop: 0, diameterBottom: 0.08, tessellation: 4 }, this.scene);
      l.bakeTransformIntoVertices(
        Matrix.Compose(
          new Vector3(2.4, 1.0, 0.45),
          Quaternion.FromEulerAngles(lean, rotY, (lean * 0.3)),
          new Vector3(Math.sin(rotY) * 0.06, yOffset, Math.cos(rotY) * 0.06)
        )
      );
      return l;
    };

    const l1 = leafGeom(0.92, 0.35, 0.36, 0.46);
    const l2 = leafGeom(0.88, 1.40, 0.38, 0.44);
    const l3 = leafGeom(0.94, 2.45, 0.34, 0.48);
    const l4 = leafGeom(0.86, 3.50, 0.38, 0.43);
    const l5 = leafGeom(0.90, 4.55, 0.35, 0.45);
    const l6 = leafGeom(0.84, 5.60, 0.40, 0.42);

    // 9-10. Low basal spreading ground blades (dense understory to conceal soil gaps)
    const b1 = leafGeom(0.58, 0.90, 0.56, 0.28);
    const b2 = leafGeom(0.54, 3.90, 0.58, 0.26);

    const tuft = Mesh.MergeMeshes([stem, ear, l1, l2, l3, l4, l5, l6, b1, b2], true, true, undefined, false, true);
    if (!tuft) return;
    tuft.name = "blade";
    tuft.material = this.bladeMat;
    tuft.parent = this.fieldNode;

    const r = rng(7);
    const tierConfig = TIERS[this.tier];

    // 1. Central Soil Monolith Canopy (dense multi-row planting)
    const coreRows = 24;
    const coreCols = Math.max(20, Math.round(tierConfig.blades / coreRows));
    const coreTotal = coreRows * coreCols;
    const coreBuf = new Float32Array(coreTotal * 16);
    let cIdx = 0;
    for (let row = 0; row < coreRows; row++) {
      const z0 = ((row + 0.5) / coreRows - 0.5) * (D - 0.18);
      for (let col = 0; col < coreCols; col++) {
        const x0 = ((col + 0.5) / coreCols - 0.5) * (W - 0.18);
        const x = x0 + (r() - 0.5) * 0.08;
        const z = z0 + (r() - 0.5) * 0.06;
        const h = 0.85 + r() * 0.45;
        const rotY = r() * Math.PI * 2;
        const lean = (r() - 0.5) * 0.22;

        Matrix.Compose(
          new Vector3(1, h, 1),
          Quaternion.FromEulerAngles(lean, rotY, (r() - 0.5) * 0.18),
          new Vector3(x, 0, z),
        ).copyToArray(coreBuf, cIdx * 16);
        cIdx++;
      }
    }
    tuft.thinInstanceSetBuffer("matrix", coreBuf, 16, true);
    tuft.alwaysSelectAsActiveMesh = true;
    this.blade = tuft;

    // 2. Surrounding North Farmland Rows & Flanks (parented to fieldGroundNode)
    if (this.fieldGroundNode) {
      const tuftNorth = tuft.clone("bladeNorth");
      if (tuftNorth) {
        tuftNorth.material = this.bladeMat;
        tuftNorth.parent = this.fieldGroundNode;

        const nCols = tierConfig.outerCols;
        const nRows = tierConfig.outerRows;
        const flankCols: number[] = [];
        for (let c = 0; c < nCols; c++) {
          const x0 = ((c + 0.5) / nCols - 0.5) * 44;
          if (Math.abs(x0) > W / 2 + 0.35) {
            flankCols.push(x0);
          }
        }
        const flankSteps = 6;
        const northTotal = nCols * nRows + flankCols.length * flankSteps;
        const northBuf = new Float32Array(northTotal * 16);
        let nIdx = 0;

        for (let c = 0; c < nCols; c++) {
          const x0 = ((c + 0.5) / nCols - 0.5) * 44;
          for (let rStep = 0; rStep < nRows; rStep++) {
            const z0 = D / 2 + 0.25 + (rStep / (nRows - 1)) * 22.0;
            const x = x0 + (r() - 0.5) * 0.22;
            const z = z0 + (r() - 0.5) * 0.18;
            const h = 0.80 + r() * 0.50;
            const rotY = r() * Math.PI * 2;
            const lean = (r() - 0.5) * 0.20;

            Matrix.Compose(
              new Vector3(1, h, 1),
              Quaternion.FromEulerAngles(lean, rotY, (r() - 0.5) * 0.18),
              new Vector3(x, 0, z),
            ).copyToArray(northBuf, nIdx * 16);
            nIdx++;
          }
        }

        // Add flank instances flanking the monolith
        for (const x0 of flankCols) {
          for (let fStep = 0; fStep < flankSteps; fStep++) {
            const z0 = -D / 2 + 0.3 + (fStep / (flankSteps - 1)) * (D - 0.6);
            const x = x0 + (r() - 0.5) * 0.22;
            const z = z0 + (r() - 0.5) * 0.18;
            const h = 0.80 + r() * 0.50;
            const rotY = r() * Math.PI * 2;
            const lean = (r() - 0.5) * 0.20;

            Matrix.Compose(
              new Vector3(1, h, 1),
              Quaternion.FromEulerAngles(lean, rotY, (r() - 0.5) * 0.18),
              new Vector3(x, 0, z),
            ).copyToArray(northBuf, nIdx * 16);
            nIdx++;
          }
        }

        tuftNorth.thinInstanceSetBuffer("matrix", northBuf, 16, true);
        tuftNorth.alwaysSelectAsActiveMesh = true;
        this.outerBladeNorth = tuftNorth;
      }
    }

    // 3. Surrounding South/Foreground Farmland Rows (parented to frontGroundNode for diving animation)
    if (this.frontGroundNode) {
      const tuftSouth = tuft.clone("bladeSouth");
      if (tuftSouth) {
        tuftSouth.material = this.bladeMat;
        tuftSouth.parent = this.frontGroundNode;

        const sCols = tierConfig.outerCols;
        const sRows = tierConfig.outerRows;
        const southTotal = sCols * sRows;
        const southBuf = new Float32Array(southTotal * 16);
        let sIdx = 0;
        for (let c = 0; c < sCols; c++) {
          const x0 = ((c + 0.5) / sCols - 0.5) * 44;
          for (let rStep = 0; rStep < sRows; rStep++) {
            const z0 = -D / 2 - 0.25 - (rStep / (sRows - 1)) * 22.0;
            const x = x0 + (r() - 0.5) * 0.22;
            const z = z0 + (r() - 0.5) * 0.18;
            const h = 0.80 + r() * 0.50;
            const rotY = r() * Math.PI * 2;
            const lean = (r() - 0.5) * 0.20;

            Matrix.Compose(
              new Vector3(1, h, 1),
              Quaternion.FromEulerAngles(lean, rotY, (r() - 0.5) * 0.18),
              new Vector3(x, 0, z),
            ).copyToArray(southBuf, sIdx * 16);
            sIdx++;
          }
        }
        tuftSouth.thinInstanceSetBuffer("matrix", southBuf, 16, true);
        tuftSouth.alwaysSelectAsActiveMesh = true;
        this.outerBladeSouth = tuftSouth;
      }
    }
  }

  private isTaproot(cropId: string): boolean {
    return TAPROOT_CROPS.has(cropId);
  }

  private buildRoots(cropId: string, maxCm: number): void {
    this.rootNode.getChildMeshes().forEach((m) => m.dispose());
    if (!cropId) return;

    const isTap = this.isTaproot(cropId);
    const count = TIERS[this.tier].roots;
    const maxY = this.cmToY(maxCm);
    const zCut = -D / 2 - 0.005; // flush with cutaway face, zero hovering gap
    const r = rng(cropId.length * 131 + maxCm);

    if (isTap) {
      // Taproot architecture: primary tapering taproot with lateral secondaries and legume nodules
      const primaryCount = Math.max(4, Math.floor(count * 0.45));
      for (let i = 0; i < primaryCount; i++) {
        const x0 = ((i + 0.5) / primaryCount - 0.5) * (W - 1.2) + (r() - 0.5) * 0.2;
        const depth = maxY * (0.82 + r() * 0.18);
        const pts: Vector3[] = [];
        const steps = 22;
        let x = x0;
        const seedVal = i * 19.3 + maxCm;

        for (let s = 0; s <= steps; s++) {
          const frac = s / steps;
          const y = frac * depth; // starts at y = 0, descends to negative depth
          const meander = Math.sin(s * 0.85 + seedVal) * 0.035 * (1 - frac * 0.4);
          x += meander + (r() - 0.5) * 0.012;
          pts.push(new Vector3(x, y, zCut));
        }

        const tap = MeshBuilder.CreateTube(
          `taproot${i}`,
          {
            path: pts,
            radiusFunction: (index) => {
              const frac = index / steps;
              return 0.046 * (1 - frac * 0.72) + 0.012; // smooth taper
            },
            tessellation: 6,
            cap: Mesh.CAP_ALL,
          },
          this.scene,
        );
        tap.material = this.rootMat;
        tap.parent = this.rootNode;

        // Lateral secondary branches
        const branchCount = 3 + Math.floor(r() * 3);
        for (let b = 0; b < branchCount; b++) {
          const fromStep = 3 + Math.floor(r() * 11);
          const from = pts[fromStep] ?? pts[0];
          const dir = (b % 2 === 0 ? 1 : -1) * (0.65 + r() * 0.45);
          const bdepth = from.y + (depth - from.y) * 0.32 * (0.6 + r() * 0.4);
          const bp: Vector3[] = [];
          const bsteps = 10;
          let bx = from.x;
          for (let s = 0; s <= bsteps; s++) {
            const bfrac = s / bsteps;
            bx += dir * 0.035 * Math.sin(bfrac * Math.PI * 0.5);
            bp.push(new Vector3(bx, from.y + (bdepth - from.y) * bfrac, zCut - 0.002));
          }
          const bt = MeshBuilder.CreateTube(
            `tapbranch${i}_${b}`,
            {
              path: bp,
              radiusFunction: (index) => {
                const bfrac = index / bsteps;
                return 0.020 * (1 - bfrac * 0.65) + 0.007;
              },
              tessellation: 4,
              cap: Mesh.CAP_ALL,
            },
            this.scene,
          );
          bt.material = this.rootMat;
          bt.parent = this.rootNode;
        }

        // Legume root nodules in the topsoil horizon
        const isLegume = ["lentil", "berseem_clover", "faba_bean", "peanuts", "cowpea", "faba", "soybean"].includes(cropId);
        if (isLegume) {
          const noduleCount = 3 + Math.floor(r() * 4);
          for (let nd = 0; nd < noduleCount; nd++) {
            const nStep = 2 + Math.floor(r() * 8);
            const pNode = pts[nStep] ?? pts[0];
            const nodule = MeshBuilder.CreateSphere(
              `nodule_${i}_${nd}`,
              {
                diameterX: 0.045 + r() * 0.02,
                diameterY: 0.035 + r() * 0.015,
                diameterZ: 0.03 + r() * 0.015,
                segments: 4,
              },
              this.scene,
            );
            const offsetDir = (nd % 2 === 0 ? 1 : -1) * (0.025 + r() * 0.015);
            nodule.position.set(pNode.x + offsetDir, pNode.y + (r() - 0.5) * 0.03, zCut);
            nodule.material = this.rootMat;
            nodule.parent = this.rootNode;
          }
        }
      }
    } else {
      // Fibrous crown root system: dense lateral spreading network
      const plantCount = Math.max(5, Math.floor(count * 0.42));
      for (let p = 0; p < plantCount; p++) {
        const x0 = ((p + 0.5) / plantCount - 0.5) * (W - 1.2) + (r() - 0.5) * 0.2;
        const rootsPerPlant = 5;
        for (let rIdx = 0; rIdx < rootsPerPlant; rIdx++) {
          const spread = (rIdx / (rootsPerPlant - 1) - 0.5) * 0.55 + (r() - 0.5) * 0.12;
          const depthFrac = 0.55 + (1 - Math.abs(spread)) * 0.45;
          const depth = maxY * depthFrac;
          const pts: Vector3[] = [];
          const steps = 18;
          let currX = x0;
          for (let s = 0; s <= steps; s++) {
            const frac = s / steps;
            const y = frac * depth;
            currX = x0 + spread * Math.pow(frac, 0.75) * 1.1 + Math.sin(s * 0.9 + p * 3) * 0.03;
            pts.push(new Vector3(currX, y, zCut));
          }
          const fibrous = MeshBuilder.CreateTube(
            `fibroot_${p}_${rIdx}`,
            {
              path: pts,
              radiusFunction: (index) => {
                const frac = index / steps;
                return 0.034 * (1 - frac * 0.70) + 0.009;
              },
              tessellation: 5,
              cap: Mesh.CAP_ALL,
            },
            this.scene,
          );
          fibrous.material = this.rootMat;
          fibrous.parent = this.rootNode;
        }
      }
    }
  }

  // ------------------------------------------------------------------ per-frame updates
  private tick(dt: number): void {
    this.time += dt;

    // Root visibility based on dive stage
    if (this.rootNode) {
      const showRoots = this.diveStage !== "field" || this.camera.beta < 1.0;
      if (this.rootNode.isEnabled() !== showRoots) {
        this.rootNode.setEnabled(showRoots);
      }
    }

    // Front ground parting animation when diving underground
    if (this.frontGroundNode) {
      this.frontGroundNode.position.y = lerp(
        this.frontGroundNode.position.y,
        this.targetFrontGroundY,
        Math.min(1, dt * 3.0)
      );
      if (this.diveStage !== "field" && this.frontGroundNode.position.y < -13.5) {
        this.fieldGroundNode?.setEnabled(false);
      }
    }

    // Camera preset animation & target lerp
    if (this.isAnimatingCam) {
      const k = Math.min(1, dt * 4.8);
      this.camera.alpha = lerp(this.camera.alpha, this.targetCamAlpha, k);
      this.camera.beta = lerp(this.camera.beta, this.targetCamBeta, k);
      this.camera.radius = lerp(this.camera.radius, this.targetCamRadius, k);
      this.camera.target.x = lerp(this.camera.target.x, this.targetCamTarget.x, k);
      this.camera.target.y = lerp(this.camera.target.y, this.targetCamTarget.y, k);
      this.camera.target.z = lerp(this.camera.target.z, this.targetCamTarget.z, k);
      if (
        Math.abs(this.camera.radius - this.targetCamRadius) < 0.05 &&
        Math.abs(this.camera.beta - this.targetCamBeta) < 0.01 &&
        Vector3.Distance(this.camera.target, this.targetCamTarget) < 0.05
      ) {
        this.isAnimatingCam = false;
      }
    }

    // Reticle pulse on agricultural ground if active
    if (this.reticleMesh && this.reticleMesh.isEnabled()) {
      const pulse = 0.65 + 0.35 * Math.sin(this.time * 3.5);
      this.reticleMesh.color = new Color3(0.85 * pulse, 0.72 * pulse, 0.45 * pulse);
    }

    // Explode smoothing
    if (Math.abs(this.explode - this.targetExplode) > 0.005) {
      this.explode = lerp(this.explode, this.targetExplode, Math.min(1, dt * 6));
      this.positionLayers();
    }

    // Multi-frequency wind breeze
    const breeze = Math.sin(this.time * 2.2) * 0.012 + Math.cos(this.time * 1.1) * 0.006;
    this.fieldNode.rotation.z = breeze;
    if (this.outerBladeNorth) this.outerBladeNorth.rotation.z = breeze;
    if (this.outerBladeSouth) this.outerBladeSouth.rotation.z = breeze;

    // Falling rain streaks
    if (this.rainMesh && this.rainMesh.isEnabled()) {
      this.rainMesh.position.y -= dt * 8.5;
      if (this.rainMesh.position.y < -3.2) {
        this.rainMesh.position.y = 0;
      }
    }

    // Floating subterranean dust particles
    if (this.dustMesh && this.dustMesh.isEnabled()) {
      this.dustMesh.position.y += dt * 0.12;
      if (this.dustMesh.position.y > 2.5) {
        this.dustMesh.position.y = -0.5;
      }
    }

    if (this.auto && ++this.frames === 150) {
      const fps = this.engine.getFps();
      if (fps < 28 && this.tier !== "low") this.applyTier(this.tier === "high" ? "medium" : "low");
      this.frames = 0;
    }
  }

  private applyDay(day: number): void {
    const s = this.strategy;
    const res = this.result;
    if (!s || !res) return;
    const sim = s.sim;

    // Soil moisture & salinity visuals
    for (let i = 0; i < this.layerMats.length; i++) {
      const m = sim.moisture[i]?.[day] ?? 0.5;
      const wet = clamp(m / 1.1);
      const k = 1 - 0.42 * wet;
      this.layerMats[i].diffuseColor = new Color3(k, k, k);

      // Specular sheen on damp soil
      const wetSheen = 0.04 + 0.32 * Math.pow(wet, 2);
      this.layerMats[i].specularColor = new Color3(wetSheen, wetSheen, wetSheen);
      this.layerMats[i].specularPower = lerp(16, 64, wet);

      const ece = sim.ece[i]?.[day] ?? 0;
      const baseAlpha = clamp((ece - 2.0) / 10, 0, 0.9);
      this.saltMats[i].metadata = { ...(this.saltMats[i].metadata || {}), simAlpha: baseAlpha };
      if (this.focusedLayerIdx !== null) {
        this.saltMats[i].alpha = i === this.focusedLayerIdx ? Math.min(1.0, baseAlpha + 0.35) : baseAlpha * 0.4;
      } else {
        this.saltMats[i].alpha = baseAlpha;
      }
    }

    // Crop lifecycle & root updates
    const cropId = this.currentCropId();
    if (cropId !== (this.currentCrop || null)) {
      const rootMax = cropId ? Math.max(...sim.root_cm.filter((_, d) => sim.crop_idx[d] === sim.crop_idx[day])) : 0;
      this.currentCrop = cropId ?? "";
      this.rootMaxCm = rootMax || 30;
      this.buildBlades(cropId ?? "");
      this.buildRoots(cropId ?? "", this.rootMaxCm);
    }
    const root = sim.root_cm[day] ?? 0;
    this.rootNode.scaling.y = cropId ? clamp(root / this.rootMaxCm, 0.02, 1) : 0.001;
    const look = cropId ? (CROP_LOOK[cropId] ?? DEFAULT_LOOK) : DEFAULT_LOOK;
    const canopyPct = sim.canopy[day] ?? 0.2;
    const canopyH = Math.max(0.42, canopyPct * look.h * 1.3);
    this.fieldNode.scaling.y = cropId ? canopyH : 0.001;
    if (this.outerBladeNorth) this.outerBladeNorth.scaling.y = cropId ? canopyH : 0.001;
    if (this.outerBladeSouth) this.outerBladeSouth.scaling.y = cropId ? canopyH : 0.001;

    // Root stress coloration (natural ivory tissue responding to soil stress)
    const cropIdx = sim.crop_idx[day];
    const ws = cropIdx >= 0 ? s.seasons[cropIdx]?.indicators?.water_stress ?? 0 : 0;
    const ss = cropIdx >= 0 ? s.seasons[cropIdx]?.indicators?.salinity_stress ?? 0 : 0;
    const stress = clamp(Math.max(ws, ss));
    const rootR = lerp(0.92, 0.82, stress);
    const rootG = lerp(0.88, 0.58, stress);
    const rootB = lerp(0.78, 0.35, stress);
    this.rootMat.diffuseColor = new Color3(rootR, rootG, rootB);
    this.rootMat.emissiveColor = new Color3(0.06, 0.05, 0.04);

    // Weather ambiance
    const tmax = res.climate.tmax[day] ?? 28;
    const rain = res.climate.rain[day] ?? 0;
    this.sun.intensity = (this.theme === "dark" ? 0.55 : 0.95) * (rain > 1 ? 0.65 : 1);

    if (this.rainMesh) {
      this.rainMesh.setEnabled(rain > 2.0 && this.tier !== "low");
    }

    // Keep inspected layer updated live with daily simulation data
    if (this.inspectedLayerIdx !== null) {
      this.inspectLayer(this.inspectedLayerIdx);
    }

    // Emit live telemetry
    if (this.onTelemetry) {
      const activeSeason = cropIdx >= 0 ? s.seasons[cropIdx]?.season ?? null : null;
      const date = res.climate.dates[day] ?? "";
      this.onTelemetry({
        cropId,
        season: activeSeason,
        rootCm: Math.round(root),
        canopyPct: Math.round((sim.canopy[day] ?? 0) * 100),
        et0Mm: Number((res.climate.et0[day] ?? 0).toFixed(1)),
        rainMm: Number(rain.toFixed(1)),
        tempC: Math.round(tmax),
        date,
        isSynthetic: res.climate.source === "synthetic",
      });
    }

    this.onDay?.(day);
  }
}
