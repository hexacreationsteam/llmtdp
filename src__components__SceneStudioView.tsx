import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';
import { ChevronDown, ChevronUp, Layers, RotateCcw } from 'lucide-react';

type FinishId = 'titanium' | 'obsidian' | 'cobalt';
type CameraPresetId = 'hero' | 'top' | 'detail';
type MotionSpeed = 'paused' | 'calm' | 'active';

interface ExplodablePart {
  object: THREE.Object3D;
  baseY: number;
  offsetY: number;
  partLabel: string;
}

const FINISH_PALETTES: Record<
  FinishId,
  {
    label: string;
    primaryHex: number;
    accentHex: number;
    coreHex: number;
    emissiveHex: number;
  }
> = {
  titanium: {
    label: 'Brushed Titanium',
    primaryHex: 0x3b4454,
    accentHex: 0xd4a857,
    coreHex: 0x38bdf8,
    emissiveHex: 0x0284c7,
  },
  obsidian: {
    label: 'Obsidian Brass',
    primaryHex: 0x1b2029,
    accentHex: 0xe29d52,
    coreHex: 0xf59e0b,
    emissiveHex: 0xb45309,
  },
  cobalt: {
    label: 'Cobalt Anodized',
    primaryHex: 0x1d3557,
    accentHex: 0x94a3b8,
    coreHex: 0x60a5fa,
    emissiveHex: 0x2563eb,
  },
};

const CAMERA_PRESETS: Record<
  CameraPresetId,
  { label: string; pos: [number, number, number]; target: [number, number, number] }
> = {
  hero: { label: 'Hero', pos: [5.4, 3.5, 6.2], target: [0, 0.95, 0] },
  top: { label: 'Top Dial', pos: [0.05, 6.6, 1.35], target: [0, 0.85, 0] },
  detail: { label: 'Core Close', pos: [2.4, 2.0, 2.7], target: [0, 1.45, 0] },
};

// Module-scope reusable helpers (zero GC inside animation tick)
const _tmpColor = new THREE.Color();
const _rayMouse = new THREE.Vector2();

function detectSoftwareWebGL(): boolean {
  try {
    const probeCanvas = document.createElement('canvas');
    const gl = probeCanvas.getContext('webgl2');
    if (!gl) return true;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
    const rendererStr = String(gl.getParameter(param) ?? '');
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(rendererStr);
  } catch {
    return true;
  }
}

function createBrushedMetalTexture(maxAnisotropy: number): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = '#808080';
    ctx.fillRect(0, 0, 256, 256);
    for (let y = 0; y < 256; y += 1) {
      const shade = 112 + Math.floor((Math.sin(y * 1.7) * 0.5 + 0.5) * 32);
      ctx.fillStyle = `rgb(${shade},${shade},${shade})`;
      ctx.fillRect(0, y, 256, 1);
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = maxAnisotropy;
  return tex;
}

function createDialReticleTexture(maxAnisotropy: number): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = '#0f141e';
    ctx.fillRect(0, 0, 512, 512);
    const cx = 256;
    const cy = 256;
    ctx.strokeStyle = '#334155';
    ctx.lineWidth = 2;
    for (const r of [90, 145, 200, 236]) {
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.strokeStyle = '#60a5fa';
    for (let i = 0; i < 36; i += 1) {
      const a = (i / 36) * Math.PI * 2;
      const inner = i % 3 === 0 ? 185 : 194;
      ctx.lineWidth = i % 3 === 0 ? 3 : 1.5;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * inner, cy + Math.sin(a) * inner);
      ctx.lineTo(cx + Math.cos(a) * 204, cy + Math.sin(a) * 204);
      ctx.stroke();
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = maxAnisotropy;
  return tex;
}

function createContactShadowTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const grad = ctx.createRadialGradient(128, 128, 18, 128, 128, 128);
    grad.addColorStop(0, 'rgba(0, 0, 0, 0.72)');
    grad.addColorStop(0.55, 'rgba(0, 0, 0, 0.28)');
    grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 256, 256);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function tagInspectable(obj: THREE.Object3D, label: string): void {
  obj.traverse((child) => {
    child.layers.enable(1);
    child.userData.partLabel = label;
  });
}

