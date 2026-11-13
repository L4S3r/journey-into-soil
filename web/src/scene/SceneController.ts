import * as THREE from "three";
import { TEX } from "./textures";
import type {
  AnalysisResult,
  CameraPreset,
  DiveStage,
  LayerInspectData,
  Quality,
  SceneTelemetry,
  StrategyId,
} from "./types";

const HT = [1.5, 1.5, 1.7, 1.5];
const GAP = 1.3;
const SW = 60;
const DEP = 60;
const DUR = 9.6;
const HAZE = [0.91, 0.81, 0.61];
const DARK = [0.05, 0.035, 0.02];

const sm = (x: number) => {
  const c = Math.min(1, Math.max(0, x));
  return c * c * (3 - 2 * c);
};

export class SceneController {
  private canvas: HTMLCanvasElement;
  private renderer!: THREE.WebGLRenderer;
  private scene!: THREE.Scene;
  private cam!: THREE.PerspectiveCamera;
  private grp!: THREE.Group;
  private frontG!: THREE.Group;
  private slabs: { g: THREE.Group; h: number; ph: number; mesh: THREE.Mesh }[] = [];
  private dust!: THREE.Points;
  private burst!: THREE.Points;
  private burstV!: Float32Array;
  private bst = -1;
  private swayU = { value: 0 };
  private cows: { group: THREE.Group; head: THREE.Group; tail: THREE.Group; phase: number }[] = [];
  private t0 = 0;
  private last = 0;
  private raf = 0;
  private rotT = 0;
  private drag: { x: number; r: number } | null = null;
  private tv = 0.34;
  private D = 13;
  private finished = false;
  private currentStage: DiveStage = "field";
  private focusedLayer: number | null = null;

  // External result and callbacks
  private result: AnalysisResult | null = null;
  private strategyId: StrategyId = "primary";
  private dayT = 0;
  private theme: "light" | "dark" = "light";
  private quality: Quality | "auto" = "high";

  private onInspectCb?: (data: LayerInspectData | null) => void;
  private onTelemetryCb?: (data: SceneTelemetry) => void;
  private onStageChangeCb?: (stage: DiveStage) => void;
  private onLayerFocusChangeCb?: (idx: number | null) => void;
  private onDiveProgressCb?: (key: string | null, canSkip: boolean) => void;

  private pointerDownHandler: (e: PointerEvent) => void;
  private pointerMoveHandler: (e: PointerEvent) => void;
  private pointerUpHandler: () => void;
  private resizeHandler: () => void;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.pointerDownHandler = this.onPointerDown.bind(this);
    this.pointerMoveHandler = this.onPointerMove.bind(this);
    this.pointerUpHandler = this.onPointerUp.bind(this);
    this.resizeHandler = this.fit.bind(this);

    this.initScene();
    this.fit();
    window.addEventListener("resize", this.resizeHandler);

