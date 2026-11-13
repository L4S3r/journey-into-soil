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
const GAP = 0.22; // gap between layers when exploded
const LAYER_H = [1.3, 1.4, 1.6, 1.9]; // world height per layer

const TIERS: Record<Quality, { scale: number; blades: number; roots: number }> = {
  high: { scale: 1, blades: 1400, roots: 20 },
  medium: { scale: 1.25, blades: 600, roots: 12 },
  low: { scale: 1.75, blades: 220, roots: 7 },
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
const smooth = (x: number) => {
  const t = clamp(x);
  return t * t * (3 - 2 * t);
};

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
  private fieldNode: TransformNode;
  private rootNode: TransformNode;
  private blade: Mesh | null = null;
  private bladeMat: StandardMaterial;
  private rootMat: StandardMaterial;
  private result: AnalysisResult | null = null;
  private strategy: Strategy | null = null;
  private dayIdx = 0;
  private currentCrop = "";
  private rootMaxCm = 100;
  private explode = 0;
  private targetExplode = 0;
  private isExplodedManual = false;
  private introT = 1;
  private tier: Quality = "high";
  private auto = true;
  private frames = 0;
  private theme: "light" | "dark" = "light";
  private disposed = false;
  private resizeObs: ResizeObserver | null = null;
  private time = 0;

  // Surrounding farmland terrain & parcel core reticle
  private fieldGroundNode: TransformNode | null = null;
  private reticleMesh: LinesMesh | null = null;
  private diveStage: DiveStage = "layers";
  private diveTimeouts: ReturnType<typeof setTimeout>[] = [];

  private clearDiveTimeouts(): void {
    this.diveTimeouts.forEach((t) => clearTimeout(t));
    this.diveTimeouts = [];
  }

  // Camera preset animation & target smoothing
  private targetCamAlpha = -Math.PI / 2;
  private targetCamBeta = 1.25;
  private targetCamRadius = 14;
  private targetCamTarget: Vector3 = new Vector3(0, -3.2, 0);
  private isAnimatingCam = false;

  // Inspection, Telemetry & Stage callbacks
  private onDay?: (day: number) => void;
  private onInspect?: (data: LayerInspectData | null) => void;
  private onTelemetry?: (data: SceneTelemetry) => void;
  private onStageChange?: (stage: DiveStage) => void;
  private inspectedLayerIdx: number | null = null;

  constructor(
    canvas: HTMLCanvasElement,
    onDay?: (day: number) => void,
  ) {
    this.onDay = onDay;
    this.engine = new Engine(canvas, true, { preserveDrawingBuffer: false, stencil: false }, true);
    this.scene = new Scene(this.engine);
    this.scene.clearColor = new Color4(0.62, 0.78, 0.92, 1);

    this.camera = new ArcRotateCamera("cam", -Math.PI / 2, 1.25, 22, new Vector3(0, -2.6, 0), this.scene);
    this.camera.lowerRadiusLimit = 6;
    this.camera.upperRadiusLimit = 32;
    this.camera.lowerBetaLimit = 0.15;
    this.camera.upperBetaLimit = 1.75;
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
    this.bladeMat.specularColor = Color3.Black();
    this.rootMat = new StandardMaterial("root", this.scene);
    this.rootMat.emissiveColor = new Color3(0.95, 0.92, 0.84);
    this.rootMat.diffuseColor = Color3.Black();

    this.buildLayers();
    this.buildPedestal();
    this.buildRainMesh();
    this.buildReticle();
    this.buildSurroundingField();
    this.applyTier("high");

    const reduced = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) {
      this.explode = 0;
      this.targetExplode = 0;
      this.introT = 1;
    }

    // Tap detection for layer inspection (differentiates tap from orbit/drag, ignores roots/blades)
    this.scene.onPointerObservable.add((pointerInfo) => {
      if (pointerInfo.type === PointerEventTypes.POINTERTAP) {
        const pick = this.scene.pick(
          this.scene.pointerX,
          this.scene.pointerY,
          (mesh) => mesh.name.startsWith("layer")
        );
        if (pick && pick.hit && pick.pickedMesh) {
          const idx = parseInt(pick.pickedMesh.name.replace("layer", ""), 10);
          if (!isNaN(idx)) this.inspectLayer(idx);
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

  setDiveStage(stage: DiveStage, fromAutoSequence = false): void {
    if (!fromAutoSequence) {
      this.clearDiveTimeouts();
    }
    this.diveStage = stage;
    this.isAnimatingCam = true;
    this.targetCamAlpha = -Math.PI / 2;

    if (stage === "field") {
      this.targetCamBeta = 0.72;
      this.targetCamRadius = 24;
      this.targetCamTarget = new Vector3(0, 0, 0);
      this.targetExplode = 0;
      this.fieldGroundNode?.setEnabled(true);
      this.reticleMesh?.setEnabled(true);
      this.pedestalMesh?.setEnabled(false);
      this.shadowMesh?.setEnabled(false);
    } else if (stage === "underground") {
      this.targetCamBeta = 1.25;
      this.targetCamRadius = 13.5;
      this.targetCamTarget = new Vector3(0, -2.8, 0);
      this.targetExplode = 0;
      this.fieldGroundNode?.setEnabled(false);
      this.reticleMesh?.setEnabled(false);
      this.pedestalMesh?.setEnabled(true);
      this.shadowMesh?.setEnabled(true);
    } else if (stage === "layers") {
      this.targetCamBeta = 1.28;
      this.targetCamRadius = 15.5;
      this.targetCamTarget = new Vector3(0, -3.2, 0);
      this.targetExplode = 1;
      this.fieldGroundNode?.setEnabled(false);
      this.reticleMesh?.setEnabled(false);
      this.pedestalMesh?.setEnabled(true);
      this.shadowMesh?.setEnabled(true);
    }

    if (this.onStageChange) this.onStageChange(stage);
  }

  getDiveStage(): DiveStage {
    return this.diveStage;
  }

  replayDive(): void {
    const reduced = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) {
      this.setDiveStage("layers");
      return;
    }
    this.clearDiveTimeouts();
    this.setDiveStage("field", true);
    this.diveTimeouts.push(
      setTimeout(() => {
        if (!this.disposed) this.setDiveStage("underground", true);
      }, 2000),
      setTimeout(() => {
        if (!this.disposed) this.setDiveStage("layers", true);
      }, 4200)
    );
  }

  setCameraPreset(preset: CameraPreset): void {
    this.introT = 1;
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
    this.isExplodedManual = true;
    this.targetExplode = exploded ? 1 : 0;
  }

  getExploded(): boolean {
    return this.targetExplode > 0.5;
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
      mat.emissiveColor = i === idx ? new Color3(0.18, 0.16, 0.12) : Color3.Black();
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
    reticle.color = new Color3(0.47, 0.88, 0.43);
    reticle.setEnabled(false);
    this.reticleMesh = reticle;
  }

  private buildSurroundingField(): void {
    this.fieldGroundNode = new TransformNode("surroundingField", this.scene);
    const sMat = new StandardMaterial("surroundingFieldMat", this.scene);
    const sTex = new Texture("/textures/soil/layer_0.jpg", this.scene);
    sTex.uScale = 4.0;
    sTex.vScale = 4.0;
    sTex.wrapU = Texture.WRAP_ADDRESSMODE;
    sTex.wrapV = Texture.WRAP_ADDRESSMODE;
    sMat.diffuseTexture = sTex;
    sMat.diffuseColor = new Color3(0.55, 0.48, 0.38);
    sMat.specularColor = Color3.Black();

    const span = 24;
    const h = 0.25;
    const y = -h / 2;

    const north = MeshBuilder.CreateBox("fieldNorth", { width: W + 2 * span, height: h, depth: span }, this.scene);
    north.position.set(0, y, D / 2 + span / 2);
    north.material = sMat;
    north.parent = this.fieldGroundNode;

    const south = MeshBuilder.CreateBox("fieldSouth", { width: W + 2 * span, height: h, depth: span }, this.scene);
    south.position.set(0, y, -D / 2 - span / 2);
    south.material = sMat;
    south.parent = this.fieldGroundNode;

    const east = MeshBuilder.CreateBox("fieldEast", { width: span, height: h, depth: D }, this.scene);
    east.position.set(W / 2 + span / 2, y, 0);
    east.material = sMat;
    east.parent = this.fieldGroundNode;

    const west = MeshBuilder.CreateBox("fieldWest", { width: span, height: h, depth: D }, this.scene);
    west.position.set(-W / 2 - span / 2, y, 0);
    west.material = sMat;
    west.parent = this.fieldGroundNode;

    this.fieldGroundNode.setEnabled(false);
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
    if (!cropId) return;
    const look = CROP_LOOK[cropId] ?? DEFAULT_LOOK;
    this.bladeMat.diffuseColor = new Color3(...look.c);
    const blade = MeshBuilder.CreateCylinder(
      "blade",
      { height: 1, diameterTop: 0, diameterBottom: 0.08, tessellation: 4 },
      this.scene,
    );
    blade.bakeTransformIntoVertices(Matrix.Translation(0, 0.5, 0));
    blade.material = this.bladeMat;
    blade.parent = this.fieldNode;

    const n = TIERS[this.tier].blades;
    const r = rng(7);
    const buf = new Float32Array(n * 16);
    for (let i = 0; i < n; i++) {
      const h = 0.7 + r() * 0.6;
      Matrix.Compose(
        new Vector3(1, h, 1),
        Quaternion.FromEulerAngles((r() - 0.5) * 0.35, r() * Math.PI, (r() - 0.5) * 0.35),
        new Vector3((r() - 0.5) * (W - 0.4), 0, (r() - 0.5) * (D - 0.4)),
      ).copyToArray(buf, i * 16);
    }
    blade.thinInstanceSetBuffer("matrix", buf, 16, true);
    blade.alwaysSelectAsActiveMesh = true;
    this.blade = blade;
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
    const z = -D / 2 - 0.06;
    const r = rng(cropId.length * 131 + maxCm);

    if (isTap) {
      // Taproot architecture: primary tapering taproot with lateral secondaries
      const primaryCount = Math.max(3, Math.floor(count * 0.45));
      for (let i = 0; i < primaryCount; i++) {
        const x0 = ((i + 0.5) / primaryCount - 0.5) * (W - 1.2) + (r() - 0.5) * 0.25;
        const depth = maxY * (0.8 + r() * 0.2);
        const pts: Vector3[] = [];
        const steps = 18;
        let x = x0;
        for (let s = 0; s <= steps; s++) {
          x += (r() - 0.5) * 0.1;
          pts.push(new Vector3(x, (depth * s) / steps - 0.02, z - r() * 0.02));
        }
        const tap = MeshBuilder.CreateTube(`taproot${i}`, { path: pts, radius: 0.042, tessellation: 6 }, this.scene);
        tap.material = this.rootMat;
        tap.parent = this.rootNode;

        const branchCount = 3 + Math.floor(r() * 2);
        for (let b = 0; b < branchCount; b++) {
          const fromStep = 3 + Math.floor(r() * 9);
          const from = pts[fromStep] ?? pts[0];
          const dir = (b % 2 === 0 ? 1 : -1) * (0.7 + r() * 0.5);
          const bdepth = from.y + (depth - from.y) * 0.35 * (0.6 + r() * 0.4);
          const bp: Vector3[] = [];
          for (let s = 0; s <= 7; s++) {
            const frac = s / 7;
            bp.push(new Vector3(from.x + dir * frac * 0.32, from.y + (bdepth - from.y) * frac, z - 0.01));
          }
          const bt = MeshBuilder.CreateTube(`tapbranch${i}_${b}`, { path: bp, radius: 0.018, tessellation: 4 }, this.scene);
          bt.material = this.rootMat;
          bt.parent = this.rootNode;
        }
      }
    } else {
      // Fibrous crown root system: dense network spreading laterally
      for (let i = 0; i < count; i++) {
        const plantCenter = Math.floor(i / 3);
        const plantCount = Math.ceil(count / 3);
        const x0 = ((plantCenter + 0.5) / plantCount - 0.5) * (W - 1.0) + (r() - 0.5) * 0.15;
        const spreadAngle = ((i % 3) - 1) * 0.32 + (r() - 0.5) * 0.12;
        const depth = maxY * (0.65 + r() * 0.35);
        const pts: Vector3[] = [];
        const steps = 16;
        for (let s = 0; s <= steps; s++) {
          const frac = s / steps;
          const x = x0 + spreadAngle * frac * 0.75 + (r() - 0.5) * 0.07;
          pts.push(new Vector3(x, depth * frac - 0.02, z - r() * 0.025));
        }
        const fibrous = MeshBuilder.CreateTube(`fibroot${i}`, { path: pts, radius: 0.032, tessellation: 5 }, this.scene);
        fibrous.material = this.rootMat;
        fibrous.parent = this.rootNode;
      }
    }
  }

  // ------------------------------------------------------------------ per-frame updates
  private tick(dt: number): void {
    this.time += dt;

    // Intro camera dive
    if (this.introT < 1) {
      this.introT = Math.min(1, this.introT + dt / 3.4);
      const t = smooth(this.introT);
      this.camera.radius = lerp(24, 14, t);
      this.camera.beta = lerp(0.8, 1.25, t);
      if (!this.isExplodedManual) {
        this.explode = smooth((this.introT - 0.35) / 0.65);
        this.positionLayers();
      }
      this.rootNode.setEnabled(this.introT > 0.92);
    } else if (!this.rootNode.isEnabled() && this.strategy) {
      this.rootNode.setEnabled(true);
    }

    // Camera preset animation & target lerp
    if (this.isAnimatingCam) {
      const k = Math.min(1, dt * 5.5);
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

    // Reticle pulse on agricultural ground in field stage
    if (this.reticleMesh && this.reticleMesh.isEnabled()) {
      const pulse = 0.55 + 0.45 * Math.sin(this.time * 4.5);
      this.reticleMesh.color = new Color3(0.3 * pulse, 0.85 * pulse, 0.3 * pulse);
    }

    // Explode smoothing
    if (Math.abs(this.explode - this.targetExplode) > 0.005) {
      this.explode = lerp(this.explode, this.targetExplode, Math.min(1, dt * 6));
      this.positionLayers();
    }

    // Multi-frequency wind breeze
    const breeze = Math.sin(this.time * 2.2) * 0.012 + Math.cos(this.time * 1.1) * 0.006;
    this.fieldNode.rotation.z = breeze;

    // Falling rain streaks
    if (this.rainMesh && this.rainMesh.isEnabled()) {
      this.rainMesh.position.y -= dt * 8.5;
      if (this.rainMesh.position.y < -3.2) {
        this.rainMesh.position.y = 0;
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
      this.saltMats[i].alpha = clamp((ece - 2.0) / 10, 0, 0.9);
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
    this.fieldNode.scaling.y = cropId ? Math.max(0.05, (sim.canopy[day] ?? 0) * look.h) : 0.001;

    // Root stress coloration
    const cropIdx = sim.crop_idx[day];
    const ws = cropIdx >= 0 ? s.seasons[cropIdx]?.indicators?.water_stress ?? 0 : 0;
    const ss = cropIdx >= 0 ? s.seasons[cropIdx]?.indicators?.salinity_stress ?? 0 : 0;
    const stress = clamp(Math.max(ws, ss));
    const rootR = lerp(0.95, 0.85, stress);
    const rootG = lerp(0.92, 0.62, stress);
    const rootB = lerp(0.84, 0.38, stress);
    this.rootMat.emissiveColor = new Color3(rootR, rootG, rootB);

    // Weather ambiance
    const tmax = res.climate.tmax[day] ?? 28;
    const rain = res.climate.rain[day] ?? 0;
    const heat = clamp((tmax - 24) / 14);
    const base = this.theme === "dark" ? [0.07, 0.09, 0.12] : [0.62, 0.78, 0.92];
    const warm = this.theme === "dark" ? [0.12, 0.1, 0.09] : [0.9, 0.82, 0.68];
    const grey = this.theme === "dark" ? [0.1, 0.11, 0.13] : [0.55, 0.6, 0.66];
    const mix = (a: number[], b: number[], t: number) => a.map((v, i) => lerp(v, b[i], t));

    let c = mix(base, warm, heat * 0.7);
    if (rain > 1) c = mix(c, grey, clamp(rain / 12) * 0.8 + 0.2);
    this.scene.clearColor = new Color4(c[0], c[1], c[2], 1);
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