export function SceneStudioView() {
  const mountRef = useRef<HTMLDivElement | null>(null);

  const [finish, setFinish] = useState<FinishId>('titanium');
  const [explodeTarget, setExplodeTarget] = useState(0);
  const [motionSpeed, setMotionSpeed] = useState<MotionSpeed>('calm');
  const [selectedPart, setSelectedPart] = useState<string>('Full Neural Core Assembly');
  const [dockCollapsed, setDockCollapsed] = useState(false);

  const controlsStateRef = useRef<{
    finish: FinishId;
    explodeTarget: number;
    motionSpeed: MotionSpeed;
    cameraGoal: { pos: THREE.Vector3; target: THREE.Vector3 } | null;
  }>({
    finish: 'titanium',
    explodeTarget: 0,
    motionSpeed: 'calm',
    cameraGoal: null,
  });

  useEffect(() => {
    controlsStateRef.current.finish = finish;
  }, [finish]);

  useEffect(() => {
    controlsStateRef.current.explodeTarget = explodeTarget;
  }, [explodeTarget]);

  useEffect(() => {
    controlsStateRef.current.motionSpeed = motionSpeed;
  }, [motionSpeed]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'h' || e.key === 'H') {
        const tag = (e.target as HTMLElement)?.tagName;
        if (tag !== 'INPUT' && tag !== 'TEXTAREA') {
          setDockCollapsed((prev) => !prev);
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const isSoftwareGl = detectSoftwareWebGL();

    const width = container.clientWidth || window.innerWidth;
    const height = container.clientHeight || window.innerHeight;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0b0e14);
    scene.fog = new THREE.FogExp2(0x0b0e14, 0.042);

    const camera = new THREE.PerspectiveCamera(42, width / height, 0.1, 100);
    camera.position.set(...CAMERA_PRESETS.hero.pos);

    const renderer = new THREE.WebGLRenderer({
      antialias: !isSoftwareGl,
      powerPreference: 'high-performance',
    });
    renderer.setSize(width, height);
    renderer.setPixelRatio(isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;
    renderer.shadowMap.enabled = !isSoftwareGl;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(renderer.domElement);

    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    const roomEnv = new RoomEnvironment();
    const envTarget = pmremGenerator.fromScene(roomEnv, 0.04);
    scene.environment = envTarget.texture;
    roomEnv.dispose();
    pmremGenerator.dispose();

    const maxAnisotropy = renderer.capabilities.getMaxAnisotropy();
    const brushedRoughTex = createBrushedMetalTexture(maxAnisotropy);
    const dialTex = createDialReticleTexture(maxAnisotropy);
    const contactShadowTex = createContactShadowTexture();

    // Studio 3-Point Lighting Rig (<= 3 shadow casters)
    const hemiLight = new THREE.HemisphereLight(0x9bc4ff, 0x161b26, 0.85);
    scene.add(hemiLight);

    const keyLight = new THREE.DirectionalLight(0xfff1dc, 2.3);
    keyLight.position.set(5.5, 8.0, 4.5);
    keyLight.castShadow = !isSoftwareGl;
    keyLight.shadow.mapSize.width = 1024;
    keyLight.shadow.mapSize.height = 1024;
    keyLight.shadow.camera.near = 0.5;
    keyLight.shadow.camera.far = 25;
    keyLight.shadow.camera.left = -5.5;
    keyLight.shadow.camera.right = 5.5;
    keyLight.shadow.camera.top = 5.5;
    keyLight.shadow.camera.bottom = -5.5;
    keyLight.shadow.bias = -0.0005;
    keyLight.shadow.normalBias = 0.02;
    scene.add(keyLight);

    const rimLight = new THREE.DirectionalLight(0x60a5fa, 1.35);
    rimLight.position.set(-5.0, 4.5, -5.0);
    scene.add(rimLight);

    if (!isSoftwareGl) {
      RectAreaLightUniformsLib.init();
      const softbox = new THREE.RectAreaLight(0xffffff, 2.2, 4.5, 2.0);
      softbox.position.set(0, 5.2, 4.2);
      softbox.lookAt(0, 1.4, 0);
      scene.add(softbox);
    }

    // Studio Ground & Contact Shadow
    const disposables: Array<{ dispose: () => void }> = [
      envTarget,
      brushedRoughTex,
      dialTex,
      contactShadowTex,
    ];

    const floorGeo = new THREE.CircleGeometry(28, 64);
    const floorMat = new THREE.MeshStandardMaterial({
      color: 0x0f141e,
      roughness: 0.78,
      metalness: 0.15,
    });
    const floorMesh = new THREE.Mesh(floorGeo, floorMat);
    floorMesh.rotation.x = -Math.PI / 2;
    floorMesh.position.y = 0;
    floorMesh.receiveShadow = true;
    scene.add(floorMesh);
    disposables.push(floorGeo, floorMat);

    const shadowGeo = new THREE.PlaneGeometry(5.2, 5.2);
    const shadowMat = new THREE.MeshBasicMaterial({
      map: contactShadowTex,
      transparent: true,
      depthWrite: false,
      opacity: 0.5,
    });
    const shadowPlane = new THREE.Mesh(shadowGeo, shadowMat);
    shadowPlane.rotation.x = -Math.PI / 2;
    shadowPlane.position.y = 0.015;
    scene.add(shadowPlane);
    disposables.push(shadowGeo, shadowMat);

    // Hero Composite 9-Part Procedural Assembly (pivoted flush on ground y=0)
    const assemblyGroup = new THREE.Group();
    scene.add(assemblyGroup);

    const palette = FINISH_PALETTES[controlsStateRef.current.finish];

    const primaryMat = new THREE.MeshPhysicalMaterial({
      color: palette.primaryHex,
      metalness: 0.78,
      roughness: 0.36,
      roughnessMap: brushedRoughTex,
      anisotropy: 0.8,
      clearcoat: 0.25,
    });
    const accentMat = new THREE.MeshPhysicalMaterial({
      color: palette.accentHex,
      metalness: 0.94,
      roughness: 0.14,
      anisotropy: 0.85,
    });
    const matteSlateMat = new THREE.MeshStandardMaterial({
      color: 0x161c27,
      metalness: 0.2,
      roughness: 0.72,
    });
    const conduitMat = new THREE.MeshStandardMaterial({
      color: 0x263143,
      metalness: 0.35,
      roughness: 0.58,
    });
    const coreUniforms = { uTime: { value: 0 } };
    const coreMat = new THREE.MeshStandardMaterial({
      color: palette.coreHex,
      emissive: palette.emissiveHex,
      emissiveIntensity: 1.15,
      metalness: 0.45,
      roughness: 0.22,
    });
    coreMat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = coreUniforms.uTime;
      shader.vertexShader =
        'uniform float uTime;\n' +
        shader.vertexShader.replace(
          '#include <begin_vertex>',
          `
          #include <begin_vertex>
          float ripple = sin(position.y * 6.0 + uTime * 2.4) * cos(position.x * 5.0 - uTime * 1.8) * 0.032;
          transformed += normal * ripple;
          `,
        );
    };

    const domeMat = new THREE.MeshPhysicalMaterial({
      color: 0xdbeafe,
      metalness: 0.05,
      roughness: 0.08,
      transmission: isSoftwareGl ? 0 : 0.9,
      transparent: true,
      opacity: isSoftwareGl ? 0.32 : 1,
      ior: 1.56,
      thickness: 1.1,
      clearcoat: 1.0,
      depthWrite: false,
    });

    disposables.push(primaryMat, accentMat, matteSlateMat, conduitMat, coreMat, domeMat);

    const explodables: ExplodablePart[] = [];

    // 1. Stepped Lathe Plinth (bottom at y = 0)
    const plinthPoints = [
      new THREE.Vector2(0.01, 0),
      new THREE.Vector2(1.95, 0),
      new THREE.Vector2(1.95, 0.14),
      new THREE.Vector2(1.76, 0.24),
      new THREE.Vector2(1.68, 0.24),
      new THREE.Vector2(1.62, 0.36),
      new THREE.Vector2(0.01, 0.36),
    ];
    const plinthGeo = new THREE.LatheGeometry(plinthPoints, 64);
    const plinthMesh = new THREE.Mesh(plinthGeo, primaryMat);
    plinthMesh.castShadow = true;
    plinthMesh.receiveShadow = true;
    tagInspectable(plinthMesh, 'Machined Chassis Plinth');
    assemblyGroup.add(plinthMesh);
    disposables.push(plinthGeo);

    // 2. Precision Calibration Reticle Deck (offset slightly for zero Z-fighting)
    const reticleGeo = new THREE.CircleGeometry(1.56, 64);
    const reticleMat = new THREE.MeshStandardMaterial({
      map: dialTex,
      roughness: 0.45,
      metalness: 0.4,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });
    const reticleMesh = new THREE.Mesh(reticleGeo, reticleMat);
    reticleMesh.rotation.x = -Math.PI / 2;
    reticleMesh.position.y = 0.368;
    reticleMesh.receiveShadow = true;
    tagInspectable(reticleMesh, 'Telemetry Calibration Deck');
    assemblyGroup.add(reticleMesh);
    disposables.push(reticleGeo, reticleMat);

    // 3. Instanced Radial Heatsink Fin Array (28 beveled extruded blades)
    const finShape = new THREE.Shape();
    finShape.moveTo(0, 0);
    finShape.lineTo(0.32, 0);
    finShape.lineTo(0.28, 0.26);
    finShape.lineTo(0.04, 0.32);
    finShape.closePath();
    const finGeo = new THREE.ExtrudeGeometry(finShape, {
      depth: 0.045,
      bevelEnabled: true,
      bevelThickness: 0.01,
      bevelSize: 0.01,
      bevelSegments: 2,
    });
    finGeo.center();
    const finCount = 28;
    const finInstanced = new THREE.InstancedMesh(finGeo, matteSlateMat, finCount);
    finInstanced.castShadow = true;
    finInstanced.receiveShadow = true;
    const dummy = new THREE.Object3D();
    for (let i = 0; i < finCount; i += 1) {
      const angle = (i / finCount) * Math.PI * 2;
      const r = 1.46;
      dummy.position.set(Math.cos(angle) * r, 0.52, Math.sin(angle) * r);
      dummy.rotation.set(0, -angle, 0);
      const scaleJitter = 0.96 + (i % 3) * 0.04;
      dummy.scale.set(scaleJitter, scaleJitter, 1);
      dummy.updateMatrix();
      finInstanced.setMatrixAt(i, dummy.matrix);
      _tmpColor.setHSL(0.6, 0.14, 0.14 + (i % 4) * 0.025);
      finInstanced.setColorAt(i, _tmpColor);
    }
    finInstanced.instanceMatrix.needsUpdate = true;
    if (finInstanced.instanceColor) finInstanced.instanceColor.needsUpdate = true;
    finInstanced.computeBoundingSphere();
    tagInspectable(finInstanced, 'Thermal Dissipation Fin Array (28x)');
    assemblyGroup.add(finInstanced);
    explodables.push({ object: finInstanced, baseY: 0, offsetY: 0.32, partLabel: 'Heatsink Array' });
    disposables.push(finGeo);

    // 4. Instanced Hex Socket Fasteners (16 bolts)
    const boltGeo = new THREE.CylinderGeometry(0.036, 0.036, 0.05, 6);
    const boltInstanced = new THREE.InstancedMesh(boltGeo, accentMat, 16);
    for (let i = 0; i < 16; i += 1) {
      const a = (i / 16) * Math.PI * 2;
      dummy.position.set(Math.cos(a) * 1.82, 0.25, Math.sin(a) * 1.82);
      dummy.rotation.set(0, a, 0);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      boltInstanced.setMatrixAt(i, dummy.matrix);
    }
    boltInstanced.instanceMatrix.needsUpdate = true;
    boltInstanced.computeBoundingSphere();
    tagInspectable(boltInstanced, 'Anodized Torque Fasteners');
    assemblyGroup.add(boltInstanced);
    disposables.push(boltGeo);

    // 5. Chamfered Brass Collar Ring
    const collarGeo = new THREE.TorusGeometry(1.16, 0.075, 24, 72);
    const collarMesh = new THREE.Mesh(collarGeo, accentMat);
    collarMesh.rotation.x = Math.PI / 2;
    collarMesh.position.y = 0.64;
    collarMesh.castShadow = true;
    tagInspectable(collarMesh, 'Harmonic Brass Collar');
    assemblyGroup.add(collarMesh);
    explodables.push({ object: collarMesh, baseY: 0.64, offsetY: 0.48, partLabel: 'Harmonic Collar' });
    disposables.push(collarGeo);

    // 6. 4 Beveled Vertical Support Stanchions
    const strutShape = new THREE.Shape();
    strutShape.moveTo(-0.08, 0);
    strutShape.lineTo(0.08, 0);
    strutShape.lineTo(0.05, 1.38);
    strutShape.lineTo(-0.05, 1.38);
    strutShape.closePath();
    const strutGeo = new THREE.ExtrudeGeometry(strutShape, {
      depth: 0.11,
      bevelEnabled: true,
      bevelSize: 0.015,
      bevelThickness: 0.015,
      bevelSegments: 2,
    });
    strutGeo.translate(0, 0, -0.055);
    const strutGroup = new THREE.Group();
    for (let i = 0; i < 4; i += 1) {
      const angle = (i * Math.PI) / 2 + Math.PI / 4;
      const strut = new THREE.Mesh(strutGeo, primaryMat);
      strut.position.set(Math.cos(angle) * 1.08, 0.42, Math.sin(angle) * 1.08);
      strut.rotation.y = -angle;
      strut.rotation.z = 0.12;
      strut.castShadow = true;
      strutGroup.add(strut);
    }
    tagInspectable(strutGroup, 'Structural Stanchion Yoke');
    assemblyGroup.add(strutGroup);
    explodables.push({ object: strutGroup, baseY: 0, offsetY: 0.65, partLabel: 'Stanchion Yoke' });
    disposables.push(strutGeo);

    // 7. Nested Magnetic Gyroscope Gimbal Rings + Polyhedral Neural Core
    const gimbalGroup = new THREE.Group();
    gimbalGroup.position.y = 1.42;
    const outerGimbalGeo = new THREE.TorusGeometry(0.64, 0.032, 20, 72);
    const innerGimbalGeo = new THREE.TorusGeometry(0.49, 0.025, 20, 64);
    const coreGeo = new THREE.IcosahedronGeometry(0.28, 3);
    const eqBandGeo = new THREE.TorusGeometry(0.34, 0.016, 16, 48);

    const outerGimbal = new THREE.Mesh(outerGimbalGeo, primaryMat);
    const innerGimbal = new THREE.Mesh(innerGimbalGeo, accentMat);
    const coreMesh = new THREE.Mesh(coreGeo, coreMat);
    const eqBandMesh = new THREE.Mesh(eqBandGeo, accentMat);
    eqBandMesh.rotation.x = Math.PI / 2;

    outerGimbal.castShadow = true;
    innerGimbal.castShadow = true;
    coreMesh.castShadow = true;

    gimbalGroup.add(outerGimbal, innerGimbal, coreMesh, eqBandMesh);
    tagInspectable(gimbalGroup, 'Suspended Neural Core & Gimbals');
    assemblyGroup.add(gimbalGroup);
    explodables.push({ object: gimbalGroup, baseY: 1.42, offsetY: 0.95, partLabel: 'Neural Core' });
    disposables.push(outerGimbalGeo, innerGimbalGeo, coreGeo, eqBandGeo);

    // 8. Optical Glass Containment Dome
    const domePoints: THREE.Vector2[] = [];
    for (let i = 0; i <= 24; i += 1) {
      const t = (i / 24) * (Math.PI / 2);
      domePoints.push(new THREE.Vector2(Math.cos(t) * 1.12, Math.sin(t) * 1.48));
    }
    const domeGeo = new THREE.LatheGeometry(domePoints, 56);
    const domeMesh = new THREE.Mesh(domeGeo, domeMat);
    domeMesh.position.y = 0.72;
    domeMesh.renderOrder = 4;
    tagInspectable(domeMesh, 'Borosilicate Containment Bell');
    assemblyGroup.add(domeMesh);
    explodables.push({ object: domeMesh, baseY: 0.72, offsetY: 1.55, partLabel: 'Containment Dome' });
    disposables.push(domeGeo);

    // 9. Braided Power & Data Conduits (TubeGeometry)
    const conduitGroup = new THREE.Group();
    for (let i = 0; i < 4; i += 1) {
      const a = (i * Math.PI) / 2;
      const curve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(Math.cos(a) * 1.16, 0.62, Math.sin(a) * 1.16),
        new THREE.Vector3(Math.cos(a) * 1.64, 0.44, Math.sin(a) * 1.64),
        new THREE.Vector3(Math.cos(a) * 2.08, 0.11, Math.sin(a) * 2.08),
        new THREE.Vector3(Math.cos(a) * 2.48, 0.032, Math.sin(a) * 2.48),
      ]);
      const tubeGeo = new THREE.TubeGeometry(curve, 24, 0.032, 10, false);
      const tubeMesh = new THREE.Mesh(tubeGeo, conduitMat);
      tubeMesh.castShadow = true;
      conduitGroup.add(tubeMesh);
      disposables.push(tubeGeo);
    }
    tagInspectable(conduitGroup, 'Shielded Power Conduits');
    assemblyGroup.add(conduitGroup);

    // Pre-warm shaders cleanly on GPU
    if (!isSoftwareGl) {
      renderer.compile(scene, camera);
    }

    // OrbitControls with damping (disabled on software WebGL)
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(...CAMERA_PRESETS.hero.target);
    controls.enableDamping = !isSoftwareGl;
    controls.dampingFactor = 0.06;
    controls.minDistance = 2.4;
    controls.maxDistance = 12;
    controls.maxPolarAngle = Math.PI / 2 - 0.04;
    controls.update();

    controls.addEventListener('start', () => {
      controlsStateRef.current.cameraGoal = null;
    });

    // Raycasting on dedicated layer 1
    const raycaster = new THREE.Raycaster();
    raycaster.layers.set(1);
    let lastHoverTime = 0;

    const updateMouseNDC = (e: PointerEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      _rayMouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      _rayMouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    };

    const handlePointerMove = (e: PointerEvent) => {
      const now = performance.now();
      if (now - lastHoverTime < 65) return;
      lastHoverTime = now;
      updateMouseNDC(e);
      raycaster.setFromCamera(_rayMouse, camera);
      const hits = raycaster.intersectObjects(assemblyGroup.children, true);
      renderer.domElement.style.cursor = hits.length > 0 ? 'pointer' : 'grab';
    };

    const handlePointerClick = (e: MouseEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      _rayMouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      _rayMouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(_rayMouse, camera);
      const hits = raycaster.intersectObjects(assemblyGroup.children, true);
      if (hits.length > 0) {
        const hitObj = hits[0].object;
        const label =
          typeof hitObj.userData.partLabel === 'string'
            ? hitObj.userData.partLabel
            : 'Core Component';
        setSelectedPart(label);
      } else {
        setSelectedPart('Full Neural Core Assembly');
      }
    };

    renderer.domElement.addEventListener('pointermove', handlePointerMove);
    renderer.domElement.addEventListener('click', handlePointerClick);

    const handleResize = () => {
      if (!container) return;
      const w = container.clientWidth || window.innerWidth;
      const h = container.clientHeight || window.innerHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    window.addEventListener('resize', handleResize);

    // Continuous Animation Loop with Software-WebGL Pacing
    let frameId = 0;
    let disposed = false;
    let lastTime = performance.now();
    let currentExplode = 0;
    let appliedFinish: FinishId = controlsStateRef.current.finish;

    const afterDraw = (cb: () => void) => {
      const gl = renderer.getContext() as WebGL2RenderingContext;
      const sync = gl.fenceSync ? gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0) : null;
      gl.flush();
      const poll = () => {
        if (disposed) return;
        const state = sync && gl.getSyncParameter(sync, gl.SYNC_STATUS);
        if (sync && state === gl.UNSIGNALED) {
          frameId = window.setTimeout(poll, 5);
        } else {
          if (sync) gl.deleteSync(sync);
          frameId = window.setTimeout(cb, 80);
        }
      };
      frameId = window.setTimeout(poll, 5);
    };

    const tick = () => {
      if (disposed) return;
      const now = performance.now();
      const dt = Math.min((now - lastTime) / 1000, 0.1);
      lastTime = now;

      const state = controlsStateRef.current;

      // Finish updates
      if (state.finish !== appliedFinish) {
        appliedFinish = state.finish;
        const pal = FINISH_PALETTES[appliedFinish];
        primaryMat.color.setHex(pal.primaryHex);
        accentMat.color.setHex(pal.accentHex);
        coreMat.color.setHex(pal.coreHex);
        coreMat.emissive.setHex(pal.emissiveHex);
      }

      // Smooth damped exploded-view separation
      currentExplode = THREE.MathUtils.damp(currentExplode, state.explodeTarget, 6.5, dt);
      for (const item of explodables) {
        item.object.position.y = item.baseY + item.offsetY * currentExplode;
      }

      // Smooth damped camera preset transitions
      if (state.cameraGoal) {
        const dampFactor = 1 - Math.exp(-5.5 * dt);
        camera.position.lerp(state.cameraGoal.pos, dampFactor);
        controls.target.lerp(state.cameraGoal.target, dampFactor);
        if (camera.position.distanceTo(state.cameraGoal.pos) < 0.025) {
          state.cameraGoal = null;
        }
      }

      // Kinetic motion
      const speedMult =
        state.motionSpeed === 'paused' ? 0 : state.motionSpeed === 'active' ? 1.85 : 0.75;
      if (speedMult > 0) {
        coreUniforms.uTime.value += dt * speedMult;
        outerGimbal.rotation.x += dt * 0.42 * speedMult;
        outerGimbal.rotation.y += dt * 0.28 * speedMult;
        innerGimbal.rotation.y -= dt * 0.65 * speedMult;
        innerGimbal.rotation.z += dt * 0.34 * speedMult;
        coreMesh.rotation.y += dt * 0.52 * speedMult;
        eqBandMesh.rotation.z -= dt * 0.85 * speedMult;
      }

      controls.update();
      renderer.render(scene, camera);

      if (isSoftwareGl) {
        afterDraw(tick);
      } else {
        frameId = requestAnimationFrame(tick);
      }
    };

    tick();

    return () => {
      disposed = true;
      cancelAnimationFrame(frameId);
      clearTimeout(frameId);
      window.removeEventListener('resize', handleResize);
      renderer.domElement.removeEventListener('pointermove', handlePointerMove);
      renderer.domElement.removeEventListener('click', handlePointerClick);
      controls.dispose();
      for (const item of disposables) {
        item.dispose();
      }
      renderer.dispose();
      if (renderer.domElement.parentNode === container) {
        container.removeChild(renderer.domElement);
      }
    };
  }, []);

  const applyCameraPreset = (presetId: CameraPresetId) => {
    const preset = CAMERA_PRESETS[presetId];
    controlsStateRef.current.cameraGoal = {
      pos: new THREE.Vector3(...preset.pos),
      target: new THREE.Vector3(...preset.target),
    };
  };

  return (
    <div className="relative h-full w-full overflow-hidden bg-[#0B0E14]">
      {/* Isolated WebGL canvas container (never re-rendered on React HUD state updates) */}
      <div
        ref={mountRef}
        data-testid="three-canvas-container"
        className="absolute inset-0 h-full w-full"
      />

      {/* Minimal Top-Left Title / Spec Badge (No backdrop-filter, no animated dots) */}
      <div className="pointer-events-none absolute left-4 top-4 z-10 max-w-xs rounded-lg border border-slate-800 bg-[#0F131B]/95 px-3.5 py-2.5 text-slate-100 shadow-lg">
        <div className="flex items-center gap-2 text-xs font-medium text-blue-400">
          <Layers className="h-3.5 w-3.5" />
          <span>LocalForge 3D Hardware Core</span>
        </div>
        <p className="mt-1 font-display text-sm font-semibold text-white">
          {selectedPart}
        </p>
        <p className="mt-0.5 text-[11px] text-slate-400">
          Drag to orbit · Scroll to zoom · Click any assembly part
        </p>
      </div>

      {/* Collapsible Unified Bottom Control Dock */}
      <div className="pointer-events-none absolute bottom-3 left-1/2 z-20 flex w-[min(900px,96%)] -translate-x-1/2 flex-col items-center">
        <button
          type="button"
          onClick={() => setDockCollapsed((v) => !v)}
          className="pointer-events-auto mb-1.5 inline-flex items-center gap-1.5 rounded-full border border-slate-700 bg-[#0F131B]/95 px-3 py-1 text-[11px] font-medium text-slate-200 shadow-md hover:bg-[#171E2B]"
        >
          {dockCollapsed ? (
            <>
              <ChevronUp className="h-3.5 w-3.5" />
              <span>Show Controls (H)</span>
            </>
          ) : (
            <>
              <ChevronDown className="h-3.5 w-3.5" />
              <span>Hide Controls (H)</span>
            </>
          )}
        </button>

        {!dockCollapsed && (
          <div className="pointer-events-auto flex w-full flex-wrap items-center justify-between gap-2.5 rounded-xl border border-slate-800 bg-[#0F131B]/95 px-3.5 py-2.5 text-[11px] text-slate-200 shadow-2xl">
            {/* Exploded View Slider */}
            <div className="flex min-w-[140px] flex-1 flex-col gap-1">
              <div className="flex items-center justify-between">
                <label htmlFor="explode-range" className="font-medium text-slate-300">
                  Exploded View
                </label>
                <span className="font-mono tabular-nums text-blue-400">
                  {Math.round(explodeTarget * 100)}%
                </span>
              </div>
              <input
                id="explode-range"
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={explodeTarget}
                onChange={(e) => setExplodeTarget(Number(e.target.value))}
                className="h-1.5 w-full cursor-pointer accent-blue-500"
              />
            </div>

            {/* Finish Swatches */}
            <div className="flex items-center gap-1">
              {(Object.keys(FINISH_PALETTES) as FinishId[]).map((id) => {
                const active = finish === id;
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setFinish(id)}
                    aria-pressed={active}
                    className={`rounded-md border px-2 py-1 font-medium transition-colors ${
                      active
                        ? 'border-blue-500 bg-blue-600/20 text-white'
                        : 'border-slate-700 bg-[#161C27] text-slate-300 hover:bg-slate-800'
                    }`}
                  >
                    {FINISH_PALETTES[id].label.split(' ')[0]}
                  </button>
                );
              })}
            </div>

            {/* Camera Presets */}
            <div className="flex items-center gap-1">
              {(Object.keys(CAMERA_PRESETS) as CameraPresetId[]).map((id) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => applyCameraPreset(id)}
                  className="rounded-md border border-slate-700 bg-[#161C27] px-2 py-1 font-medium text-slate-300 transition-colors hover:bg-slate-800 hover:text-white"
                >
                  {CAMERA_PRESETS[id].label}
                </button>
              ))}
            </div>

            {/* Kinetic Speed + Reset */}
            <div className="flex items-center gap-1">
              {(['paused', 'calm', 'active'] as MotionSpeed[]).map((spd) => (
                <button
                  key={spd}
                  type="button"
                  onClick={() => setMotionSpeed(spd)}
                  aria-pressed={motionSpeed === spd}
                  className={`rounded-md border px-2 py-1 capitalize transition-colors ${
                    motionSpeed === spd
                      ? 'border-blue-500 bg-blue-600/20 text-white'
                      : 'border-slate-700 bg-[#161C27] text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {spd}
                </button>
              ))}
              <button
                type="button"
                aria-label="Reset 3D assembly view"
                onClick={() => {
                  setExplodeTarget(0);
                  setFinish('titanium');
                  setMotionSpeed('calm');
                  setSelectedPart('Full Neural Core Assembly');
                  applyCameraPreset('hero');
                }}
                className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-slate-700 bg-[#161C27] text-slate-300 hover:bg-slate-800"
              >
                <RotateCcw className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