    this.t0 = performance.now();
    this.last = performance.now();
    this.frame = this.frame.bind(this);
    this.raf = requestAnimationFrame(this.frame);
  }

  private initScene(): void {
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      alpha: true,
      powerPreference: "high-performance",
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(0xe8cf9b, 13, 55);

    this.cam = new THREE.PerspectiveCamera(38, 1, 0.1, 120);

    // Lighting
    const amb = new THREE.AmbientLight(0xffffff, 0.85);
    this.scene.add(amb);

    const dl = new THREE.DirectionalLight(0xfff0d0, 0.95);
    dl.position.set(-5, 8, 9);
    this.scene.add(dl);

    const rim = new THREE.PointLight(0xffc37a, 0.7, 30);
    rim.position.set(6, -2, 6);
    this.scene.add(rim);

    // Root groups
    this.grp = new THREE.Group();
    this.scene.add(this.grp);

    this.frontG = new THREE.Group();
    this.grp.add(this.frontG);

    // Textures & Slabs
    const ld = new THREE.TextureLoader();
    const sc = [0x241911, 0x45311f, 0x60291b, 0x5d5647];

    const loadTex = (i: number, rx: number, ry: number) => {
      const t = ld.load(TEX[i]);
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = 8;
      t.wrapS = THREE.MirroredRepeatWrapping;
      t.wrapT = THREE.MirroredRepeatWrapping;
      t.repeat.set(rx, ry);
      return t;
    };

    const makeMat = (t: THREE.Texture, col?: number) =>
      new THREE.MeshStandardMaterial({
        map: t,
        bumpMap: t,
        bumpScale: 1.2,
        roughness: 1,
        color: col || 0xffffff,
      });

    this.slabs = [];
    HT.forEach((h, i) => {
      const side = new THREE.MeshStandardMaterial({ color: sc[i], roughness: 1 });
      const tp = loadTex(i, SW / 7.5, 6);
      const boxMat = [
        side,
        side,
        makeMat(tp, i ? 0xffffff : 0xcfc5ac),
        makeMat(tp),
        makeMat(loadTex(i, SW / 7.5, 1)),
        side,
      ];
      const box = new THREE.Mesh(new THREE.BoxGeometry(SW, h, DEP), boxMat);
      box.position.z = -DEP / 2;

      const g = new THREE.Group();
      g.add(box);
      this.grp.add(g);
      this.slabs.push({ g, h, ph: i * 1.3, mesh: box });
    });

    // Foreground drop block
    const dk = new THREE.MeshStandardMaterial({ color: 0x241911, roughness: 1 });
    const fbMat = [
      dk,
      dk,
      makeMat(loadTex(0, SW / 7.5, 6), 0xcfc5ac),
      dk,
      dk,
      dk,
    ];
    const fb = new THREE.Mesh(new THREE.BoxGeometry(SW, 6.2, 40), fbMat);
    fb.position.set(0, -3.1, 20);
    this.frontG.add(fb);

    // Instanced lush agricultural vegetation (with pasture clearing for livestock)
    this.plantField(this.slabs[0].g, -28, 28, -52, 0, 0.55, 0.45, HT[0] / 2);
    this.plantField(this.frontG, -26, 26, 0, 14, 0.55, 0.45, 0, {
      x0: -15,
      x1: -4.5,
      z0: 4.5,
      z1: 12,
    });

    // Pine tree windbreak shelterbelts (conservation windbreaks along borders & horizon)
    this.plantPineTrees();

    // Grazing cattle herd (procedural low-poly Three.js cows with grazing animation)
    this.plantCows();

    // Dust motes particles
    const N = 180;
    const pos = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 28;
      pos[i * 3 + 1] = -Math.random() * 12;
      pos[i * 3 + 2] = (Math.random() - 0.3) * 16;
    }
    const pg = new THREE.BufferGeometry();
    pg.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    this.dust = new THREE.Points(
      pg,
      new THREE.PointsMaterial({
        color: 0xffe6b0,
        size: 0.06,
        transparent: true,
        opacity: 0.5,
        depthWrite: false,
      })
    );
    this.scene.add(this.dust);

    // Ground crack burst particles
    const NB = 200;
    const bp = new Float32Array(NB * 3);
    this.burstV = new Float32Array(NB * 3);
    const bg = new THREE.BufferGeometry();
    bg.setAttribute("position", new THREE.BufferAttribute(bp, 3));
    this.burst = new THREE.Points(
      bg,
      new THREE.PointsMaterial({
        color: 0x9c8458,
        size: 0.16,
        transparent: true,
        opacity: 0,
        depthWrite: false,
      })
    );
    this.burst.frustumCulled = false;
    this.scene.add(this.burst);

    // Pointer events for horizontal rotation
    this.canvas.addEventListener("pointerdown", this.pointerDownHandler);
    this.canvas.addEventListener("pointermove", this.pointerMoveHandler);
    this.canvas.addEventListener("pointerup", this.pointerUpHandler);
    this.canvas.addEventListener("pointercancel", this.pointerUpHandler);
  }

  private plantField(
    parent: THREE.Object3D,
    x0: number,
    x1: number,
    z0: number,
    z1: number,
    dx: number,
    dz: number,
    y: number,
    excludeZone?: { x0: number; x1: number; z0: number; z1: number }
  ): void {
    const nx = Math.floor((x1 - x0) / dx) + 1;
    const nz = Math.floor((z1 - z0) / dz) + 1;
    const n = nx * nz;

    const mat = new THREE.MeshStandardMaterial({
      roughness: 0.85,
      side: THREE.DoubleSide,
    });
    mat.onBeforeCompile = (s) => {
      s.uniforms.uTime = this.swayU;
      s.vertexShader =
        "uniform float uTime;\n" +
        s.vertexShader.replace(
          "#include <begin_vertex>",
          "#include <begin_vertex>\ntransformed.x += sin(uTime*1.7+instanceMatrix[3][0]*.6+instanceMatrix[3][2]*.35)*.09*position.y;"
        );
    };

    const geo = new THREE.ConeGeometry(0.09, 1.2, 5);
    geo.translate(0, 0.6, 0);

    const d = new THREE.Object3D();
    const c = new THREE.Color();
    d.rotation.order = "YXZ";

    for (let k = 0; k < 3; k++) {
      const m = new THREE.InstancedMesh(geo, mat, n);
      let q = 0;
      for (let i = 0; i < nx; i++) {
        for (let j = 0; j < nz; j++) {
          const jitterX = (Math.random() - 0.5) * dx * 0.7;
          const jitterZ = (Math.random() - 0.5) * dz * 0.7;
          const posX = x0 + i * dx + jitterX;
          const posZ = z0 + j * dz + jitterZ;

          // Check if coordinate falls inside livestock pasture clearing
          if (
            excludeZone &&
            posX >= excludeZone.x0 &&
            posX <= excludeZone.x1 &&
            posZ >= excludeZone.z0 &&
            posZ <= excludeZone.z1
          ) {
            d.scale.set(0, 0, 0);
            d.position.set(posX, y, posZ);
            d.updateMatrix();
            m.setMatrixAt(q++, d.matrix);
            continue;
          }

          d.position.set(posX, y, posZ);

          if (k === 0) {
            // Main vertical wheat/barley stalk with ear
            d.rotation.set((Math.random() - 0.5) * 0.15, Math.random() * Math.PI * 2, 0);
            d.scale.set(1.15, 0.85 + Math.random() * 0.45, 1.15);
            // Rich golden-harvest and deep green tones
            c.setHSL(
              0.22 + Math.random() * 0.08,
              0.48 + Math.random() * 0.2,
              0.2 + Math.random() * 0.14
            );
          } else {
            // Natural spreading side blades and foliage
            const tilt = 0.28 + Math.random() * 0.35;
            d.rotation.set(tilt, k * 2.1 + Math.random() * 1.5, 0);
            d.scale.set(0.85, 0.55 + Math.random() * 0.4, 0.85);
            c.setHSL(
              0.24 + Math.random() * 0.09,
              0.42 + Math.random() * 0.2,
              0.16 + Math.random() * 0.12
            );
          }

          d.updateMatrix();
          m.setMatrixAt(q, d.matrix);
          m.setColorAt(q++, c);
        }
      }
      m.count = q;
      m.frustumCulled = false;
      parent.add(m);
    }
  }

  private createPineTree(scale = 1): THREE.Group {
    const tree = new THREE.Group();

    // Wood trunk
    const trunkGeo = new THREE.CylinderGeometry(0.14 * scale, 0.24 * scale, 1.8 * scale, 6);
    trunkGeo.translate(0, 0.9 * scale, 0);
    const trunkMat = new THREE.MeshStandardMaterial({
      color: 0x3d2714,
      roughness: 0.9,
    });
    const trunk = new THREE.Mesh(trunkGeo, trunkMat);
    tree.add(trunk);

    // Foliage tiers (coniferous evergreen needle canopies)
    const folMat1 = new THREE.MeshStandardMaterial({
      color: 0x1b3c20,
      roughness: 0.85,
      flatShading: true,
    });
    const folMat2 = new THREE.MeshStandardMaterial({
      color: 0x244c29,
      roughness: 0.85,
      flatShading: true,
    });
    const folMat3 = new THREE.MeshStandardMaterial({
      color: 0x2e5c33,
      roughness: 0.85,
      flatShading: true,
    });

    // Tier 1 (bottom canopy)
    const tier1Geo = new THREE.ConeGeometry(1.6 * scale, 2.2 * scale, 7);
    tier1Geo.translate(0, 1.9 * scale, 0);
    const tier1 = new THREE.Mesh(tier1Geo, folMat1);
    tree.add(tier1);

    // Tier 2 (middle canopy)
    const tier2Geo = new THREE.ConeGeometry(1.22 * scale, 1.9 * scale, 7);
    tier2Geo.translate(0, 2.9 * scale, 0);
    const tier2 = new THREE.Mesh(tier2Geo, folMat2);
    tree.add(tier2);

    // Tier 3 (top tip)
    const tier3Geo = new THREE.ConeGeometry(0.82 * scale, 1.6 * scale, 7);
    tier3Geo.translate(0, 3.8 * scale, 0);
    const tier3 = new THREE.Mesh(tier3Geo, folMat3);
    tree.add(tier3);

    return tree;
  }

  private plantPineTrees(): void {
    // Left boundary windbreak shelterbelt along main field (slabs[0])
    for (let z = -50; z <= -4; z += 5.2) {
      const s = 0.9 + Math.random() * 0.45;
      const tree = this.createPineTree(s);
      const jx = (Math.random() - 0.5) * 1.2;
      const jz = (Math.random() - 0.5) * 1.0;
      tree.position.set(-26.2 + jx, HT[0] / 2, z + jz);
      tree.rotation.y = Math.random() * Math.PI * 2;
      tree.rotation.z = (Math.random() - 0.5) * 0.04;
      this.slabs[0].g.add(tree);
    }

    // Right boundary windbreak shelterbelt along main field (slabs[0])
    for (let z = -50; z <= -4; z += 5.2) {
      const s = 0.9 + Math.random() * 0.45;
      const tree = this.createPineTree(s);
      const jx = (Math.random() - 0.5) * 1.2;
      const jz = (Math.random() - 0.5) * 1.0;
      tree.position.set(26.2 + jx, HT[0] / 2, z + jz);
      tree.rotation.y = Math.random() * Math.PI * 2;
      tree.rotation.z = (Math.random() - 0.5) * 0.04;
      this.slabs[0].g.add(tree);
    }

    // Horizon windbreak ridge along the rear edge of the field
    for (let x = -26; x <= 26; x += 3.8) {
      const s = 1.05 + Math.random() * 0.5;
      const tree = this.createPineTree(s);
      const jx = (Math.random() - 0.5) * 1.0;
      const jz = (Math.random() - 0.5) * 1.4;
      tree.position.set(x + jx, HT[0] / 2, -53 + jz);
      tree.rotation.y = Math.random() * Math.PI * 2;
      this.slabs[0].g.add(tree);
    }

    // Foreground shelterbelts on frontG framing Act 1 camera view
    for (let z = 3; z <= 14; z += 4.5) {
      // Left foreground
      const sL = 0.95 + Math.random() * 0.35;
      const treeL = this.createPineTree(sL);
      treeL.position.set(-25.5 + (Math.random() - 0.5) * 1.0, 0, z);
      treeL.rotation.y = Math.random() * Math.PI * 2;
      this.frontG.add(treeL);

      // Right foreground
      const sR = 0.95 + Math.random() * 0.35;
      const treeR = this.createPineTree(sR);
      treeR.position.set(25.5 + (Math.random() - 0.5) * 1.0, 0, z);
      treeR.rotation.y = Math.random() * Math.PI * 2;
      this.frontG.add(treeR);
    }
  }

  private createCow(
    scale = 1,
    breed: "holstein" | "jersey" = "holstein"
  ): { group: THREE.Group; head: THREE.Group; tail: THREE.Group; phase: number } {
    const group = new THREE.Group();

    const isHolstein = breed === "holstein";
    const bodyColor = isHolstein ? 0xf5f5f3 : 0xa66f42;
    const spotColor = isHolstein ? 0x1a1a1a : 0x543217;
    const snoutColor = 0xdf9d9b;
    const hornColor = 0xe4dec8;
    const hoofColor = 0x222222;

    const bodyMat = new THREE.MeshStandardMaterial({
      color: bodyColor,
      roughness: 0.82,
    });
    const spotMat = new THREE.MeshStandardMaterial({
      color: spotColor,
      roughness: 0.82,
    });
    const snoutMat = new THREE.MeshStandardMaterial({
      color: snoutColor,
      roughness: 0.7,
    });
    const hornMat = new THREE.MeshStandardMaterial({
      color: hornColor,
      roughness: 0.6,
    });
    const hoofMat = new THREE.MeshStandardMaterial({
      color: hoofColor,
      roughness: 0.85,
    });
    const eyeMat = new THREE.MeshStandardMaterial({
      color: 0x111111,
      roughness: 0.3,
    });

    // 1. Torso
    const torsoGeo = new THREE.BoxGeometry(0.95 * scale, 1.05 * scale, 1.95 * scale);
    const torso = new THREE.Mesh(torsoGeo, bodyMat);
    torso.position.y = 1.25 * scale;
    group.add(torso);

    // Flank patches
    const spot1 = new THREE.Mesh(
      new THREE.BoxGeometry(0.97 * scale, 0.55 * scale, 0.75 * scale),
      spotMat
    );
    spot1.position.set(0.01 * scale, 1.32 * scale, -0.2 * scale);
    group.add(spot1);

    const spot2 = new THREE.Mesh(
      new THREE.BoxGeometry(0.7 * scale, 0.05 * scale, 0.7 * scale),
      spotMat
    );
    spot2.position.set(-0.1 * scale, 1.78 * scale, 0.35 * scale);
    group.add(spot2);

    const spot3 = new THREE.Mesh(
      new THREE.BoxGeometry(0.97 * scale, 0.45 * scale, 0.5 * scale),
      spotMat
    );
    spot3.position.set(-0.01 * scale, 1.15 * scale, 0.5 * scale);
    group.add(spot3);

    // Udder
    const udderMat = new THREE.MeshStandardMaterial({ color: 0xefa7a1, roughness: 0.75 });
    const udder = new THREE.Mesh(
      new THREE.BoxGeometry(0.45 * scale, 0.28 * scale, 0.45 * scale),
      udderMat
    );
    udder.position.set(0, 0.68 * scale, 0.4 * scale);
    group.add(udder);

    // 2. Four Legs & Hooves
    const legW = 0.22 * scale;
    const legH = 0.8 * scale;
    const legOffsets: [number, number, boolean][] = [
      [-0.34 * scale, -0.6 * scale, false],
      [0.34 * scale, -0.6 * scale, true],
      [-0.34 * scale, 0.6 * scale, true],
      [0.34 * scale, 0.6 * scale, false],
    ];

    legOffsets.forEach(([lx, lz, hasSpot]) => {
      const legGeo = new THREE.BoxGeometry(legW, legH, legW);
      const legMesh = new THREE.Mesh(legGeo, hasSpot ? spotMat : bodyMat);
      legMesh.position.set(lx, 0.42 * scale, lz);
      group.add(legMesh);

      const hoofGeo = new THREE.BoxGeometry(legW * 1.05, 0.12 * scale, legW * 1.05);
      const hoofMesh = new THREE.Mesh(hoofGeo, hoofMat);
      hoofMesh.position.set(lx, 0.06 * scale, lz);
      group.add(hoofMesh);
    });

    // 3. Articulated Grazing Head & Neck
    const head = new THREE.Group();
    head.position.set(0, 1.48 * scale, -0.85 * scale);
    group.add(head);

    // Neck
    const neckGeo = new THREE.BoxGeometry(0.52 * scale, 0.6 * scale, 0.55 * scale);
    const neck = new THREE.Mesh(neckGeo, bodyMat);
    neck.position.set(0, -0.12 * scale, -0.22 * scale);
    neck.rotation.x = 0.3;
    head.add(neck);

    // Skull
    const skullGeo = new THREE.BoxGeometry(0.56 * scale, 0.58 * scale, 0.65 * scale);
    const skull = new THREE.Mesh(skullGeo, bodyMat);
    skull.position.set(0, -0.22 * scale, -0.55 * scale);
    head.add(skull);

    // Head patch
    const headSpot = new THREE.Mesh(
      new THREE.BoxGeometry(0.3 * scale, 0.32 * scale, 0.35 * scale),
      spotMat
    );
    headSpot.position.set(-0.16 * scale, -0.16 * scale, -0.58 * scale);
    head.add(headSpot);

    // Snout / Muzzle
    const snoutGeo = new THREE.BoxGeometry(0.48 * scale, 0.35 * scale, 0.4 * scale);
    const snout = new THREE.Mesh(snoutGeo, snoutMat);
    snout.position.set(0, -0.32 * scale, -0.92 * scale);
    head.add(snout);

    // Nostrils
    const nostrilGeo = new THREE.BoxGeometry(0.06 * scale, 0.05 * scale, 0.02 * scale);
    const nostrilL = new THREE.Mesh(nostrilGeo, hoofMat);
    nostrilL.position.set(-0.12 * scale, -0.3 * scale, -1.13 * scale);
    const nostrilR = new THREE.Mesh(nostrilGeo, hoofMat);
    nostrilR.position.set(0.12 * scale, -0.3 * scale, -1.13 * scale);
    head.add(nostrilL);
    head.add(nostrilR);

    // Eyes
    const eyeGeo = new THREE.BoxGeometry(0.05 * scale, 0.08 * scale, 0.08 * scale);
    const eyeL = new THREE.Mesh(eyeGeo, eyeMat);
    eyeL.position.set(-0.29 * scale, -0.14 * scale, -0.6 * scale);
    const eyeR = new THREE.Mesh(eyeGeo, eyeMat);
    eyeR.position.set(0.29 * scale, -0.14 * scale, -0.6 * scale);
    head.add(eyeL);
    head.add(eyeR);

    // Horns
    const hornGeo = new THREE.ConeGeometry(0.06 * scale, 0.28 * scale, 5);
    const hornL = new THREE.Mesh(hornGeo, hornMat);
    hornL.position.set(-0.22 * scale, 0.14 * scale, -0.52 * scale);
    hornL.rotation.set(-0.2, 0, -0.4);
    const hornR = new THREE.Mesh(hornGeo, hornMat);
    hornR.position.set(0.22 * scale, 0.14 * scale, -0.52 * scale);
    hornR.rotation.set(-0.2, 0, 0.4);
    head.add(hornL);
    head.add(hornR);

    // Ears
    const earGeo = new THREE.BoxGeometry(0.26 * scale, 0.1 * scale, 0.14 * scale);
    const earL = new THREE.Mesh(earGeo, bodyMat);
    earL.position.set(-0.35 * scale, 0.02 * scale, -0.5 * scale);
    earL.rotation.set(0, -0.25, -0.2);
    const earR = new THREE.Mesh(earGeo, bodyMat);
    earR.position.set(0.35 * scale, 0.02 * scale, -0.5 * scale);
    earR.rotation.set(0, 0.25, 0.2);
    head.add(earL);
    head.add(earR);

    // 4. Tail
    const tail = new THREE.Group();
    tail.position.set(0, 1.62 * scale, 0.95 * scale);
    group.add(tail);

    const stalkGeo = new THREE.CylinderGeometry(0.028 * scale, 0.02 * scale, 0.65 * scale, 5);
    stalkGeo.translate(0, -0.32 * scale, 0);
    const stalk = new THREE.Mesh(stalkGeo, bodyMat);
    stalk.rotation.x = 0.12;
    tail.add(stalk);

    const tuftGeo = new THREE.ConeGeometry(0.065 * scale, 0.2 * scale, 5);
    tuftGeo.translate(0, -0.72 * scale, 0);
    const tuft = new THREE.Mesh(tuftGeo, spotMat);
    tuft.rotation.x = Math.PI;
    tail.add(tuft);

    return {
      group,
      head,
      tail,
      phase: Math.random() * Math.PI * 2,
    };
  }

  private plantCows(): void {
    // 1. Adult Holstein Cow (Mother) in foreground pasture clearing
    const cow1 = this.createCow(1.15, "holstein");
    cow1.group.position.set(-9.5, 0, 7.2);
    cow1.group.rotation.y = 0.75;
    this.frontG.add(cow1.group);
    this.cows.push(cow1);

    // 2. Adult Jersey Cow in foreground pasture clearing
    const cow2 = this.createCow(1.05, "jersey");
    cow2.group.position.set(-12.8, 0, 9.6);
    cow2.group.rotation.y = 2.35;
    this.frontG.add(cow2.group);
    this.cows.push(cow2);

    // 3. Holstein Calf near mother cow
    const calf = this.createCow(0.62, "holstein");
    calf.group.position.set(-7.2, 0, 8.8);
    calf.group.rotation.y = 1.1;
    this.frontG.add(calf.group);
    this.cows.push(calf);

    // 4. Distant Holstein grazing on the main agricultural field (slabs[0])
    const cow4 = this.createCow(1.1, "holstein");
    cow4.group.position.set(15.5, HT[0] / 2, -14.0);
    cow4.group.rotation.y = -1.35;
    this.slabs[0].g.add(cow4.group);
    this.cows.push(cow4);
  }

  public fit(): void {
    const W = this.canvas.clientWidth || window.innerWidth;
    const H = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(W, H, false);
    this.cam.aspect = W / H;
    this.tv = Math.tan((this.cam.fov * Math.PI) / 360);
    this.D = Math.max(5.9 / this.tv, (8 * 1.12 / 2) / (this.tv * this.cam.aspect));

    if (W < 760) {
      this.D *= 1.1;
      this.cam.setViewOffset(W, H, 0, H * 0.16, W, H);
    } else {
      this.cam.clearViewOffset();
    }

    this.grp.position.x = W >= 760 ? (-143 / W) * (2 * this.D * this.tv * this.cam.aspect) : 0;
    this.cam.updateProjectionMatrix();
  }

  private onPointerDown(e: PointerEvent): void {
    this.drag = { x: e.clientX, r: this.rotT };
    try {
      this.canvas.setPointerCapture(e.pointerId);
    } catch {
      // pointer capture might fail gracefully
    }
  }

  private onPointerMove(e: PointerEvent): void {
    if (this.drag) {
      this.rotT = Math.max(-0.35, Math.min(0.35, this.drag.r + (e.clientX - this.drag.x) / 400));
    }
  }

  private onPointerUp(): void {
    this.drag = null;
  }

  private frame(now: number): void {
    this.raf = requestAnimationFrame(this.frame);

    const t = (now - this.t0) / 1000;
    const ts = Math.min(t, DUR);
    const tt = now / 1000;
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    this.swayU.value = tt;

    // Camera keyframe interpolation
    const K: [number, [number, number, number], [number, number, number]][] = [
      [0, [1, 1.7, 9.5], [0, 1.1, -30]],
      [2.4, [0.4, 1.7, 10.6], [0, 0.9, -14]],
      [5.4, [0, -2.6, this.D], [0, -3.1, 0]],
      [DUR, [0, -5.05, this.D], [0, -5.05, 0]],
    ];

    let kIdx = 0;
    while (kIdx < K.length - 2 && ts > K[kIdx + 1][0]) kIdx++;

    const a = K[kIdx];
    const b = K[kIdx + 1];
    const u = sm((ts - a[0]) / (b[0] - a[0]));
    const lerpArr = (p: number[], q: number[]) => p.map((x, k) => x + (q[k] - x) * u);

    const cp = lerpArr(a[1], b[1]);
    const la = lerpArr(a[2], b[2]);
    this.cam.position.set(cp[0], cp[1], cp[2]);
    this.cam.lookAt(la[0], la[1], la[2]);

    // Foreground drop curtain
    this.frontG.position.y = -15 * sm((ts - 2.4) / 2.8);

    // Slabs separation and organic bobbing
    const gap = GAP * sm((ts - 5.4) / 3.4);
    const fl = gap / GAP;
    let top = 0;

    this.slabs.forEach((s, idx) => {
      const isFocused = this.focusedLayer === idx;
      const focusOffsetZ = isFocused ? 0.6 : 0;
      s.g.position.set(
        0,
        top - s.h / 2 + Math.sin(tt * 0.9 + s.ph) * 0.07 * fl,
        Math.sin(tt * 0.6 + s.ph) * 0.05 * fl + focusOffsetZ
      );
      s.g.rotation.z = Math.sin(tt * 0.55 + s.ph) * 0.006 * fl;
      top -= s.h + gap;
    });

    // Group horizontal rotation with damping
    if (!this.drag) this.rotT *= 0.992;
    this.grp.rotation.y += ((this.rotT + Math.sin(tt * 0.35) * 0.03 * fl) - this.grp.rotation.y) * 0.08;

    // Atmospheric Fog
    const f = sm((ts - 3) / 2.4);
    if (this.scene.fog && this.scene.fog instanceof THREE.Fog) {
      const fc = this.scene.fog.color;
      fc.setRGB(
        HAZE[0] + (DARK[0] - HAZE[0]) * f,
        HAZE[1] + (DARK[1] - HAZE[1]) * f,
        HAZE[2] + (DARK[2] - HAZE[2]) * f
      );
    }

    // Dust motes upward drift
    const dp = this.dust.geometry.attributes.position as THREE.BufferAttribute;
    for (let k = 0; k < dp.count; k++) {
      let yPos = dp.getY(k) + 0.004;
      if (yPos > 2) yPos = -12;
      dp.setY(k, yPos);
    }
    dp.needsUpdate = true;

    // Burst soil crumble particle trigger
    if (this.bst < 0 && ts > 2.5) {
      this.bst = 0;
      const bpAttr = this.burst.geometry.attributes.position as THREE.BufferAttribute;
      for (let k = 0; k < bpAttr.count; k++) {
        bpAttr.setXYZ(k, (Math.random() - 0.5) * 26, 0, 0.2 + Math.random() * 1.5);
        this.burstV[k * 3] = (Math.random() - 0.5) * 0.6;
        this.burstV[k * 3 + 1] = Math.random() * 1.6;
        this.burstV[k * 3 + 2] = Math.random() * 1.4;
      }
    }
    if (this.bst >= 0 && this.bst < 4) {
      this.bst += dt;
      const bpAttr = this.burst.geometry.attributes.position as THREE.BufferAttribute;
      for (let k = 0; k < bpAttr.count; k++) {
        this.burstV[k * 3 + 1] -= 9.8 * dt * 0.35;
        bpAttr.setXYZ(
          k,
          bpAttr.getX(k) + this.burstV[k * 3] * dt * 2,
          bpAttr.getY(k) + this.burstV[k * 3 + 1] * dt,
          bpAttr.getZ(k) + this.burstV[k * 3 + 2] * dt * 2
        );
      }
      bpAttr.needsUpdate = true;
      (this.burst.material as THREE.PointsMaterial).opacity = Math.max(0, 0.75 * (1 - this.bst / 4));
    }

    // Stage tracking & notifications
    const newStage: DiveStage = ts < 2.4 ? "field" : ts < 5.4 ? "underground" : "layers";
    if (newStage !== this.currentStage) {
      this.currentStage = newStage;
      this.onStageChangeCb?.(newStage);
    }

    if (t < DUR) {
      const captionKeys = [
        "ui.dive_caption_field",
        "ui.dive_caption_underground",
        "ui.dive_caption_layers",
      ];
      const stIdx = ts < 2.4 ? 0 : ts < 5.4 ? 1 : 2;
      this.onDiveProgressCb?.(captionKeys[stIdx], true);
    } else if (!this.finished) {
      this.finished = true;
      this.onDiveProgressCb?.(null, false);
      this.updateInspectData();
    }

    // Cattle grazing idle animations
    for (const cow of this.cows) {
      cow.head.rotation.x = 0.22 + Math.sin(tt * 1.4 + cow.phase) * 0.08;
      cow.head.rotation.y = Math.sin(tt * 0.65 + cow.phase) * 0.05;
      cow.tail.rotation.z = Math.sin(tt * 3.2 + cow.phase) * 0.22;
    }

    this.renderer.render(this.scene, this.cam);

    // Emit live telemetry
    this.emitTelemetry();
  }

  public project(layerIndex: number): [number, number] {
    if (layerIndex < 0 || layerIndex >= this.slabs.length) return [0, 0];
    const v = new THREE.Vector3(2.4, 0, 0);
    this.slabs[layerIndex].g.localToWorld(v);
    v.project(this.cam);
    const W = this.canvas.clientWidth || window.innerWidth;
    const H = this.canvas.clientHeight || window.innerHeight;
    return [((v.x + 1) / 2) * W, ((1 - v.y) / 2) * H];
  }

  public loadResult(result: AnalysisResult, forceReload = false): void {
    this.result = result;
    if (forceReload) {
      this.replay();
    } else {
      this.updateInspectData();
      this.emitTelemetry();
    }
  }

  public setStrategy(strategyId: StrategyId | null): void {
    if (strategyId) this.strategyId = strategyId;
    this.updateInspectData();
    this.emitTelemetry();
  }

  public setSeasonTime(dayT: number): void {
    this.dayT = dayT;
    this.emitTelemetry();
  }

  public setTheme(theme: "light" | "dark"): void {
    this.theme = theme;
    if (this.scene.fog && this.scene.fog instanceof THREE.Fog) {
      if (this.theme === "dark") {
        this.scene.fog.color.setRGB(0.08, 0.08, 0.1);
      } else {
        this.scene.fog.color.setRGB(HAZE[0], HAZE[1], HAZE[2]);
      }
    }
  }

  public setQuality(quality: Quality | "auto"): void {
    this.quality = quality;
    if (this.renderer) {
      const maxDpr = this.quality === "high" || this.quality === "auto" ? 2 : this.quality === "medium" ? 1.5 : 1;
      this.renderer.setPixelRatio(Math.min(maxDpr, window.devicePixelRatio || 1));
    }
  }

  public setCameraPreset(preset: CameraPreset): void {
    if (preset === "perspective") {
      this.setDiveStage("layers");
    } else if (preset === "cutaway") {
      this.setDiveStage("underground");
    } else if (preset === "canopy") {
      this.setDiveStage("field");
    }
  }

  public setDiveStage(stage: DiveStage): void {
    this.currentStage = stage;
    this.onStageChangeCb?.(stage);
    if (stage === "field") {
      this.t0 = performance.now();
      this.finished = false;
    } else if (stage === "underground") {
      this.t0 = performance.now() - 3500;
      this.finished = false;
    } else if (stage === "layers") {
      this.t0 = performance.now() - DUR * 1000;
      this.finished = true;
      this.onDiveProgressCb?.(null, false);
      this.updateInspectData();
    }
  }

  public setExploded(exploded: boolean): void {
    this.setDiveStage(exploded ? "layers" : "underground");
  }

  public skipDive(): void {
    this.t0 = performance.now() - DUR * 1000;
    this.finished = true;
    this.onDiveProgressCb?.(null, false);
    this.updateInspectData();
  }

  public replay(): void {
    this.finished = false;
    this.bst = -1;
    (this.burst.material as THREE.PointsMaterial).opacity = 0;
    this.t0 = performance.now();
    this.last = performance.now();
  }

  public focusLayer(idx: number | null): void {
    this.focusedLayer = idx;
    this.onLayerFocusChangeCb?.(idx);
    this.updateInspectData();
  }

  public clearFocus(): void {
    this.focusedLayer = null;
    this.onLayerFocusChangeCb?.(null);
    this.onInspectCb?.(null);
  }

  public getFocusedLayer(): number | null {
    return this.focusedLayer;
  }

  public clearDiveTimeouts(): void {
    // compatibility method
  }

  private updateInspectData(): void {
    if (!this.result || this.focusedLayer === null) {
      return;
    }
    const idx = Math.max(0, Math.min(3, this.focusedLayer));
    const layer = this.result.layers[idx] || {
      top_cm: idx === 0 ? 0 : idx === 1 ? 20 : idx === 2 ? 50 : 90,
      bottom_cm: idx === 0 ? 20 : idx === 1 ? 50 : idx === 2 ? 90 : 150,
      sand: 40,
      silt: 40,
      clay: 20,
      om: 2.5,
      ph: 7.6,
      ec: 1.5,
    };

    const strat =
      this.result.strategies.find((s) => s.id === this.strategyId) ||
      this.result.strategies[0];
    const day = Math.min(
      Math.floor(this.dayT * (strat?.sim?.moisture?.[0]?.length || 365)),
      (strat?.sim?.moisture?.[0]?.length || 365) - 1
    );

    const moistVal = strat?.sim?.moisture?.[idx]?.[day] ?? 0.65;
    const awcPct = Math.round(moistVal * 100);
    const moistStatus: "dry" | "stress" | "optimal" | "saturated" =
      awcPct < 30 ? "dry" : awcPct < 50 ? "stress" : awcPct <= 90 ? "optimal" : "saturated";

    const eceVal = strat?.sim?.ece?.[idx]?.[day] ?? layer.ec ?? 1.5;
    const salStatus: "low" | "moderate" | "high" =
      eceVal < 2 ? "low" : eceVal < 4 ? "moderate" : "high";

    const data: LayerInspectData = {
      layerIndex: idx,
      nameKey: layer.name_key || `ui.layer_${idx}`,
      topCm: layer.top_cm,
      bottomCm: layer.bottom_cm,
      sand: Math.round(layer.sand),
      silt: Math.round(layer.silt),
      clay: Math.round(layer.clay),
      availableWaterPct: awcPct,
      moistureStatus: moistStatus,
      salinityDsm: Number(eceVal.toFixed(1)),
      salinityStatus: salStatus,
      organicMatter: Number(layer.om.toFixed(1)),
    };

    this.onInspectCb?.(data);
  }

  private emitTelemetry(): void {
    if (!this.result) return;
    const strat =
      this.result.strategies.find((s) => s.id === this.strategyId) ||
      this.result.strategies[0];
    if (!strat) return;

    const totalDays = strat.sim?.root_cm?.length || 365;
    const day = Math.min(Math.floor(this.dayT * totalDays), totalDays - 1);

    const cropIdx = strat.sim?.crop_idx?.[day] ?? -1;
    const activeCrop = cropIdx >= 0 ? strat.seasons[cropIdx]?.crop : null;
    const activeSeason = cropIdx >= 0 ? strat.seasons[cropIdx]?.season : null;

    const rootCm = strat.sim?.root_cm?.[day] ?? 0;
    const canopy = strat.sim?.canopy?.[day] ?? 0;
    const rain = this.result.climate?.rain?.[day] ?? 0;
    const et0 = this.result.climate?.et0?.[day] ?? 4.5;
    const tmax = this.result.climate?.tmax?.[day] ?? 28;
    const tmin = this.result.climate?.tmin?.[day] ?? 16;
    const date = this.result.climate?.dates?.[day] ?? "";

    const telemetry: SceneTelemetry = {
      cropId: activeCrop,
      season: activeSeason,
      rootCm: Math.round(rootCm),
      canopyPct: Math.round(canopy * 100),
      et0Mm: Number(et0.toFixed(1)),
      rainMm: Number(rain.toFixed(1)),
      tempC: Math.round((tmax + tmin) / 2),
      date,
      isSynthetic: this.result.climate?.source === "synthetic",
    };

    this.onTelemetryCb?.(telemetry);
  }

  public setOnInspect(cb: (data: LayerInspectData | null) => void): void {
    this.onInspectCb = cb;
  }

  public setOnTelemetry(cb: (data: SceneTelemetry) => void): void {
    this.onTelemetryCb = cb;
  }

  public setOnStageChange(cb: (stage: DiveStage) => void): void {
    this.onStageChangeCb = cb;
  }

  public setOnLayerFocusChange(cb: (idx: number | null) => void): void {
    this.onLayerFocusChangeCb = cb;
  }

  public setOnDiveProgress(cb: (key: string | null, canSkip: boolean) => void): void {
    this.onDiveProgressCb = cb;
  }

  public dispose(): void {
    cancelAnimationFrame(this.raf);
    window.removeEventListener("resize", this.resizeHandler);
    this.canvas.removeEventListener("pointerdown", this.pointerDownHandler);
    this.canvas.removeEventListener("pointermove", this.pointerMoveHandler);
    this.canvas.removeEventListener("pointerup", this.pointerUpHandler);
    this.canvas.removeEventListener("pointercancel", this.pointerUpHandler);

    this.scene.clear();
    this.renderer.dispose();
  }
}
