import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import * as SkeletonUtils from "three/examples/jsm/utils/SkeletonUtils.js";
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
const HAZE = [0.84, 0.92, 0.98]; // clean clear sky blue mist (#d6ebfa)
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
  private cowMixers: { mixer: THREE.AnimationMixer; group: THREE.Object3D }[] = [];
  private palms: { crown: THREE.Group; phase: number }[] = [];
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
    this.scene.fog = new THREE.Fog(0xd6ebfa, 35, 115);

    this.cam = new THREE.PerspectiveCamera(38, 1, 0.1, 120);

    // Lighting (clean daylight without yellow glare)
    const amb = new THREE.AmbientLight(0xffffff, 0.92);
    this.scene.add(amb);

    const dl = new THREE.DirectionalLight(0xffffff, 0.98);
    dl.position.set(-5, 9, 8);
    this.scene.add(dl);

    // Cool sky-fill bounce light
    const rim = new THREE.PointLight(0x98cbf8, 0.55, 35);
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
      x0: -7.0,
      x1: 7.0,
      z0: 0,
      z1: 6.2,
    });

    // Date Palm tree windbreaks (authentic Egyptian Nile Delta farm shelterbelts)
    this.plantDatePalms();

    // Grazing cattle herd (official animated low-poly Cow model from three.js ecosystem)
    this.loadAnimatedCows();

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
        color: 0xdaf0ff,
        size: 0.05,
        transparent: true,
        opacity: 0.45,
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

  private createDatePalmTree(scale = 1): { group: THREE.Group; crown: THREE.Group; phase: number } {
    const group = new THREE.Group();

    // 1. Weathered fibrous trunk with subtle organic curvature
    const trunkH = 7.5 * scale;
    const trunkGeo = new THREE.CylinderGeometry(0.24 * scale, 0.42 * scale, trunkH, 8, 5);
    trunkGeo.translate(0, trunkH / 2, 0);

    const barkMat = new THREE.MeshStandardMaterial({
      color: 0x564332,
      roughness: 0.92,
      flatShading: true,
    });
    const trunk = new THREE.Mesh(trunkGeo, barkMat);
    trunk.rotation.z = (Math.random() - 0.5) * 0.07;
    trunk.rotation.x = (Math.random() - 0.5) * 0.07;
    group.add(trunk);

    // Ring collars representing pruned frond bases (iconic Egyptian date palm rings)
    const ringMat = new THREE.MeshStandardMaterial({
      color: 0x473626,
      roughness: 0.95,
    });
    const numRings = 9;
    for (let r = 1; r <= numRings; r++) {
      const ry = (r / (numRings + 1)) * trunkH;
      const rad = (0.42 - (0.42 - 0.24) * (r / (numRings + 1))) * scale + 0.03 * scale;
      const ringGeo = new THREE.CylinderGeometry(rad, rad, 0.12 * scale, 8);
      const ring = new THREE.Mesh(ringGeo, ringMat);
      ring.position.y = ry;
      trunk.add(ring);
    }

    // 2. Crown Group (sways organically in breeze)
    const crown = new THREE.Group();
    crown.position.set(0, trunkH, 0);
    trunk.add(crown);

    // Frond materials: rich emerald, vibrant mid canopy, and sunlit spear green
    const matFrondLow = new THREE.MeshStandardMaterial({
      color: 0x2a7a1c,
      emissive: 0x0a2406,
      emissiveIntensity: 0.22,
      roughness: 0.55,
      metalness: 0.05,
      side: THREE.DoubleSide,
    });
    const matFrondMid = new THREE.MeshStandardMaterial({
      color: 0x389a24,
      emissive: 0x0d2e08,
      emissiveIntensity: 0.22,
      roughness: 0.55,
      metalness: 0.05,
      side: THREE.DoubleSide,
    });
    const matFrondHigh = new THREE.MeshStandardMaterial({
      color: 0x52b82e,
      emissive: 0x143c0c,
      emissiveIntensity: 0.22,
      roughness: 0.55,
      metalness: 0.05,
      side: THREE.DoubleSide,
    });

    const createFrond = (len: number, pitchDown: number, mat: THREE.Material): THREE.Group => {
      const frond = new THREE.Group();

      // Proximal stem segment
      const seg1Len = len * 0.52;
      const stemGeo1 = new THREE.CylinderGeometry(0.024 * scale, 0.016 * scale, seg1Len, 4);
      stemGeo1.translate(0, seg1Len / 2, 0);
      const stem1 = new THREE.Mesh(stemGeo1, mat);
      frond.add(stem1);

      // Proximal blade (flattened tapered feather leaf)
      const bladeGeo1 = new THREE.ConeGeometry(0.42 * scale, seg1Len, 3);
      bladeGeo1.translate(0, seg1Len / 2, 0);
      const blade1 = new THREE.Mesh(bladeGeo1, mat);
      blade1.scale.set(1, 1, 0.12);
      frond.add(blade1);

      // Distal drooping segment (creates iconic arched silhouette)
      const seg2Len = len * 0.48;
      const seg2 = new THREE.Group();
      seg2.position.set(0, seg1Len, 0);
      seg2.rotation.x = 0.38; // droop further downward

      const stemGeo2 = new THREE.CylinderGeometry(0.016 * scale, 0.008 * scale, seg2Len, 4);
      stemGeo2.translate(0, seg2Len / 2, 0);
      const stem2 = new THREE.Mesh(stemGeo2, mat);
      seg2.add(stem2);

      const bladeGeo2 = new THREE.ConeGeometry(0.35 * scale, seg2Len, 3);
      bladeGeo2.translate(0, seg2Len / 2, 0);
      const blade2 = new THREE.Mesh(bladeGeo2, mat);
      blade2.scale.set(1, 1, 0.1);
      seg2.add(blade2);

      frond.add(seg2);

      frond.rotation.x = pitchDown;
      return frond;
    };

    // Tier 1: Lower drooping mature fronds (8 fronds radiating at ~68° pitch)
    const n1 = 8;
    for (let i = 0; i < n1; i++) {
      const az = (i / n1) * Math.PI * 2 + (Math.random() - 0.5) * 0.2;
      const fGroup = new THREE.Group();
      fGroup.rotation.y = az;
      fGroup.add(createFrond(4.4 * scale, 1.18, matFrondLow));
      crown.add(fGroup);
    }

    // Tier 2: Mid-canopy arching fronds (8 fronds radiating at ~46° pitch)
    const n2 = 8;
    for (let i = 0; i < n2; i++) {
      const az = (i / n2) * Math.PI * 2 + Math.PI / n2 + (Math.random() - 0.5) * 0.2;
      const fGroup = new THREE.Group();
      fGroup.rotation.y = az;
      fGroup.add(createFrond(3.9 * scale, 0.8, matFrondMid));
      crown.add(fGroup);
    }

    // Tier 3: Upper young spear fronds (6 fronds radiating at ~24° pitch)
    const n3 = 6;
    for (let i = 0; i < n3; i++) {
      const az = (i / n3) * Math.PI * 2 + (Math.random() - 0.5) * 0.25;
      const fGroup = new THREE.Group();
      fGroup.rotation.y = az;
      fGroup.add(createFrond(3.1 * scale, 0.42, matFrondHigh));
      crown.add(fGroup);
    }

    // 3. Hanging Date Fruit Bunches (عراجين البلح)
    const dateMat = new THREE.MeshStandardMaterial({
      color: 0xd66d18, // ripe golden amber date
      roughness: 0.65,
    });
    const stalkMat = new THREE.MeshStandardMaterial({
      color: 0x9b541a,
      roughness: 0.8,
    });

    const numClusters = 3;
    for (let c = 0; c < numClusters; c++) {
      const clusterGroup = new THREE.Group();
      const az = (c / numClusters) * Math.PI * 2 + 0.5;
      clusterGroup.rotation.y = az;

      // Arched stalk hanging down
      const stalkGeo = new THREE.CylinderGeometry(0.02 * scale, 0.015 * scale, 0.65 * scale, 4);
      stalkGeo.translate(0, -0.32 * scale, 0);
      const stalk = new THREE.Mesh(stalkGeo, stalkMat);
      stalk.rotation.x = 0.55;
      clusterGroup.add(stalk);

      // Heavy cluster of dates hanging from stalk
      const clusterGeo = new THREE.ConeGeometry(0.3 * scale, 0.7 * scale, 6);
      clusterGeo.translate(0, -0.35 * scale, 0);
      const clusterMesh = new THREE.Mesh(clusterGeo, dateMat);
      clusterMesh.position.set(0, -0.6 * scale, 0.35 * scale);
      clusterMesh.rotation.x = Math.PI; // hangs downward
      clusterGroup.add(clusterMesh);

      crown.add(clusterGroup);
    }

    return {
      group,
      crown,
      phase: Math.random() * Math.PI * 2,
    };
  }

  private plantDatePalms(): void {
    // Left boundary canal line along main field (slabs[0])
    for (let z = -50; z <= -4; z += 5.8) {
      const s = 0.9 + Math.random() * 0.35;
      const palm = this.createDatePalmTree(s);
      const jx = (Math.random() - 0.5) * 1.2;
      const jz = (Math.random() - 0.5) * 1.0;
      palm.group.position.set(-26.2 + jx, HT[0] / 2, z + jz);
      palm.group.rotation.y = Math.random() * Math.PI * 2;
      this.slabs[0].g.add(palm.group);
      this.palms.push(palm);
    }

    // Right boundary canal line along main field (slabs[0])
    for (let z = -50; z <= -4; z += 5.8) {
      const s = 0.9 + Math.random() * 0.35;
      const palm = this.createDatePalmTree(s);
      const jx = (Math.random() - 0.5) * 1.2;
      const jz = (Math.random() - 0.5) * 1.0;
      palm.group.position.set(26.2 + jx, HT[0] / 2, z + jz);
      palm.group.rotation.y = Math.random() * Math.PI * 2;
      this.slabs[0].g.add(palm.group);
      this.palms.push(palm);
    }

    // Horizon date palm grove along the rear edge of the field
    for (let x = -26; x <= 26; x += 4.2) {
      const s = 0.95 + Math.random() * 0.45;
      const palm = this.createDatePalmTree(s);
      const jx = (Math.random() - 0.5) * 1.0;
      const jz = (Math.random() - 0.5) * 1.4;
      palm.group.position.set(x + jx, HT[0] / 2, -53 + jz);
      palm.group.rotation.y = Math.random() * Math.PI * 2;
      this.slabs[0].g.add(palm.group);
      this.palms.push(palm);
    }

    // Foreground date palms on frontG framing Act 1 camera view
    for (let z = 3; z <= 14; z += 5.5) {
      // Left foreground
      const sL = 0.92 + Math.random() * 0.3;
      const palmL = this.createDatePalmTree(sL);
      palmL.group.position.set(-25.5 + (Math.random() - 0.5) * 1.0, 0, z);
      palmL.group.rotation.y = Math.random() * Math.PI * 2;
      this.frontG.add(palmL.group);
      this.palms.push(palmL);

      // Right foreground
      const sR = 0.92 + Math.random() * 0.3;
      const palmR = this.createDatePalmTree(sR);
      palmR.group.position.set(25.5 + (Math.random() - 0.5) * 1.0, 0, z);
      palmR.group.rotation.y = Math.random() * Math.PI * 2;
      this.frontG.add(palmR.group);
      this.palms.push(palmR);
    }
  }

  private loadAnimatedCows(): void {
    const loader = new GLTFLoader();
    loader.load(
      "/models/cow.glb",
      (gltf) => {
        const baseScene = gltf.scene;
        const idleClip =
          gltf.animations.find((a) => a.name === "Idle") || gltf.animations[0];

        baseScene.traverse((child) => {
          if (child instanceof THREE.Mesh) {
            child.castShadow = true;
            child.receiveShadow = true;
          }
        });

        const spawnCow = (
          parent: THREE.Object3D,
          x: number,
          y: number,
          z: number,
          rotY: number,
          scale: number
        ) => {
          const cow = SkeletonUtils.clone(baseScene);
          cow.position.set(x, y, z);
          cow.rotation.y = rotY;
          cow.scale.set(scale, scale, scale);
          parent.add(cow);

          if (idleClip) {
            const mixer = new THREE.AnimationMixer(cow);
            const action = mixer.clipAction(idleClip);
            action.play();
            // Desynchronize idle grazing timing across herd
            mixer.setTime(Math.random() * 3.0);
            this.cowMixers.push({ mixer, group: cow });
          }
        };

        // 1. Immediate foreground pasture paddock (frontG, 5-7m from camera, right in Act 1 sweet spot)
        // Mother Holstein Cow (majestic & prominent, center-left)
        spawnCow(this.frontG, -1.8, 0, 2.5, 0.85, 0.42);
        // Playful Calf grazing next to mother
        spawnCow(this.frontG, -0.4, 0, 3.2, 1.25, 0.25);
        // Companion Holstein Cow (grazing sideways, center-right)
        spawnCow(this.frontG, 2.5, 0, 1.8, -2.1, 0.40);
        // Second Cow in right foreground
        spawnCow(this.frontG, 3.8, 0, 3.6, -1.2, 0.38);
        // Cow in left foreground
        spawnCow(this.frontG, -3.9, 0, 4.2, 2.4, 0.37);

        // 2. Main agricultural field & grazing margins (slabs[0].g, tiered midground & horizon)
        spawnCow(this.slabs[0].g, 4.8, HT[0] / 2, -4.5, -1.6, 0.35);
        spawnCow(this.slabs[0].g, -5.2, HT[0] / 2, -7.0, 1.8, 0.34);
        spawnCow(this.slabs[0].g, 9.0, HT[0] / 2, -14.0, -1.1, 0.32);
        spawnCow(this.slabs[0].g, -9.5, HT[0] / 2, -18.0, 0.85, 0.31);
        spawnCow(this.slabs[0].g, 2.2, HT[0] / 2, -26.0, -0.4, 0.29);
      },
      undefined,
      (err) => {
        console.warn("Failed to load cow.glb:", err);
      }
    );
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

    // Update animated cattle models
    for (const c of this.cowMixers) {
      c.mixer.update(dt);
    }

    // Subtle Egyptian breeze swaying palm crowns
    for (const palm of this.palms) {
      palm.crown.rotation.z = Math.sin(tt * 1.3 + palm.phase) * 0.025;
      palm.crown.rotation.x = Math.cos(tt * 0.95 + palm.phase) * 0.02;
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

    for (const c of this.cowMixers) {
      c.mixer.stopAllAction();
    }
    this.cowMixers = [];
    this.palms = [];

    this.scene.clear();
    this.renderer.dispose();
  }
}
