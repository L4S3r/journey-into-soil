import { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import { Engine } from "@babylonjs/core/Engines/engine";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { Matrix, Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import "@babylonjs/core/Meshes/thinInstanceMesh";
import { Scene } from "@babylonjs/core/scene";
import type { AnalysisResult, Layer, Quality, Strategy, StrategyId } from "./types";

/**
 * Imperative scene API. React never touches Babylon objects: it only calls these methods.
 * Layout: a cutaway block seen from -z. Layers are data-driven (colour from texture + organic matter, darkness from
 * simulated moisture, salt speckle from ECe). Roots are drawn on the cut face; crop blades stand on the surface.
 */

const W = 8; // block width (x)
const D = 4; // block depth (z)
const GAP = 0.16; // gap between layers when exploded
const LAYER_H = [1.3, 1.4, 1.6, 1.9]; // world height per layer (not to scale: the top layers need room)

const TIERS: Record<Quality, { scale: number; blades: number; roots: number }> = {
  high: { scale: 1, blades: 1400, roots: 18 },
  medium: { scale: 1.25, blades: 600, roots: 12 },
  low: { scale: 1.75, blades: 220, roots: 7 },
};

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

function baseColor(layer: Layer): Color3 {
  const sand = layer.sand / 100;
  const silt = layer.silt / 100;
  const clay = layer.clay / 100;
  const r = 0.78 * sand + 0.55 * silt + 0.62 * clay;
  const g = 0.66 * sand + 0.45 * silt + 0.33 * clay;
  const b = 0.45 * sand + 0.35 * silt + 0.2 * clay;
  const dark = 1 - Math.min(0.5, layer.om * 0.12);
  return new Color3(r * dark, g * dark, b * dark);
}

export class SceneController {
  private engine: Engine;
  private scene: Scene;
  private camera: ArcRotateCamera;
  private sun: DirectionalLight;
  private ambient: HemisphericLight;
  private layerMeshes: Mesh[] = [];
  private layerMats: StandardMaterial[] = [];
  private saltMats: StandardMaterial[] = [];
  private saltPlanes: Mesh[] = [];
  private layerBase: Color3[] = [];
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
  private introT = 1;
  private tier: Quality = "high";
  private auto = true;
  private frames = 0;
  private theme: "light" | "dark" = "light";
  private disposed = false;
  private resizeObs: ResizeObserver | null = null;
  private time = 0;

  constructor(canvas: HTMLCanvasElement, private onDay?: (day: number) => void) {
    this.engine = new Engine(canvas, true, { preserveDrawingBuffer: false, stencil: false }, true);
    this.scene = new Scene(this.engine);
    this.scene.clearColor = new Color4(0.62, 0.78, 0.92, 1);

    this.camera = new ArcRotateCamera("cam", -Math.PI / 2, 1.2, 22, new Vector3(0, -2.6, 0), this.scene);
    this.camera.lowerRadiusLimit = 6;
    this.camera.upperRadiusLimit = 32;
    this.camera.lowerBetaLimit = 0.35;
    this.camera.upperBetaLimit = 1.75;
    this.camera.wheelPrecision = 30;
    this.camera.panningSensibility = 0;
    this.camera.attachControl(canvas, true);

    this.ambient = new HemisphericLight("amb", new Vector3(0, 1, -0.3), this.scene);
    this.ambient.intensity = 0.75;
    this.sun = new DirectionalLight("sun", new Vector3(-0.4, -1, 0.6), this.scene);
    this.sun.intensity = 0.9;

    this.fieldNode = new TransformNode("field", this.scene);
    this.rootNode = new TransformNode("roots", this.scene);
    this.bladeMat = new StandardMaterial("blade", this.scene);
    this.bladeMat.specularColor = Color3.Black();
    this.rootMat = new StandardMaterial("root", this.scene);
    this.rootMat.emissiveColor = new Color3(0.92, 0.86, 0.68);
    this.rootMat.diffuseColor = Color3.Black();

    this.buildLayers();
    this.applyTier("high");

    const reduced = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) this.explode = 1;

    this.scene.onBeforeRenderObservable.add(() => this.tick(this.engine.getDeltaTime() / 1000));
    this.engine.runRenderLoop(() => {
      if (!this.disposed) this.scene.render();
    });
    this.resizeObs = new ResizeObserver(() => this.engine.resize());
    this.resizeObs.observe(canvas.parentElement ?? canvas);
  }

  // ------------------------------------------------------------------ public API
  /** `replay` re-runs the dive intro; pass false when only the numbers changed (e.g. a climate scenario). */
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
    this.currentCrop = "?"; // sentinel: force blades and roots to rebuild for the new strategy
    this.applyDay(this.dayIdx);
  }

  /** t in 0..1 across the whole timeline. */
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
    this.introT = reduced ? 1 : 0;
    this.explode = reduced ? 1 : 0;
    this.camera.radius = reduced ? 12 : 24;
    this.camera.beta = reduced ? 1.25 : 0.8;
  }

  getQuality(): Quality {
    return this.tier;
  }

  dispose(): void {
    this.disposed = true;
    this.resizeObs?.disconnect();
    this.engine.stopRenderLoop();
    this.scene.dispose();
    this.engine.dispose();
  }

  // ------------------------------------------------------------------ construction
  private specklePair(seed: number): { soil: DynamicTexture; salt: DynamicTexture } {
    const r = rng(seed);
    const soil = new DynamicTexture(`soilTex${seed}`, { width: 256, height: 256 }, this.scene, true);
    const ctx = soil.getContext();
    ctx.fillStyle = "#d8d8d8";
    ctx.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 2600; i++) {
      const v = 150 + Math.floor(r() * 105);
      ctx.fillStyle = `rgb(${v},${v},${v})`;
      ctx.fillRect(r() * 256, r() * 256, 1 + r() * 3, 1 + r() * 3);
    }
    soil.update();
    const salt = new DynamicTexture(`saltTex${seed}`, { width: 256, height: 256 }, this.scene, true);
    const sctx = salt.getContext();
    sctx.clearRect(0, 0, 256, 256);
    for (let i = 0; i < 700; i++) {
      sctx.fillStyle = `rgba(255,255,255,${0.5 + r() * 0.5})`;
      sctx.beginPath();
      sctx.arc(r() * 256, r() * 256, 0.8 + r() * 2.2, 0, Math.PI * 2);
      sctx.fill();
    }
    salt.hasAlpha = true;
    salt.update();
    return { soil, salt };
  }

  private buildLayers(): void {
    let top = 0;
    LAYER_H.forEach((h, i) => {
      const box = MeshBuilder.CreateBox(`layer${i}`, { width: W, height: h, depth: D }, this.scene);
      const { soil, salt } = this.specklePair(11 + i);
      const mat = new StandardMaterial(`layerMat${i}`, this.scene);
      mat.diffuseTexture = soil;
      mat.specularPower = 24;
      box.material = mat;
      const plane = MeshBuilder.CreatePlane(`salt${i}`, { width: W, height: h }, this.scene);
      const smat = new StandardMaterial(`saltMat${i}`, this.scene);
      smat.diffuseTexture = salt;
      smat.useAlphaFromDiffuseTexture = true;
      smat.emissiveColor = new Color3(0.95, 0.95, 0.95);
      smat.specularColor = Color3.Black();
      smat.alpha = 0;
      plane.material = smat;
      this.layerMeshes.push(box);
      this.layerMats.push(mat);
      this.saltPlanes.push(plane);
      this.saltMats.push(smat);
      this.layerBase.push(new Color3(0.45, 0.32, 0.2));
      box.metadata = { top, h };
      top += h;
    });
    this.positionLayers();
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
  }

  private rebuildLayersFromResult(): void {
    if (!this.result) return;
    this.result.layers.forEach((l, i) => {
      this.layerBase[i] = baseColor(l);
    });
  }

  /** Map depth in cm to a world y on the cut face, using the exploded layout. */
  private cmToY(cm: number): number {
    const layers = this.result?.layers ?? [];
    let top = 0;
    for (let i = 0; i < LAYER_H.length; i++) {
      const l = layers[i];
      const span = l ? l.bottom_cm - l.top_cm : [20, 30, 40, 60][i];
      const start = l ? l.top_cm : [0, 20, 50, 90][i];
      if (cm <= start + span || i === LAYER_H.length - 1) {
        const frac = clamp((cm - start) / span);
        return -(top + frac * LAYER_H[i] + i * GAP);
      }
      top += LAYER_H[i];
    }
    return -top;
  }

  private applyTier(q: Quality): void {
    this.tier = q;
    this.engine.setHardwareScalingLevel(TIERS[q].scale);
    this.currentCrop = "?"; // blade and root counts depend on the tier
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
    const blade = MeshBuilder.CreateCylinder("blade", { height: 1, diameterTop: 0, diameterBottom: 0.09, tessellation: 4 }, this.scene);
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

  private buildRoots(cropId: string, maxCm: number): void {
    this.rootNode.getChildMeshes().forEach((m) => m.dispose());
    if (!cropId) return;
    const r = rng(cropId.length * 131 + maxCm);
    const count = TIERS[this.tier].roots;
    const maxY = this.cmToY(maxCm);
    const z = -D / 2 - 0.06;
    for (let i = 0; i < count; i++) {
      const x0 = ((i + 0.5) / count - 0.5) * (W - 0.8) + (r() - 0.5) * 0.2;
      const depth = maxY * (0.55 + r() * 0.45);
      const pts: Vector3[] = [];
      const steps = 16;
      let x = x0;
      for (let s = 0; s <= steps; s++) {
        x += (r() - 0.5) * 0.14;
        pts.push(new Vector3(x, (depth * s) / steps - 0.02, z - r() * 0.03));
      }
      const tube = MeshBuilder.CreateTube(`root${i}`, { path: pts, radius: 0.035, tessellation: 5 }, this.scene);
      tube.material = this.rootMat;
      tube.parent = this.rootNode;
      const branches = i % 2 === 0 ? 2 : 1;
      for (let b = 0; b < branches; b++) {
        const from = pts[4 + Math.floor(r() * 8)];
        const dir = r() < 0.5 ? -1 : 1;
        const bp: Vector3[] = [];
        for (let s = 0; s <= 6; s++) bp.push(new Vector3(from.x + dir * s * 0.18, from.y + (depth - from.y) * 0.1 * s * 0.5, z - 0.01));
        const bt = MeshBuilder.CreateTube(`rootb${i}_${b}`, { path: bp, radius: 0.018, tessellation: 4 }, this.scene);
        bt.material = this.rootMat;
        bt.parent = this.rootNode;
      }
    }
  }

  // ------------------------------------------------------------------ per-frame and per-day updates
  private tick(dt: number): void {
    this.time += dt;
    if (this.introT < 1) {
      this.introT = Math.min(1, this.introT + dt / 3.4);
      const t = smooth(this.introT);
      this.camera.radius = lerp(24, 12, t);
      this.camera.beta = lerp(0.8, 1.25, t);
      this.explode = smooth((this.introT - 0.35) / 0.65);
      this.positionLayers();
      this.rootNode.setEnabled(this.introT > 0.92);
    } else if (!this.rootNode.isEnabled() && this.strategy) {
      this.rootNode.setEnabled(true);
    }
    this.fieldNode.rotation.z = 0.015 * Math.sin(this.time * 1.4);

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
    for (let i = 0; i < this.layerMats.length; i++) {
      const m = sim.moisture[i]?.[day] ?? 0.5;
      const wet = clamp(m / 1.1);
      const base = this.layerBase[i];
      const k = 1 - 0.5 * wet;
      this.layerMats[i].diffuseColor = new Color3(base.r * k, base.g * k, base.b * k);
      this.layerMats[i].specularColor = new Color3(0.05 + 0.25 * wet, 0.05 + 0.25 * wet, 0.05 + 0.25 * wet);
      const ece = sim.ece[i]?.[day] ?? 0;
      this.saltMats[i].alpha = clamp((ece - 2.0) / 10, 0, 0.9);
    }

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

    // Weather mood from the climate series.
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
    this.onDay?.(day);
  }
}
