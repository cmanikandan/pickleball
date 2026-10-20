import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';

import {
  COURT_SPECS,
  BALL_SPECS,
  SHOT_ARCHETYPES,
  PickleballPhysics,
} from './physics/PickleballPhysics.js';
import { SoundEngine } from './audio/SoundEngine.js';
import { TRAINING_MODULES, PickleballRules } from './rules/PickleballRules.js';
import { PickleballAI } from './ai/PickleballAI.js';
import { CourtOverlays } from './ui/CourtOverlays.js';

class PickleballSimulationApp {
  constructor() {
    this.canvas = document.getElementById('game-canvas');
    this.physics = new PickleballPhysics();
    this.sound = new SoundEngine();
    this.rules = new PickleballRules();
    this.ai = new PickleballAI();

    this.lastFrameTime = performance.now();
    this.time = 0;
    this.timeScale = 1.0;

    // Input & Explicit Paddle Contact Controls
    this.keys = {};
    this.aimTarget = new THREE.Vector3(-1.35, 0.0368, -4.4);
    this.selectedShotType = 'drive'; // 'drive' | 'dink' | 'drop' | 'volley' | 'smash' | 'slice'
    this.recommendedShotType = 'drive';
    this.paddlePitchOffset = 0; // degrees (-15 to +20)
    this.paddleYawOffset = 0;   // degrees (-25 to +25)
    this.paddleBrushOffset = 0; // degrees (-25 to +25)
    this.shotPower = 0.78;
    this.isChargingSwing = false;
    this.chargeStartTime = 0;
    this.autoFootworkAssist = true;
    this.cameraPreset = 'broadcast'; // 'broadcast' | 'player' | 'kitchen' | 'overhead' | 'closeup'

    this.raycaster = new THREE.Raycaster();
    this.mouseNDC = new THREE.Vector2();
    this.groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

    // Assets & Athlete instances
    this.assets = {
      court: null,
      paddle: null,
      ball: null,
      maleGltf: null,
      femaleGltf: null,
    };
    this.players = [];
    this.spectators = [];
    this.timingCallouts = [];
    this.showcaseFreeze = false;
    this.strikeFlashMesh = null;
    this.crowdCheerTimer = 0;
    this.ballMesh = null;
    this.autoServeCooldown = 0;
    this.focusedEmotionPlayer = null;

    this.initScene();
    this.initModalFallback();
    this.bindUIEvents();
    this.loadAllAssets();
  }

  initScene() {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x060d24);
    this.scene.fog = new THREE.FogExp2(0x060d24, 0.0068);

    this.camera = new THREE.PerspectiveCamera(
      38,
      window.innerWidth / window.innerHeight,
      0.1,
      280
    );
    this.camera.position.set(0, 5.55, 11.45);

    // Secondary Portrait Camera for the Top-Right "Live 3D Human Emotion Cam" (PiP)
    this.faceCamera = new THREE.PerspectiveCamera(24, 2.0, 0.08, 40);

    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;
    this.renderer.autoClear = false;

    // Generate PPA Tour 2025 Championship Indoor Arena PMREM Environment Map
    this.buildOutdoorEnvironmentMap();

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.maxPolarAngle = Math.PI * 0.485;
    this.controls.minDistance = 1.2;
    this.controls.maxDistance = 36;
    this.controls.target.set(0, 0.42, 0.10);
    // Right-click drag orbits camera so Left-click is dedicated to paddle strikes!
    this.controls.mouseButtons = {
      LEFT: null,
      MIDDLE: THREE.MOUSE.DOLLY,
      RIGHT: THREE.MOUSE.ROTATE,
    };

    // PPA Tour 2025 Championship Indoor/Night Arena Spotlight Illumination
    const hemiLight = new THREE.HemisphereLight(0xdbeafe, 0x0b183d, 1.08);
    this.scene.add(hemiLight);

    const sunLight = new THREE.DirectionalLight(0xf8fafc, 2.35);
    sunLight.position.set(4.5, 21.0, 9.5);
    sunLight.castShadow = true;
    sunLight.shadow.mapSize.set(4096, 4096);
    sunLight.shadow.camera.near = 1;
    sunLight.shadow.camera.far = 55;
    const d = 13.5;
    sunLight.shadow.camera.left = -d;
    sunLight.shadow.camera.right = d;
    sunLight.shadow.camera.top = d;
    sunLight.shadow.camera.bottom = -d;
    sunLight.shadow.bias = -0.00025;
    this.scene.add(sunLight);

    // Subtle cool broadcast rim light + warm court bounce fill light on athletes
    const rimLight = new THREE.DirectionalLight(0x93c5fd, 0.72);
    rimLight.position.set(-12.0, 10.0, -12.0);
    const faceFillNear = new THREE.DirectionalLight(0xfff5ea, 1.15);
    faceFillNear.position.set(2.0, 5.0, -11.0);
    const faceFillFar = new THREE.DirectionalLight(0xfff5ea, 0.95);
    faceFillFar.position.set(-2.0, 5.0, 11.0);
    this.scene.add(rimLight, faceFillNear, faceFillFar);

    // Build PPA Tour 2025 Championship Arena, Back Wall Murals, LED Barriers, Planters, VIP Lounge & Camera Tripod
    this.buildRealisticOutdoorStadium();

    // 3D Court Overlays (Kitchen, Service Box, Trajectory, Bounce Rings)
    this.overlays = new CourtOverlays(this.scene);

    window.addEventListener('resize', () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(window.innerWidth, window.innerHeight);
    });
  }

  /**
   * Generates a procedural HDR-style PPA Tour 2025 Championship Indoor Arena PMREM environment map
   * so carbon-fiber paddles, stadium steel, and royal-blue acrylic court surfaces have crisp specular sheen.
   */
  buildOutdoorEnvironmentMap() {
    try {
      const pmrem = new THREE.PMREMGenerator(this.renderer);
      pmrem.compileEquirectangularShader();
      const envScene = new THREE.Scene();
      const skyDome = new THREE.Mesh(
        new THREE.SphereGeometry(50, 32, 16),
        new THREE.ShaderMaterial({
          side: THREE.BackSide,
          vertexShader: `
            varying vec3 vPos;
            void main() {
              vPos = position;
              gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
          `,
          fragmentShader: `
            varying vec3 vPos;
            void main() {
              vec3 d = normalize(vPos);
              vec3 ground = vec3(0.08, 0.20, 0.56);
              vec3 horizon = vec3(0.07, 0.14, 0.36);
              vec3 zenith = vec3(0.02, 0.05, 0.14);
              vec3 col = d.y < 0.0
                ? mix(horizon, ground, clamp(-d.y * 2.5, 0.0, 1.0))
                : mix(horizon, zenith, pow(d.y, 0.65));
              vec3 spot1 = normalize(vec3(0.25, 0.88, 0.35));
              vec3 spot2 = normalize(vec3(-0.35, 0.85, -0.35));
              col += vec3(0.85, 0.92, 1.0) * pow(max(dot(d, spot1), 0.0), 32.0) * 1.8;
              col += vec3(0.75, 0.88, 1.0) * pow(max(dot(d, spot2), 0.0), 32.0) * 1.4;
              gl_FragColor = vec4(col, 1.0);
            }
          `,
        })
      );
      envScene.add(skyDome);
      const envRT = pmrem.fromScene(envScene, 0.03);
      this.scene.environment = envRT.texture;
      this.scene.environmentIntensity = 0.58;
      pmrem.dispose();
    } catch (_) {
      // Fallback if PMREM fails
    }
  }

  /**
   * Builds a helper logo painter on a 2D canvas context for PPA Tour 2025 sponsor graphics
   */
  drawSponsorLogoOnCanvas(ctx, brand, cx, cy, scale = 1.0, color = '#ffffff') {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(scale, scale);
    ctx.fillStyle = color;
    ctx.strokeStyle = color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    if (brand === 'OS1st') {
      ctx.font = '900 84px "Arial Black", Inter, sans-serif';
      ctx.fillText('OS1', -22, 4);
      ctx.font = '900 44px "Arial Black", Inter, sans-serif';
      ctx.fillText('st', 78, -22);
    } else if (brand === 'THORLO') {
      ctx.font = '900 72px "Arial Black", Impact, Inter, sans-serif';
      ctx.letterSpacing = '2px';
      ctx.fillText('THORLO', 0, 0);
    } else if (brand === 'PPA_2025') {
      // Top: Outlined geometric PPA letters
      ctx.lineWidth = 5;
      ctx.font = '900 105px "Arial Black", Impact, sans-serif';
      ctx.strokeText('PPA', 0, -76);
      ctx.lineWidth = 2;
      ctx.strokeText('PPA', 0, -76);
      // Middle: PICKLEBALL TOUR
      ctx.font = '800 32px Inter, "Arial Black", sans-serif';
      ctx.letterSpacing = '4px';
      ctx.fillText('PICKLEBALL TOUR', 0, -8);
      // Bottom: Heavy italic 2025
      ctx.font = 'italic 900 86px "Arial Black", Impact, sans-serif';
      ctx.letterSpacing = '2px';
      ctx.fillText('2025', -4, 62);
    } else if (brand === 'SELKIRK_WALL') {
      // Iconic curved Selkirk S ribbon emblem above SELKIRK wordmark
      ctx.beginPath();
      ctx.lineWidth = 18;
      ctx.lineCap = 'round';
      ctx.moveTo(45, -92);
      ctx.bezierCurveTo(-55, -95, -55, -45, 5, -38);
      ctx.bezierCurveTo(65, -30, 65, 18, -45, 15);
      ctx.stroke();
      ctx.font = 'italic 900 54px "Arial Black", Inter, sans-serif';
      ctx.letterSpacing = '5px';
      ctx.fillText('SELKIRK', 4, 66);
    } else if (brand === 'VERSIX') {
      ctx.font = 'italic 900 38px "Arial Black", Inter, sans-serif';
      ctx.fillText('VERSI', -18, -4);
      // Stylized oversized X
      ctx.lineWidth = 7;
      ctx.beginPath();
      ctx.moveTo(44, -28);
      ctx.lineTo(84, 24);
      ctx.moveTo(88, -32);
      ctx.lineTo(38, 26);
      ctx.stroke();
      ctx.font = '700 15px Inter, sans-serif';
      ctx.letterSpacing = '2px';
      ctx.fillText('PICKLEBALL', -10, 22);
    } else if (brand === 'FILA_BOX') {
      ctx.lineWidth = 5;
      ctx.strokeRect(-42, -42, 84, 84);
      // F bars inside square
      ctx.fillRect(-24, -26, 48, 13);
      ctx.fillRect(-24, -6, 38, 13);
      ctx.fillRect(-24, -6, 14, 34);
    } else if (brand === 'ERNE') {
      // 3 angled wing bars + erne lowercase
      for (let i = 0; i < 3; i++) {
        ctx.fillRect(-82 + i * 4, -16 + i * 12, 18 - i * 3, 6);
      }
      ctx.font = '800 44px Inter, sans-serif';
      ctx.fillText('erne', 12, 0);
    } else if (brand === 'TOPCOURT') {
      ctx.fillRect(-88, -12, 5, 24);
      ctx.fillRect(-79, -12, 5, 24);
      ctx.font = '800 26px Inter, sans-serif';
      ctx.letterSpacing = '1px';
      ctx.fillText('TOPCOURT', 12, 1);
    } else if (brand === 'PB_CENTRAL') {
      ctx.font = '900 28px Inter, sans-serif';
      ctx.fillText('Pickleball', 0, -13);
      ctx.font = '800 26px Inter, sans-serif';
      ctx.fillText('⊕Central', 0, 16);
    } else if (brand === 'PB_COM') {
      // Stylized P court icon above PICKLEBALL.COM
      ctx.lineWidth = 5;
      ctx.strokeRect(-18, -36, 36, 32);
      ctx.beginPath();
      ctx.moveTo(0, -36);
      ctx.lineTo(0, -4);
      ctx.stroke();
      ctx.font = 'italic 900 24px "Arial Black", Inter, sans-serif';
      ctx.fillText('PICKLEBALL.COM', 0, 22);
    }
    ctx.restore();
  }

  /**
   * Builds the authentic PPA Pickleball Tour 2025 Championship Indoor/Night Arena:
   * - Dark Navy Arena Backdrop & Concourse Floor with Spotlight Vignettes
   * - Giant Back Arena Wall Murals (`OS1st`, `THORLO`, `PPA PICKLEBALL TOUR 2025`, `OS1st`, `SELKIRK`)
   * - Back Baseline Royal-Blue Sponsor Box Barrier (`VERSIX`, `FILA`, `erne`, `TOPCOURT`, `THORLO`, `Pickleball Central`, `PICKLEBALL.COM`)
   * - Flanking Pairs of Tall Matte-Black Planters with Lush Purple, Magenta & White Flowers
   * - Left & Right Angled Glowing Blue Sideline Sponsor Barriers
   * - Courtside VIP Lounge Sofa Area (Upper-Left) with Wooden Coffee Table, Throw Pillows & 2 Seated Spectators
   * - Professional Broadcast Cinema Camera on Spread-Leg Tripod (Upper-Right)
   */
  buildRealisticOutdoorStadium() {
    const envGroup = new THREE.Group();
    envGroup.name = 'PPA_Tour_2025_Arena';

    // 1. Dark Navy Indoor Championship Arena Dome
    const skyGeo = new THREE.SphereGeometry(160, 40, 24);
    const skyMat = new THREE.MeshBasicMaterial({
      color: 0x050b1e,
      side: THREE.BackSide,
      depthWrite: false,
    });
    envGroup.add(new THREE.Mesh(skyGeo, skyMat));

    // 2. Outer Arena Floor (Rich Navy Concourse surrounding the court apron)
    const floorCanvas = document.createElement('canvas');
    floorCanvas.width = 1024;
    floorCanvas.height = 1024;
    const fCtx = floorCanvas.getContext('2d');
    const fGrad = fCtx.createRadialGradient(512, 512, 80, 512, 512, 512);
    fGrad.addColorStop(0, '#1c3ea8');
    fGrad.addColorStop(0.55, '#132a73');
    fGrad.addColorStop(1, '#060d24');
    fCtx.fillStyle = fGrad;
    fCtx.fillRect(0, 0, 1024, 1024);
    const floorTex = new THREE.CanvasTexture(floorCanvas);
    floorTex.colorSpace = THREE.SRGBColorSpace;

    const arenaFloor = new THREE.Mesh(
      new THREE.PlaneGeometry(68, 68).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({
        map: floorTex,
        roughness: 0.78,
        metalness: 0.06,
      })
    );
    arenaFloor.position.y = -0.012;
    arenaFloor.receiveShadow = true;
    envGroup.add(arenaFloor);

    // Subtle beige/gold concourse boundary tape strips outside left & right sideline barriers (at z = +4.15m)
    const tapeMat = new THREE.MeshBasicMaterial({
      color: 0xd4c38f,
      transparent: true,
      opacity: 0.72,
    });
    for (const xSign of [-1, 1]) {
      const floorTape = new THREE.Mesh(
        new THREE.PlaneGeometry(3.2, 0.14).rotateX(-Math.PI / 2),
        tapeMat
      );
      floorTape.position.set(xSign * 7.45, 0.002, 4.18);
      floorTape.rotation.z = xSign * 0.12;
      envGroup.add(floorTape);
    }

    // 3. Giant Back Arena Wall Murals (`z = -12.6m`, width `27.6m`, height `6.5m`)
    const wallW = 4096;
    const wallH = 1024;
    const wallCanvas = document.createElement('canvas');
    wallCanvas.width = wallW;
    wallCanvas.height = wallH;
    const wCtx = wallCanvas.getContext('2d');

    const wBg = wCtx.createLinearGradient(0, 0, 0, wallH);
    wBg.addColorStop(0, '#050d24');
    wBg.addColorStop(0.45, '#0b1d4a');
    wBg.addColorStop(0.88, '#081538');
    wBg.addColorStop(1, '#040a1c');
    wCtx.fillStyle = wBg;
    wCtx.fillRect(0, 0, wallW, wallH);

    // Subtle atmospheric spotlight glows & mottled stadium wall texture
    for (const spotX of [420, 1180, 2048, 2940, 3680]) {
      const sg = wCtx.createRadialGradient(spotX, 340, 30, spotX, 380, 520);
      sg.addColorStop(0, 'rgba(56, 130, 246, 0.24)');
      sg.addColorStop(0.6, 'rgba(30, 64, 175, 0.08)');
      sg.addColorStop(1, 'rgba(0, 0, 0, 0)');
      wCtx.fillStyle = sg;
      wCtx.fillRect(spotX - 520, 0, 1040, wallH);
    }
    for (let i = 0; i < 900; i++) {
      const rx = (i * 173) % wallW;
      const ry = (i * 293) % wallH;
      wCtx.fillStyle = i % 2 === 0 ? 'rgba(148, 197, 255, 0.025)' : 'rgba(4, 10, 28, 0.06)';
      wCtx.beginPath();
      wCtx.arc(rx, ry, 18 + (i % 36), 0, Math.PI * 2);
      wCtx.fill();
    }

    // 5 Giant Back Wall Sponsor Murals across upper wall (matching media_1792490611048.png)
    const muralColor = 'rgba(226, 236, 248, 0.88)';
    this.drawSponsorLogoOnCanvas(wCtx, 'OS1st', 740, 565, 1.85, muralColor);
    this.drawSponsorLogoOnCanvas(wCtx, 'THORLO', 1380, 575, 1.52, muralColor);
    this.drawSponsorLogoOnCanvas(wCtx, 'PPA_2025', 2048, 555, 1.52, muralColor);
    this.drawSponsorLogoOnCanvas(wCtx, 'OS1st', 2740, 565, 1.85, muralColor);
    this.drawSponsorLogoOnCanvas(wCtx, 'SELKIRK_WALL', 3360, 545, 1.68, muralColor);

    const backWallTex = new THREE.CanvasTexture(wallCanvas);
    backWallTex.colorSpace = THREE.SRGBColorSpace;
    backWallTex.anisotropy = 8;

    const backWallMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(31.0, 5.2),
      new THREE.MeshBasicMaterial({ map: backWallTex })
    );
    backWallMesh.position.set(0, 2.35, -11.4);
    envGroup.add(backWallMesh);

    // 4. Back Baseline Sponsor Barrier Box (`z = -9.5m`, width `9.0m`, height `1.02m`)
    const backBarCanvas = document.createElement('canvas');
    backBarCanvas.width = 2048;
    backBarCanvas.height = 256;
    const bbCtx = backBarCanvas.getContext('2d');
    const bbGrad = bbCtx.createLinearGradient(0, 0, 0, 256);
    bbGrad.addColorStop(0, '#1433a6');
    bbGrad.addColorStop(0.5, '#0d237a');
    bbGrad.addColorStop(1, '#09195c');
    bbCtx.fillStyle = bbGrad;
    bbCtx.fillRect(0, 0, 2048, 256);

    // Glowing top & bottom electric blue edge strips
    bbCtx.fillStyle = '#3b82f6';
    bbCtx.fillRect(0, 0, 2048, 12);
    bbCtx.fillRect(0, 244, 2048, 12);

    const backBrands = [
      ['VERSIX', 180, 0.95],
      ['FILA_BOX', 450, 0.92],
      ['ERNE', 735, 0.95],
      ['TOPCOURT', 1035, 0.95],
      ['THORLO', 1320, 0.62],
      ['PB_CENTRAL', 1605, 0.95],
      ['PB_COM', 1885, 0.92],
    ];
    backBrands.forEach(([bName, bx, bScale]) => {
      this.drawSponsorLogoOnCanvas(bbCtx, bName, bx, 128, bScale, '#ffffff');
    });

    const backBarTex = new THREE.CanvasTexture(backBarCanvas);
    backBarTex.colorSpace = THREE.SRGBColorSpace;
    backBarTex.anisotropy = 8;

    const barrierBodyMat = new THREE.MeshStandardMaterial({
      color: 0x0c2174,
      roughness: 0.42,
      metalness: 0.18,
    });
    const ledGlowMat = new THREE.MeshBasicMaterial({ color: 0x3b82f6 });

    const backBarrierGroup = new THREE.Group();
    backBarrierGroup.position.set(0, 0, -9.5);
    const backBox = new THREE.Mesh(new THREE.BoxGeometry(9.0, 1.02, 0.52), barrierBodyMat);
    backBox.position.y = 0.51;
    backBox.castShadow = true;
    backBox.receiveShadow = true;
    const backFrontFace = new THREE.Mesh(
      new THREE.PlaneGeometry(8.96, 0.98),
      new THREE.MeshBasicMaterial({ map: backBarTex })
    );
    backFrontFace.position.set(0, 0.51, 0.265);
    const backTopStrip = new THREE.Mesh(new THREE.BoxGeometry(9.04, 0.04, 0.54), ledGlowMat);
    backTopStrip.position.set(0, 1.02, 0);
    backBarrierGroup.add(backBox, backFrontFace, backTopStrip);
    envGroup.add(backBarrierGroup);

    // 5. Flanking Matte-Black Tall Planters with Lush Purple, Magenta & White Floral Clusters
    const planterMat = new THREE.MeshStandardMaterial({
      color: 0x10131a,
      roughness: 0.72,
      metalness: 0.15,
    });
    const planterTrimMat = new THREE.MeshStandardMaterial({
      color: 0x1c2230,
      roughness: 0.55,
      metalness: 0.25,
    });
    const flowerPalette = [
      new THREE.MeshStandardMaterial({ color: 0x9333ea, roughness: 0.75 }), // Deep Purple
      new THREE.MeshStandardMaterial({ color: 0xd8b4fe, roughness: 0.68 }), // Soft Lavender
      new THREE.MeshStandardMaterial({ color: 0xec4899, roughness: 0.72 }), // Magenta Pink
      new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.65 }), // Crisp White
      new THREE.MeshStandardMaterial({ color: 0x14532d, roughness: 0.85 }), // Botanical Leaf Green
    ];
    const puffGeo = new THREE.IcosahedronGeometry(0.11, 1);

    for (const px of [-5.48, -4.88, 4.88, 5.48]) {
      const pGroup = new THREE.Group();
      pGroup.position.set(px, 0, -9.48);

      const box = new THREE.Mesh(new THREE.BoxGeometry(0.50, 1.38, 0.50), planterMat);
      box.position.y = 0.69;
      box.castShadow = true;
      box.receiveShadow = true;
      pGroup.add(box);

      const rim = new THREE.Mesh(new THREE.BoxGeometry(0.54, 0.06, 0.54), planterTrimMat);
      rim.position.y = 1.36;
      pGroup.add(rim);

      // Lush rounded bouquet of purple, lavender, pink & white flowers on top
      for (let f = 0; f < 26; f++) {
        const ang = (f / 26) * Math.PI * 2 * 2.4;
        const rad = (f < 6 ? 0.04 : f < 16 ? 0.14 : 0.22) + (f % 3) * 0.015;
        const fx = Math.cos(ang) * rad;
        const fz = Math.sin(ang) * rad;
        const fy = 1.42 + (1.0 - rad * 2.1) * 0.16 + (f % 2) * 0.03;
        const matIdx = f >= 20 ? 4 : f % 4;
        const puff = new THREE.Mesh(puffGeo, flowerPalette[matIdx]);
        puff.position.set(fx, fy, fz);
        puff.scale.set(1.05, 0.82, 1.05);
        puff.rotation.set(f * 0.7, f * 1.1, f * 0.5);
        puff.castShadow = true;
        pGroup.add(puff);
      }
      envGroup.add(pGroup);
    }

    // 6. Angled Glowing Blue Sideline Perimeter Barriers (`x = ±5.85m`, `z ∈ [-8.85, +4.05]`)
    const makeSidelineBarrierTex = (brandsList) => {
      const c = document.createElement('canvas');
      c.width = 2048;
      c.height = 256;
      const sCtx = c.getContext('2d');
      const sGrad = sCtx.createLinearGradient(0, 0, 0, 256);
      sGrad.addColorStop(0, '#1638b8');
      sGrad.addColorStop(0.5, '#0e2585');
      sGrad.addColorStop(1, '#081754');
      sCtx.fillStyle = sGrad;
      sCtx.fillRect(0, 0, 2048, 256);

      sCtx.fillStyle = '#38bdf8';
      sCtx.fillRect(0, 0, 2048, 12);
      sCtx.fillRect(0, 244, 2048, 12);

      const step = 2048 / brandsList.length;
      brandsList.forEach(([bName, bScale], idx) => {
        this.drawSponsorLogoOnCanvas(sCtx, bName, (idx + 0.5) * step, 128, bScale, '#ffffff');
      });

      const tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = 8;
      return tex;
    };

    const leftSideTex = makeSidelineBarrierTex([
      ['THORLO', 0.66],
      ['TOPCOURT', 0.95],
      ['PB_CENTRAL', 0.95],
      ['PB_COM', 0.92],
      ['SELKIRK_WALL', 0.56],
      ['OS1st', 0.85],
      ['ERNE', 0.95],
    ]);

    const rightSideTex = makeSidelineBarrierTex([
      ['PB_COM', 0.92],
      ['SELKIRK_WALL', 0.56],
      ['OS1st', 0.85],
      ['ERNE', 0.95],
      ['PB_CENTRAL', 0.95],
      ['TOPCOURT', 0.95],
      ['VERSIX', 0.95],
    ]);

    const sideLen = 12.9;
    const sideCenterZ = -2.4;
    const endFrameMat = new THREE.MeshStandardMaterial({
      color: 0x0b132b,
      roughness: 0.5,
      metalness: 0.3,
    });

    for (const xSign of [-1, 1]) {
      const sideGroup = new THREE.Group();
      sideGroup.position.set(xSign * 5.85, 0, sideCenterZ);

      // A-frame backing structure
      const coreBox = new THREE.Mesh(
        new THREE.BoxGeometry(0.42, 0.88, sideLen),
        barrierBodyMat
      );
      coreBox.position.y = 0.44;
      coreBox.castShadow = true;
      coreBox.receiveShadow = true;
      sideGroup.add(coreBox);

      // Court-facing angled LED sponsor panel
      const facePlane = new THREE.Mesh(
        new THREE.PlaneGeometry(sideLen - 0.08, 0.90),
        new THREE.MeshBasicMaterial({ map: xSign < 0 ? leftSideTex : rightSideTex })
      );
      facePlane.position.set(-xSign * 0.22, 0.46, 0);
      facePlane.rotation.y = xSign < 0 ? Math.PI / 2 : -Math.PI / 2;
      facePlane.rotation.z = 0;
      sideGroup.add(facePlane);

      // Glowing top & bottom electric-blue LED edge rails
      const topRail = new THREE.Mesh(
        new THREE.BoxGeometry(0.06, 0.045, sideLen + 0.04),
        ledGlowMat
      );
      topRail.position.set(-xSign * 0.20, 0.90, 0);
      const botRail = new THREE.Mesh(
        new THREE.BoxGeometry(0.06, 0.04, sideLen + 0.04),
        ledGlowMat
      );
      botRail.position.set(-xSign * 0.22, 0.03, 0);
      sideGroup.add(topRail, botRail);

      // Dark structural end cap at near end (z = +sideLen/2)
      const nearCap = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.91, 0.08), endFrameMat);
      nearCap.position.set(0, 0.455, sideLen * 0.5);
      sideGroup.add(nearCap);

      envGroup.add(sideGroup);
    }

    // 7. Courtside VIP Lounge Sofa Area (Upper-Left behind left barrier at x = -7.25m, z = -7.55m)
    const vipLounge = new THREE.Group();
    vipLounge.position.set(-7.25, 0, -7.55);
    vipLounge.rotation.y = 0.34; // Angled slightly toward center court

    const sofaFrameMat = new THREE.MeshStandardMaterial({ color: 0x0b132b, roughness: 0.7 });
    const sofaFabricMat = new THREE.MeshStandardMaterial({ color: 0x1e3264, roughness: 0.82 });
    const pillowMat = new THREE.MeshStandardMaterial({ color: 0xe2e8f0, roughness: 0.65 });

    // Raised dark platform under VIP sofa
    const vipDeck = new THREE.Mesh(
      new THREE.BoxGeometry(3.4, 0.12, 2.4),
      new THREE.MeshStandardMaterial({ color: 0x0a1433, roughness: 0.8 })
    );
    vipDeck.position.set(0, 0.06, 0.2);
    vipDeck.receiveShadow = true;
    vipLounge.add(vipDeck);

    // 3-seat modern sofa base, cushions, backrest & armrests
    const sofaBase = new THREE.Mesh(new THREE.BoxGeometry(2.55, 0.24, 0.96), sofaFrameMat);
    sofaBase.position.set(0, 0.24, 0);
    sofaBase.castShadow = true;
    vipLounge.add(sofaBase);

    for (const cx of [-0.78, 0, 0.78]) {
      const seatCushion = new THREE.Mesh(
        new THREE.BoxGeometry(0.76, 0.16, 0.86),
        sofaFabricMat
      );
      seatCushion.position.set(cx, 0.44, 0.04);
      seatCushion.castShadow = true;
      const backCushion = new THREE.Mesh(
        new THREE.BoxGeometry(0.76, 0.52, 0.22),
        sofaFabricMat
      );
      backCushion.position.set(cx, 0.76, -0.34);
      backCushion.rotation.x = -0.1;
      backCushion.castShadow = true;
      vipLounge.add(seatCushion, backCushion);
    }

    for (const ax of [-1.22, 1.22]) {
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.52, 0.96), sofaFabricMat);
      arm.position.set(ax, 0.56, 0);
      arm.castShadow = true;
      vipLounge.add(arm);
    }

    // Crisp white/light-gray throw pillows on right end of sofa
    const pillow1 = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.38, 0.14), pillowMat);
    pillow1.position.set(0.92, 0.68, -0.16);
    pillow1.rotation.set(-0.15, -0.28, 0.08);
    const pillow2 = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.34, 0.12), pillowMat);
    pillow2.position.set(0.68, 0.65, -0.18);
    pillow2.rotation.set(-0.12, -0.15, -0.05);
    vipLounge.add(pillow1, pillow2);

    // Warm wooden coffee table with water bottles in front-left of sofa
    const woodMat = new THREE.MeshStandardMaterial({ color: 0x7c5836, roughness: 0.55 });
    const coffeeTable = new THREE.Group();
    coffeeTable.position.set(-0.95, 0.12, 1.45);
    coffeeTable.rotation.y = 1.15;
    const tableTop = new THREE.Mesh(new THREE.BoxGeometry(1.35, 0.07, 0.72), woodMat);
    tableTop.position.y = 0.42;
    tableTop.castShadow = true;
    coffeeTable.add(tableTop);
    for (const [lx, lz] of [[-0.58, -0.28], [0.58, -0.28], [-0.58, 0.28], [0.58, 0.28]]) {
      const tLeg = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.42, 0.06), sofaFrameMat);
      tLeg.position.set(lx, 0.21, lz);
      coffeeTable.add(tLeg);
    }
    const bottleMat = new THREE.MeshStandardMaterial({
      color: 0xdbeafe,
      roughness: 0.18,
      transparent: true,
      opacity: 0.85,
    });
    for (const [bx, bz] of [[-0.25, 0.08], [0.32, -0.12]]) {
      const bottle = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.036, 0.21, 10), bottleMat);
      bottle.position.set(bx, 0.56, bz);
      coffeeTable.add(bottle);
    }
    vipLounge.add(coffeeTable);

    envGroup.add(vipLounge);
    this.vipLoungeGroup = vipLounge;

    // Store ONLY the 2 VIP sofa spectator seat anchors (no 60 bleacher clones!)
    this.spectatorSeatAnchors = [
      {
        parentGroup: vipLounge,
        localPos: new THREE.Vector3(-0.62, 0.02, 0.14),
        localRotY: 0.05,
        skinHex: 0x6b422a,
        shirtHex: 0x4c1d2e, // Burgundy/maroon short-sleeve polo
        pantsHex: 0x172554, // Dark navy jeans
        shoeHex: 0x0f172a,
        hairHex: 0x111111,
      },
      {
        parentGroup: vipLounge,
        localPos: new THREE.Vector3(0.14, 0.02, 0.16),
        localRotY: -0.04,
        skinHex: 0xd4966e,
        shirtHex: 0xc5d165, // Light yellow-olive casual t-shirt
        pantsHex: 0x2563eb, // Medium blue jeans
        shoeHex: 0x1e293b,
        hairHex: 0x3b261c,
      },
    ];

    // 8. Professional Broadcast Cinema Camera on Tripod (Upper-Right at x = +7.35m, z = -5.4m)
    const camRig = new THREE.Group();
    camRig.position.set(7.35, 0, -5.45);
    const camMetalMat = new THREE.MeshStandardMaterial({
      color: 0x111827,
      roughness: 0.35,
      metalness: 0.75,
    });
    const camDarkMat = new THREE.MeshStandardMaterial({
      color: 0x090d16,
      roughness: 0.55,
      metalness: 0.35,
    });

    // 3 spread tripod legs
    for (let l = 0; l < 3; l++) {
      const ang = (l / 3) * Math.PI * 2 + 0.4;
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.018, 1.62, 10), camMetalMat);
      leg.position.set(Math.cos(ang) * 0.26, 0.76, Math.sin(ang) * 0.26);
      leg.rotation.z = Math.cos(ang) * 0.32;
      leg.rotation.x = -Math.sin(ang) * 0.32;
      leg.castShadow = true;
      camRig.add(leg);
    }
    const spreader = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.025, 16), camMetalMat);
    spreader.position.y = 0.58;
    const fluidHead = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, 0.22, 14), camMetalMat);
    fluidHead.position.y = 1.56;
    camRig.add(spreader, fluidHead);

    // Camera assembly aimed toward center court
    const camHead = new THREE.Group();
    camHead.position.set(0, 1.72, 0);
    camHead.lookAt(0, 0.9, 0);

    const bodyBox = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.28, 0.48), camDarkMat);
    const batteryBox = new THREE.Mesh(new THREE.BoxGeometry(0.20, 0.22, 0.16), camMetalMat);
    batteryBox.position.set(0, 0.01, -0.30);
    const lensBarrel = new THREE.Mesh(
      new THREE.CylinderGeometry(0.09, 0.09, 0.24, 16).rotateX(Math.PI / 2),
      camMetalMat
    );
    lensBarrel.position.set(0, 0.01, 0.34);
    const matteBox = new THREE.Mesh(new THREE.BoxGeometry(0.30, 0.24, 0.14), camDarkMat);
    matteBox.position.set(0, 0.01, 0.48);
    const topHandle = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.10, 0.36), camMetalMat);
    topHandle.position.set(0, 0.19, 0.02);
    const sideMonitor = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.13, 0.03), camMetalMat);
    sideMonitor.position.set(-0.22, 0.06, -0.05);
    sideMonitor.rotation.y = 0.35;

    camHead.add(bodyBox, batteryBox, lensBarrel, matteBox, topHandle, sideMonitor);
    camRig.add(camHead);
    envGroup.add(camRig);

    this.scene.add(envGroup);
  }

  /**
   * Upgrades the loaded court.glb materials and builds the PPA Pickleball Tour 2025
   * 3072x4096 Royal-Blue / Sky-Blue Championship Court Surface, On-Court Brand Stencils
   * (`SELKIRK™`, `PPA PICKLEBALL TOUR`, `erne`, `PICKLEBALL.COM`, `VERSIX`, `THORLO`),
   * and Portable Pro Net with `FILA` Vertical Side Banners & Bottom Stabilizer Bar.
   */
  upgradeCourtMaterials(courtRoot) {
    const maxAniso = Math.min(16, this.renderer.capabilities.getMaxAnisotropy());

    // 1. High-Resolution 3072x4096 PPA Tour 2025 Master Court Surface Texture
    // World coverage: X in [-5.85, +5.85] (11.70m), Z in [-9.50, +9.50] (19.00m)
    const W = 3072;
    const H = 4096;
    const worldW = 11.70;
    const worldL = 19.00;
    const courtCanvas = document.createElement('canvas');
    courtCanvas.width = W;
    courtCanvas.height = H;
    const ctx = courtCanvas.getContext('2d');

    const pxPerMeterX = W / worldW;
    const pxPerMeterZ = H / worldL;
    const uFromX = (x) => ((x + worldW * 0.5) / worldW) * W;
    const vFromZ = (z) => ((z + worldL * 0.5) / worldL) * H;

    // Outer Apron Base: Rich Medium Royal Blue (#1f47b8)
    ctx.fillStyle = '#1f47b8';
    ctx.fillRect(0, 0, W, H);

    // Subtle Arena Overhead Spotlight Radial Glow & Outer Corner Vignette
    const apronGlow = ctx.createRadialGradient(W * 0.5, H * 0.48, 120, W * 0.5, H * 0.48, W * 0.72);
    apronGlow.addColorStop(0, 'rgba(96, 165, 250, 0.14)');
    apronGlow.addColorStop(0.65, 'rgba(30, 64, 175, 0.04)');
    apronGlow.addColorStop(1, 'rgba(6, 15, 46, 0.36)');
    ctx.fillStyle = apronGlow;
    ctx.fillRect(0, 0, W, H);

    // Subtle directional acrylic roller bands
    for (let i = 0; i < 48; i++) {
      ctx.fillStyle = i % 2 === 0 ? 'rgba(255,255,255,0.011)' : 'rgba(0,0,0,0.011)';
      ctx.fillRect(0, (i / 48) * H, W, H / 48);
    }

    // Service Courts (X in [-3.048, 3.048], Z in [-6.7056, 6.7056]): Deep Royal/Cobalt Blue (#162fa0)
    const xLeft = uFromX(-3.048);
    const xRight = uFromX(3.048);
    const zNorth = vFromZ(-6.7056);
    const zSouth = vFromZ(6.7056);
    ctx.fillStyle = '#162fa0';
    ctx.fillRect(xLeft, zNorth, xRight - xLeft, zSouth - zNorth);

    // Non-Volley Zone / Kitchen (7ft each side of net, Z in [-2.1336, 2.1336]): Bright Sky/Periwinkle Blue (#5380eb)
    const zNvzNorth = vFromZ(-2.1336);
    const zNvzSouth = vFromZ(2.1336);
    ctx.fillStyle = '#5380eb';
    ctx.fillRect(xLeft, zNvzNorth, xRight - xLeft, zNvzSouth - zNvzNorth);

    // Helper to draw undistorted world-space stencils at (worldX, worldZ) in meter units
    const withWorldTransform = (wx, wz, rotRad, drawFn) => {
      ctx.save();
      ctx.translate(uFromX(wx), vFromZ(wz));
      ctx.scale(pxPerMeterX, pxPerMeterZ);
      if (rotRad) ctx.rotate(rotRad);
      drawFn();
      ctx.restore();
    };

    // Stencil A: Both Kitchens (Near Z = +1.08m & Far Z = -1.08m) -> Huge dark-navy SELKIRK™ wordmark
    const drawKitchenSelkirk = () => {
      ctx.save();
      ctx.scale(1.62, 0.86);
      ctx.fillStyle = 'rgba(15, 34, 102, 0.82)';
      ctx.font = 'italic 900 0.56px "Arial Black", Impact, Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.letterSpacing = '0.09px';
      ctx.fillText('SELKIRK', 0, 0);
      ctx.font = '800 0.14px Inter, sans-serif';
      ctx.fillText('TM', 1.56, -0.16);
      ctx.restore();
    };
    withWorldTransform(0, 1.08, 0, drawKitchenSelkirk);
    withWorldTransform(0, -1.08, 0, drawKitchenSelkirk);

    // Stencil B: Far Court PPA PICKLEBALL TOUR Stacked Logo (at Z = -7.35m right above far baseline T-junction)
    withWorldTransform(0, -7.35, 0, () => {
      ctx.save();
      ctx.scale(1.18, 0.92);
      ctx.fillStyle = 'rgba(248, 250, 252, 0.92)';
      ctx.strokeStyle = 'rgba(248, 250, 252, 0.92)';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = '900 0.44px "Arial Black", Impact, sans-serif';
      ctx.fillText('PPA', 0, 0.14);
      ctx.font = '800 0.13px Inter, "Arial Black", sans-serif';
      ctx.fillText('PICKLEBALL TOUR', 0, -0.14);
      ctx.lineWidth = 0.022;
      ctx.strokeRect(-0.74, -0.26, 1.48, 0.04);
      ctx.restore();
    });

    // Stencil C: Left Mid-Apron `erne` wordmark + 3-bar wing icon (at X = -3.72m, Z = -2.95m, rotated along sideline)
    withWorldTransform(-3.72, -2.95, -Math.PI / 2, () => {
      ctx.save();
      ctx.fillStyle = 'rgba(248, 250, 252, 0.94)';
      // 3 angled bars on left
      for (let i = 0; i < 3; i++) {
        ctx.fillRect(-0.98 + i * 0.05, -0.15 + i * 0.11, 0.24 - i * 0.04, 0.055);
      }
      ctx.font = '900 0.50px "Arial Black", Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('erne', 0.16, 0);
      ctx.restore();
    });

    // Stencil D: Left Near-Apron `PICKLEBALL.COM` wordmark + P court emblem (at X = -4.15m, Z = +4.65m)
    withWorldTransform(-4.08, 4.65, -Math.PI / 2, () => {
      ctx.save();
      ctx.fillStyle = 'rgba(248, 250, 252, 0.95)';
      ctx.strokeStyle = 'rgba(248, 250, 252, 0.95)';
      ctx.font = 'italic 900 0.42px "Arial Black", Impact, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('PICKLEBALL.COM', 0, 0);
      // Stylized P emblem on outer left (which is -Y in rotated -90 deg space)
      ctx.lineWidth = 0.065;
      ctx.beginPath();
      ctx.roundRect(-0.42, -0.92, 0.64, 0.54, 0.14);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-0.10, -0.92);
      ctx.lineTo(-0.10, -0.38);
      ctx.stroke();
      ctx.restore();
    });

    // Stencil E: Right Mid-Apron `VERSIX PICKLEBALL` logo (at X = +3.74m, Z = -2.95m, rotated along sideline)
    withWorldTransform(3.74, -2.95, Math.PI / 2, () => {
      ctx.save();
      ctx.fillStyle = 'rgba(248, 250, 252, 0.92)';
      ctx.strokeStyle = 'rgba(248, 250, 252, 0.92)';
      ctx.font = 'italic 900 0.36px "Arial Black", Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('VERSI', -0.18, -0.04);
      ctx.lineWidth = 0.055;
      ctx.beginPath();
      ctx.moveTo(0.38, -0.26);
      ctx.lineTo(0.84, 0.24);
      ctx.moveTo(0.88, -0.30);
      ctx.lineTo(0.32, 0.28);
      ctx.stroke();
      ctx.font = '800 0.13px Inter, sans-serif';
      ctx.fillText('PICKLEBALL', -0.12, 0.20);
      ctx.restore();
    });

    // Stencil F: Right Near-Apron huge `THORLO` wordmark (at X = +4.18m, Z = +4.65m, rotated along sideline)
    withWorldTransform(4.18, 4.65, Math.PI / 2, () => {
      ctx.save();
      ctx.fillStyle = 'rgba(248, 250, 252, 0.95)';
      ctx.font = '900 0.62px "Arial Black", Impact, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('THORLO', 0, 0);
      ctx.restore();
    });

    // Official USAPA 2-inch Crisp White Court Lines (#ffffff)
    const lineW = (0.054 / worldW) * W;
    const lineH = (0.054 / worldL) * H;
    ctx.fillStyle = '#ffffff';

    // Baselines & Sidelines
    ctx.fillRect(xLeft - lineW * 0.5, zNorth - lineH * 0.5, xRight - xLeft + lineW, lineH);
    ctx.fillRect(xLeft - lineW * 0.5, zSouth - lineH * 0.5, xRight - xLeft + lineW, lineH);
    ctx.fillRect(xLeft - lineW * 0.5, zNorth - lineH * 0.5, lineW, zSouth - zNorth + lineH);
    ctx.fillRect(xRight - lineW * 0.5, zNorth - lineH * 0.5, lineW, zSouth - zNorth + lineH);

    // Non-Volley Zone (Kitchen) lines at Z = ±2.1336m
    ctx.fillRect(xLeft, zNvzNorth - lineH * 0.5, xRight - xLeft, lineH);
    ctx.fillRect(xLeft, zNvzSouth - lineH * 0.5, xRight - xLeft, lineH);

    // Center Service Lines from Kitchen line (±2.1336m) to Baselines (±6.7056m)
    const xCenter = uFromX(0);
    ctx.fillRect(xCenter - lineW * 0.5, zNorth, lineW, zNvzNorth - zNorth);
    ctx.fillRect(xCenter - lineW * 0.5, zNvzSouth, lineW, zSouth - zNvzSouth);

    // Realistic Silica-Sand Micro-Grit Bump Map
    const bumpCanvas = document.createElement('canvas');
    bumpCanvas.width = 512;
    bumpCanvas.height = 512;
    const bCtx = bumpCanvas.getContext('2d');
    const imgData = bCtx.createImageData(512, 512);
    let seed = 1337;
    for (let i = 0; i < imgData.data.length; i += 4) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      const g = 118 + (seed & 0x1b);
      imgData.data[i] = g;
      imgData.data[i + 1] = g;
      imgData.data[i + 2] = g;
      imgData.data[i + 3] = 255;
    }
    bCtx.putImageData(imgData, 0, 0);

    const courtTex = new THREE.CanvasTexture(courtCanvas);
    courtTex.colorSpace = THREE.SRGBColorSpace;
    courtTex.anisotropy = maxAniso;

    const bumpTex = new THREE.CanvasTexture(bumpCanvas);
    bumpTex.wrapS = THREE.RepeatWrapping;
    bumpTex.wrapT = THREE.RepeatWrapping;
    bumpTex.repeat.set(24, 48);

    const masterCourtMat = new THREE.MeshStandardMaterial({
      map: courtTex,
      bumpMap: bumpTex,
      bumpScale: 0.002,
      roughness: 0.56,
      metalness: 0.05,
    });

    // Add dedicated precision 11.70m x 19.00m court surface plane at y = 0.004m
    const masterCourtPlane = new THREE.Mesh(
      new THREE.PlaneGeometry(worldW, worldL).rotateX(-Math.PI / 2),
      masterCourtMat
    );
    masterCourtPlane.name = 'PPA_Master_Court_Surface';
    masterCourtPlane.position.set(0, 0.004, 0);
    masterCourtPlane.receiveShadow = true;
    courtRoot.add(masterCourtPlane);

    // Soft cast net shadow strip on the light-blue Kitchen floor right beneath the net
    const netShadowPlane = new THREE.Mesh(
      new THREE.PlaneGeometry(6.16, 0.22).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({
        color: 0x091538,
        transparent: true,
        opacity: 0.28,
        depthWrite: false,
      })
    );
    netShadowPlane.position.set(0, 0.0055, 0.14);
    courtRoot.add(netShadowPlane);

    // 2. Woven Black Cord Net Mesh Texture
    const netCanvas = document.createElement('canvas');
    netCanvas.width = 128;
    netCanvas.height = 128;
    const nCtx = netCanvas.getContext('2d');
    nCtx.clearRect(0, 0, 128, 128);
    nCtx.fillStyle = 'rgba(10, 15, 28, 0.16)';
    nCtx.fillRect(0, 0, 128, 128);
    nCtx.strokeStyle = 'rgba(10, 15, 28, 0.94)';
    nCtx.lineWidth = 20;
    nCtx.strokeRect(0, 0, 128, 128);
    const netTex = new THREE.CanvasTexture(netCanvas);
    netTex.wrapS = THREE.RepeatWrapping;
    netTex.wrapT = THREE.RepeatWrapping;
    netTex.repeat.set(110, 14);
    netTex.anisotropy = maxAniso;

    const steelPostMat = new THREE.MeshStandardMaterial({
      color: 0x0f172a,
      roughness: 0.32,
      metalness: 0.78,
    });
    const whiteTapeMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.38,
      metalness: 0.04,
    });

    courtRoot.traverse((child) => {
      if (!child.isMesh || child.name === 'PPA_Master_Court_Surface') return;
      child.receiveShadow = true;

      const matName = child.material ? child.material.name || '' : '';
      if (matName === 'Concrete_Perimeter_Curb_Mat') {
        // Hide old raised concrete curb so the royal-blue apron is seamless to the LED barriers
        child.visible = false;
      } else if (child.name === 'Court_Surface' || matName === 'Court_Acrylic_Concrete_Mat') {
        child.visible = false;
      } else if (
        child.name === 'Net_Mesh' ||
        matName === 'Net_Mesh_Black_Mat' ||
        matName === 'Net_CordMesh_Mat'
      ) {
        child.castShadow = true;
        child.material = new THREE.MeshStandardMaterial({
          color: 0x0f172a,
          map: netTex,
          transparent: true,
          opacity: 0.86,
          roughness: 0.72,
          side: THREE.DoubleSide,
        });
      } else if (matName === 'Net_Tape_White_Mat' || matName === 'Court_WhiteLine_Mat') {
        child.material = whiteTapeMat;
      } else if (matName === 'Net_Post_Steel_Mat' || matName === 'Net_SteelPost_Mat') {
        child.castShadow = true;
        child.material = steelPostMat;
      }
    });

    // 3. Portable Pro Net Hardware: Bottom Black Stabilizer Bar, Post Base Feet, Center Strap & FILA Side Banners
    const netHardwareGroup = new THREE.Group();
    netHardwareGroup.name = 'PPA_Portable_Net_Hardware';

    // Bottom horizontal black steel tension stabilizer bar right above the court surface
    const bottomBar = new THREE.Mesh(
      new THREE.BoxGeometry(6.24, 0.038, 0.038),
      steelPostMat
    );
    bottomBar.position.set(0, 0.032, 0);
    bottomBar.castShadow = true;
    netHardwareGroup.add(bottomBar);

    // Center black stabilizer foot + white vertical center strap
    const centerFoot = new THREE.Mesh(
      new THREE.BoxGeometry(0.12, 0.042, 0.18),
      steelPostMat
    );
    centerFoot.position.set(0, 0.021, 0);
    const centerStrap = new THREE.Mesh(
      new THREE.BoxGeometry(0.052, 0.8636, 0.034),
      whiteTapeMat
    );
    centerStrap.position.set(0, 0.4318, 0);
    centerStrap.castShadow = true;
    netHardwareGroup.add(centerFoot, centerStrap);

    // Left & Right Portable Net Posts & Horizontal Stabilizer T-Base Feet (at x = ±3.12m)
    for (const xSign of [-1, 1]) {
      const px = xSign * 3.12;
      const post = new THREE.Mesh(
        new THREE.BoxGeometry(0.07, 0.95, 0.07),
        steelPostMat
      );
      post.position.set(px, 0.475, 0);
      post.castShadow = true;

      const baseFoot = new THREE.Mesh(
        new THREE.BoxGeometry(0.08, 0.042, 0.88),
        steelPostMat
      );
      baseFoot.position.set(px, 0.021, 0);
      baseFoot.castShadow = true;
      netHardwareGroup.add(post, baseFoot);
    }

    // Two Vertical `FILA` Banner Panels at Left (x = -2.72m) & Right (x = +2.72m) ends of the net
    const filaCanvas = document.createElement('canvas');
    filaCanvas.width = 256;
    filaCanvas.height = 512;
    const fCtx = filaCanvas.getContext('2d');
    // Royal-blue outer vertical sleeve
    fCtx.fillStyle = '#15349c';
    fCtx.fillRect(0, 0, 256, 512);
    // Crisp white square logo card
    fCtx.fillStyle = '#ffffff';
    fCtx.fillRect(22, 92, 212, 328);
    // Authentic FILA 'F' logo: Navy top bar, Red middle bar, Navy vertical stem
    fCtx.fillStyle = '#0c1d5e';
    fCtx.beginPath();
    fCtx.roundRect(54, 138, 148, 46, [18, 0, 0, 0]);
    fCtx.fill();
    // Vertical navy stem on bottom-left
    fCtx.fillRect(54, 212, 52, 162);
    // Vibrant crimson-red middle bar
    fCtx.fillStyle = '#e11d48';
    fCtx.fillRect(114, 212, 82, 46);

    const filaTex = new THREE.CanvasTexture(filaCanvas);
    filaTex.colorSpace = THREE.SRGBColorSpace;
    filaTex.anisotropy = maxAniso;
    const filaMat = new THREE.MeshStandardMaterial({
      map: filaTex,
      roughness: 0.45,
      metalness: 0.05,
    });

    for (const bx of [-2.72, 2.72]) {
      const bannerBox = new THREE.Mesh(
        new THREE.BoxGeometry(0.46, 0.78, 0.032),
        filaMat
      );
      bannerBox.position.set(bx, 0.465, 0);
      bannerBox.castShadow = true;
      netHardwareGroup.add(bannerBox);
    }

    courtRoot.add(netHardwareGroup);
  }

  /**
   * Upgrades `this.assets.paddle` with a high-contrast Selkirk Pro Carbon Paddle Texture
   * (matte T700 raw carbon-fiber weave, crimson-red/white perimeter edge trim, and white Selkirk `S` logo).
   */
  upgradePaddleMaterials(paddleRoot) {
    const c = document.createElement('canvas');
    c.width = 512;
    c.height = 512;
    const ctx = c.getContext('2d');

    // Matte raw carbon-fiber weave background
    ctx.fillStyle = '#12151e';
    ctx.fillRect(0, 0, 512, 512);
    ctx.strokeStyle = 'rgba(255,255,255,0.045)';
    ctx.lineWidth = 4;
    for (let i = -512; i < 1024; i += 12) {
      ctx.beginPath();
      ctx.moveTo(i, 0);
      ctx.lineTo(i + 512, 512);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(i + 512, 0);
      ctx.lineTo(i, 512);
      ctx.stroke();
    }

    // Selkirk crimson-red & white inner perimeter accent stripe
    ctx.strokeStyle = '#e11d48';
    ctx.lineWidth = 22;
    ctx.beginPath();
    ctx.roundRect(36, 36, 440, 440, 64);
    ctx.stroke();

    // White Selkirk 'S' ribbon emblem in center of paddle face
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 30;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(315, 145);
    ctx.bezierCurveTo(155, 140, 155, 240, 256, 255);
    ctx.bezierCurveTo(355, 270, 355, 370, 195, 365);
    ctx.stroke();

    const paddleFaceTex = new THREE.CanvasTexture(c);
    paddleFaceTex.colorSpace = THREE.SRGBColorSpace;

    const carbonMat = new THREE.MeshStandardMaterial({
      map: paddleFaceTex,
      roughness: 0.38,
      metalness: 0.18,
    });
    const edgeGuardMat = new THREE.MeshStandardMaterial({
      color: 0xe11d48,
      roughness: 0.35,
      metalness: 0.15,
    });
    const gripMat = new THREE.MeshStandardMaterial({
      color: 0x0f172a,
      roughness: 0.65,
    });

    paddleRoot.traverse((child) => {
      if (!child.isMesh) return;
      child.castShadow = true;
      const mName = child.material ? child.material.name || '' : '';
      if (mName.includes('Carbon') || mName.includes('Face')) {
        child.material = carbonMat;
      } else if (mName.includes('EdgeGuard')) {
        child.material = edgeGuardMat;
      } else if (mName.includes('Grip')) {
        child.material = gripMat;
      }
    });

    // Add explicit double-sided Selkirk face graphic planes on both sides of the blade (y = ±0.0088, z = -0.205)
    const faceDecalGeo = new THREE.PlaneGeometry(0.165, 0.23).rotateX(-Math.PI / 2);
    const topDecal = new THREE.Mesh(faceDecalGeo, carbonMat);
    topDecal.position.set(0, 0.0088, -0.205);
    const botDecal = new THREE.Mesh(faceDecalGeo, carbonMat);
    botDecal.position.set(0, -0.0088, -0.205);
    botDecal.rotation.z = Math.PI;
    paddleRoot.add(topDecal, botDecal);
  }

  /**
   * Implements mandatory fallback for <dialog closedby="any"> light-dismiss
   * per modern-web-guidance ('light-dismiss-a-dialog')
   */
  initModalFallback() {
    const dialog = document.getElementById('rules-modal');
    if (!dialog) return;

    if (!('closedBy' in HTMLDialogElement.prototype)) {
      dialog.addEventListener('click', (event) => {
        if (event.target !== dialog) return;
        const rect = dialog.getBoundingClientRect();
        const isDialogContent =
          rect.top <= event.clientY &&
          event.clientY <= rect.top + rect.height &&
          rect.left <= event.clientX &&
          event.clientX <= rect.left + rect.width;
        if (isDialogContent) return;
        dialog.close();
      });
    }
  }

  async loadAllAssets() {
    const loader = new GLTFLoader();
    const loadGLB = (url) =>
      new Promise((resolve, reject) => {
        loader.load(url, resolve, undefined, reject);
      });

    try {
      const [courtGltf, paddleGltf, ballGltf, maleGltf, femaleGltf] = await Promise.all([
        loadGLB('/assets/court.glb'),
        loadGLB('/assets/paddle.glb'),
        loadGLB('/assets/pickleball.glb'),
        loadGLB('/assets/player_male.glb'),
        loadGLB('/assets/player_female.glb'),
      ]);

      this.assets.court = courtGltf.scene;
      this.assets.paddle = paddleGltf.scene;
      this.assets.ball = ballGltf.scene;
      this.assets.maleGltf = maleGltf;
      this.assets.femaleGltf = femaleGltf;

      // Upgrade 20x44ft USAPA Court with PPA Tour 2025 Stencils & FILA Net
      this.upgradeCourtMaterials(this.assets.court);
      this.scene.add(this.assets.court);

      // Upgrade Paddle with Selkirk Pro Carbon Face & Red Edge Guard
      this.upgradePaddleMaterials(this.assets.paddle);

      // Add 40-Hole USAPA Pickleball with optic neon-yellow finish
      this.ballMesh = this.assets.ball;
      this.ballMesh.traverse((c) => {
        if (c.isMesh) {
          c.castShadow = true;
          c.receiveShadow = true;
          if (c.material) {
            c.material.color.setHex(0xd9f926);
            c.material.emissive = new THREE.Color(0x65a30d);
            c.material.emissiveIntensity = 0.18;
            c.material.roughness = 0.28;
            c.material.metalness = 0.04;
          }
        }
      });
      this.scene.add(this.ballMesh);

      // Subtle vertical golden-white strike motion streak for showcase/impact moments
      const streakCanvas = document.createElement('canvas');
      streakCanvas.width = 64;
      streakCanvas.height = 256;
      const sCtx = streakCanvas.getContext('2d');
      const sGrad = sCtx.createLinearGradient(32, 0, 32, 256);
      sGrad.addColorStop(0, 'rgba(255, 255, 255, 0)');
      sGrad.addColorStop(0.35, 'rgba(254, 240, 138, 0.75)');
      sGrad.addColorStop(0.5, 'rgba(255, 255, 255, 0.95)');
      sGrad.addColorStop(0.65, 'rgba(254, 240, 138, 0.75)');
      sGrad.addColorStop(1, 'rgba(255, 255, 255, 0)');
      sCtx.fillStyle = sGrad;
      sCtx.fillRect(20, 0, 24, 256);
      const streakTex = new THREE.CanvasTexture(streakCanvas);
      this.strikeFlashMesh = new THREE.Mesh(
        new THREE.PlaneGeometry(0.16, 1.35),
        new THREE.MeshBasicMaterial({
          map: streakTex,
          transparent: true,
          opacity: 0.85,
          depthWrite: false,
          side: THREE.DoubleSide,
        })
      );
      this.strikeFlashMesh.visible = false;
      this.scene.add(this.strikeFlashMesh);

      // Build 4 Lifelike Rigged Human Athletes (Arjun, Priya, Vikram, Ananya) with Pro Kits
      this.createAthletes();

      // Populate Courtside VIP Sofa Lounge with 2 Relaxed Seated Spectators
      this.populateHumanUmpireAndSpectators();

      // Hide loading screen & launch in Doubles Showcase Pose (matching media_1792490611048.png)
      const loadingEl = document.getElementById('loading-overlay');
      if (loadingEl) loadingEl.classList.add('hidden');

      this.startMode('doubles', 0);
      this.triggerShowcasePose();
      this.animate();
    } catch (err) {
      console.error('Error loading GLB assets:', err);
      const statusEl = document.getElementById('loading-status');
      if (statusEl) {
        statusEl.textContent = `Asset load error: ${err.message}`;
      }
    }
  }

  /**
   * Generates a 1024x1024 UV-mapped human facial & skin texture with subsurface warmth,
   * orbital/nasolabial/jawline anatomical shading, pores, and realistic male beard/stubble.
   */
  createHumanSkinTexture(baseHex, isFemale = false) {
    const canvas = document.createElement('canvas');
    canvas.width = 1024;
    canvas.height = 1024;
    const ctx = canvas.getContext('2d');

    const baseColor = new THREE.Color(baseHex);
    const r0 = Math.round(baseColor.r * 255);
    const g0 = Math.round(baseColor.g * 255);
    const b0 = Math.round(baseColor.b * 255);

    ctx.fillStyle = `rgb(${r0}, ${g0}, ${b0})`;
    ctx.fillRect(0, 0, 1024, 1024);

    // Helper that converts exact 3D head vertex height vz (in meters) to canvas Y coordinate
    const yFromZ = (vz) => (1.0 - (vz - 1.415) / (1.755 - 1.415)) * 1024;

    // Subtle organic skin pore & melanin micro-variation across entire skin surface
    for (let i = 0; i < 14000; i++) {
      const x = Math.random() * 1024;
      const y = Math.random() * 1024;
      const delta = (Math.random() - 0.48) * 10;
      ctx.fillStyle = `rgba(${Math.max(0, Math.min(255, r0 + delta))}, ${Math.max(0, Math.min(255, g0 + delta * 0.85))}, ${Math.max(0, Math.min(255, b0 + delta * 0.75))}, 0.12)`;
      ctx.fillRect(x, y, 2, 2);
    }

    const paintRadialZone = (cx, cy, rx, ry, colorStr) => {
      ctx.save();
      ctx.translate(cx, cy);
      ctx.scale(rx, ry);
      const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
      grad.addColorStop(0, colorStr);
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(0, 0, 1, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    };

    // Forehead & T-zone warm highlight (vz = 1.675)
    paintRadialZone(512, yFromZ(1.675), 88, 42, 'rgba(255, 228, 205, 0.18)');
    // Nose bridge highlight (vz = 1.632)
    paintRadialZone(512, yFromZ(1.632), 16, 48, 'rgba(255, 232, 212, 0.22)');
    // Zygomatic cheek subsurface warmth (vz = 1.622)
    paintRadialZone(436, yFromZ(1.622), 48, 36, isFemale ? 'rgba(215, 85, 78, 0.22)' : 'rgba(190, 78, 66, 0.14)');
    paintRadialZone(588, yFromZ(1.622), 48, 36, isFemale ? 'rgba(215, 85, 78, 0.22)' : 'rgba(190, 78, 66, 0.14)');
    // Nose tip subsurface warmth (vz = 1.608)
    paintRadialZone(512, yFromZ(1.608), 22, 18, 'rgba(195, 78, 66, 0.15)');

    // Subtle orbital eye socket shading centered right at the eyes (vz = 1.645, x = 458, 566)
    paintRadialZone(458, yFromZ(1.645), 34, 22, 'rgba(42, 18, 14, 0.22)');
    paintRadialZone(566, yFromZ(1.645), 34, 22, 'rgba(42, 18, 14, 0.22)');

    // Nasolabial smile-line creases from nostril wings (vz = 1.604) to mouth corners (vz = 1.580)
    ctx.strokeStyle = 'rgba(52, 24, 16, 0.18)';
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(488, yFromZ(1.604));
    ctx.quadraticCurveTo(472, yFromZ(1.592), 476, yFromZ(1.578));
    ctx.moveTo(536, yFromZ(1.604));
    ctx.quadraticCurveTo(552, yFromZ(1.592), 548, yFromZ(1.578));
    ctx.stroke();

    // Labiomental crease under lower lip (vz = 1.564) & Chin boss highlight (vz = 1.546)
    paintRadialZone(512, yFromZ(1.564), 28, 10, 'rgba(45, 20, 14, 0.18)');
    paintRadialZone(512, yFromZ(1.546), 28, 18, 'rgba(255, 226, 202, 0.16)');

    // Groomed male athlete 5-o'clock beard/jawline shading strictly on the jaw/chin/mustache (vz = 1.540..1.594)
    if (!isFemale) {
      const yMustache = yFromZ(1.591);
      const yMouth = yFromZ(1.581);
      const yChin = yFromZ(1.548);
      const yJawTop = yFromZ(1.592);
      const yJawBot = yFromZ(1.540);

      paintRadialZone(512, yMustache, 38, 12, 'rgba(24, 18, 16, 0.18)');
      paintRadialZone(512, yChin, 52, 26, 'rgba(24, 18, 16, 0.16)');
      paintRadialZone(438, yFromZ(1.568), 54, 42, 'rgba(24, 18, 16, 0.14)');
      paintRadialZone(586, yFromZ(1.568), 54, 42, 'rgba(24, 18, 16, 0.14)');

      ctx.fillStyle = 'rgba(22, 16, 14, 0.22)';
      for (let i = 0; i < 1800; i++) {
        const fx = 370 + Math.random() * 284;
        const fy = yJawTop + Math.random() * (yJawBot - yJawTop);
        const dx = (fx - 512) / 142;
        const dy = (fy - 0.5 * (yJawTop + yJawBot)) / (0.5 * (yJawBot - yJawTop));
        const distSq = dx * dx + dy * dy;
        const inMouthHole = Math.abs(fx - 512) < 36 && Math.abs(fy - yMouth) < 22;
        const inUpperCheek = Math.abs(fx - 512) < 88 && fy < yMustache + 6 && Math.abs(fx - 512) > 36;
        if (distSq <= 1.0 && !inMouthHole && !inUpperCheek) {
          ctx.fillRect(fx, fy, 1.5, 1.8);
        }
      }
    }

    const tex = new THREE.CanvasTexture(canvas);
    tex.flipY = false;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.needsUpdate = true;
    return tex;
  }

  /**
   * Builds the 4 PPA Tour 2025 Athletes styled to match `media_1792490611048.png`:
   * - `p0` (Arjun - Near Left Male): Sky/ice-blue long-sleeve shirt (#8ec5fc), vibrant purple/magenta shorts (#a82ae3), dark crew socks (#111827), coral-red/white shoes (#ef4444).
   * - `p1` (Priya - Near Right Female): Crisp white/ice-blue fitted racquet top (#e2f1ff), black athletic shorts/skort (#111827), black sports visor (#111827) + golden-brown ponytail (#9a6e3a), coral-pink shoes (#f45b69).
   * - `p2` (Vikram - Far Left Male): Black pro jersey (#111827) with white long compression sleeves (#f8fafc) & white headband, black shorts (#111827), white socks, red/white shoes.
   * - `p3` (Ananya - Far Right Female): Sky-blue fitted tank top (#7dd3fc), black pleated court skirt (#111827), dark navy visor/cap (#0f172a), dark/white shoes.
   */
  createAthletes() {
    const configs = [
      {
        id: 'p0',
        name: 'Arjun (You)',
        gender: 'male',
        team: 0,
        isHuman: true,
        skinHex: 0xd89c7a,
        jerseyHex: 0x8ec5fc,
        trimHex: 0xdbeafe,
        shortsHex: 0xa82ae3,
        sockHex: 0x111827,
        shoeHex: 0xef4444,
        soleHex: 0xf8fafc,
        hairHex: 0x2b1d14,
        sleeveHex: 0x8ec5fc,
        headwear: null,
      },
      {
        id: 'p1',
        name: 'Priya (Partner)',
        gender: 'female',
        team: 0,
        isHuman: false,
        skinHex: 0xd4956e,
        jerseyHex: 0xe2f1ff,
        trimHex: 0xbae6fd,
        shortsHex: 0x111827,
        sockHex: 0x111827,
        shoeHex: 0xf45b69,
        soleHex: 0xfda4af,
        hairHex: 0x9c723c,
        sleeveHex: null,
        headwear: 'visor_black',
      },
      {
        id: 'p2',
        name: 'Vikram (AI)',
        gender: 'male',
        team: 1,
        isHuman: false,
        skinHex: 0xc98a67,
        jerseyHex: 0x111827,
        trimHex: 0xf8fafc,
        shortsHex: 0x111827,
        sockHex: 0xf8fafc,
        shoeHex: 0xef4444,
        soleHex: 0xf8fafc,
        hairHex: 0x1e1510,
        sleeveHex: 0xf8fafc,
        headwear: 'headband_white',
      },
      {
        id: 'p3',
        name: 'Ananya (AI)',
        gender: 'female',
        team: 1,
        isHuman: false,
        skinHex: 0xd69872,
        jerseyHex: 0x7dd3fc,
        trimHex: 0xe0f2fe,
        shortsHex: 0x111827,
        sockHex: 0x111827,
        shoeHex: 0x1e293b,
        soleHex: 0xf8fafc,
        hairHex: 0xad8247,
        sleeveHex: null,
        headwear: 'visor_navy',
      },
    ];

    this.players = configs.map((cfg) => {
      const srcGltf = cfg.gender === 'female' ? this.assets.femaleGltf : this.assets.maleGltf;
      const root = SkeletonUtils.clone(srcGltf.scene);
      root.name = `Player_${cfg.id}`;

      const humanSkinTex = this.createHumanSkinTexture(cfg.skinHex, cfg.gender === 'female');

      let skinnedMesh = null;
      const skinnedMeshes = [];
      const bones = {};
      let hasNativeSleeve = false;
      let hasNativeHeadwear = false;

      root.traverse((child) => {
        if (child.isBone) {
          bones[child.name] = child;
        }
        if (child.isMesh) {
          child.castShadow = true;
          child.receiveShadow = true;
          if (/sleeve/i.test(child.name)) hasNativeSleeve = true;
          if (/visor|headband|cap/i.test(child.name)) hasNativeHeadwear = true;

          if (child.isSkinnedMesh) {
            skinnedMesh = child;
            skinnedMeshes.push(child);
            if (child.morphTargetInfluences) {
              child.morphTargetInfluences.fill(0);
            }
          }

          if (Array.isArray(child.material)) {
            child.material = child.material.map((m) => (m ? m.clone() : m));
          } else if (child.material) {
            child.material = child.material.clone();
          }

          const mats = Array.isArray(child.material) ? child.material : [child.material];
          mats.forEach((m) => {
            if (!m) return;
            const mName = m.name || '';
            if (/sleeve/i.test(mName)) hasNativeSleeve = true;
            if (/visor|headband|cap/i.test(mName)) hasNativeHeadwear = true;

            if (mName.startsWith('Lips_')) {
              m.color.setHex(cfg.gender === 'female' ? 0xb5534c : 0x944840);
              m.roughness = 0.36;
            } else if (mName.startsWith('IndianSkin_') || mName.startsWith('Cheek_') || /skin/i.test(mName)) {
              m.color.setHex(0xffffff);
              m.map = humanSkinTex;
              m.roughness = 0.44;
              m.metalness = 0.02;
              m.envMapIntensity = 0.25;
              m.needsUpdate = true;
            } else if (/hair/i.test(mName)) {
              m.color.setHex(cfg.hairHex);
              m.roughness = 0.78;
              m.metalness = 0.04;
              m.envMapIntensity = 0.18;
            } else if (/jersey|shirt|top|tank/i.test(mName)) {
              m.color.setHex(cfg.jerseyHex);
              m.roughness = 0.58;
            } else if (/collar|trim/i.test(mName)) {
              m.color.setHex(cfg.trimHex);
              m.roughness = 0.52;
            } else if (/sleeve/i.test(mName)) {
              if (cfg.sleeveHex) {
                m.color.setHex(cfg.sleeveHex);
                m.roughness = 0.54;
              } else {
                m.color.setHex(0xffffff);
                m.map = humanSkinTex;
                m.roughness = 0.44;
                m.needsUpdate = true;
              }
            } else if (/short|bottom|skirt|skort/i.test(mName)) {
              m.color.setHex(cfg.shortsHex);
              m.roughness = 0.62;
            } else if (/sock/i.test(mName)) {
              m.color.setHex(cfg.sockHex);
              m.roughness = 0.72;
            } else if (/shoe_whitemesh|accent|shoe/i.test(mName) && !/gum|rubber|sole/i.test(mName)) {
              m.color.setHex(cfg.shoeHex);
              m.roughness = 0.42;
            } else if (/gum|rubber|sole/i.test(mName)) {
              m.color.setHex(cfg.soleHex);
              m.roughness = 0.55;
            } else if (/visor|cap|headband/i.test(mName)) {
              if (!cfg.headwear) {
                m.color.setHex(cfg.hairHex);
                m.roughness = 0.78;
              } else if (cfg.headwear === 'headband_white') {
                m.color.setHex(0xf8fafc);
                m.roughness = 0.45;
              } else {
                m.color.setHex(0x111827);
                m.roughness = 0.45;
              }
            }
          });
        }
      });

      // Add high-contrast white chest sponsor graphic on p2's black jersey + taller crew socks on p0
      if (cfg.id === 'p2' && bones.Chest) {
        const chestBadge = new THREE.Mesh(
          new THREE.PlaneGeometry(0.16, 0.055),
          new THREE.MeshBasicMaterial({ color: 0xf8fafc, transparent: true, opacity: 0.88 })
        );
        chestBadge.position.set(0, 0.06, 0.126);
        bones.Chest.add(chestBadge);
      }
      if (cfg.id === 'p0') {
        const darkSockMat = new THREE.MeshStandardMaterial({ color: 0x111827, roughness: 0.75 });
        for (const side of ['L', 'R']) {
          const shin = bones[`Shin.${side}`];
          if (shin) {
            const crewSock = new THREE.Mesh(
              new THREE.CylinderGeometry(0.044, 0.036, 0.17, 12),
              darkSockMat
            );
            crewSock.position.set(0, 0.29, 0);
            shin.add(crewSock);
          }
        }
      }

      const headBone = bones.Head;

      // Attach cloned 3D Selkirk Carbon Paddle to Right Hand Bone
      const rightHandBone = bones['Hand.R'];
      const chestBone = bones.Chest;
      const paddleClone = this.assets.paddle.clone(true);
      paddleClone.traverse((c) => {
        if (c.isMesh) c.castShadow = true;
      });
      if (rightHandBone) {
        paddleClone.position.set(0, 0.04, 0);
        paddleClone.rotation.set(Math.PI * 0.5, 0, -Math.PI * 0.5);
        rightHandBone.add(paddleClone);
      } else {
        paddleClone.position.set(-0.32, 1.05, 0.28);
        root.add(paddleClone);
      }

      this.scene.add(root);

      // Set up THREE.AnimationMixer with all exported actions
      const mixer = new THREE.AnimationMixer(root);
      const actions = {};
      for (const clip of srcGltf.animations) {
        const cleanName = clip.name.replace(/^(Male_|Female_)/, '');
        const act = mixer.clipAction(clip);
        if (cleanName === 'Idle_SplitStep' || cleanName === 'Run_Footwork') {
          act.loop = THREE.LoopRepeat;
        } else {
          act.loop = THREE.LoopOnce;
          act.clampWhenFinished = true;
        }
        actions[cleanName] = act;
      }

      if (actions.Idle_SplitStep) {
        actions.Idle_SplitStep.play();
      }

      mixer.addEventListener('finished', () => {
        if (!this.showcaseFreeze) {
          this.transitionPlayerAnim(playerObj, 'Idle_SplitStep', 0.22);
        }
      });

      const playerObj = {
        ...cfg,
        root,
        bones,
        skinnedMesh,
        skinnedMeshes,
        headBone,
        chestBone,
        paddleMesh: paddleClone,
        mixer,
        actions,
        currentAnim: 'Idle_SplitStep',
        pos: new THREE.Vector3(0, 0, cfg.team === 0 ? 6.8 : -6.8),
        vel: new THREE.Vector3(),
        homePos: new THREE.Vector3(0, 0, cfg.team === 0 ? 6.8 : -6.8),
        active: true,
        roleLabel: cfg.team === 0 ? 'SERVER' : 'RECEIVER',
        expression: 'Basis',
        emotionBubbleText: '',
        expressionTargets: { Celebration: 0, Frustration: 0, Effort: 0, Surprise: 0 },
        expressionTimer: 0,
        swingCooldown: 0,
      };

      return playerObj;
    });

    this.focusedEmotionPlayer = this.players[0];
  }

  /**
   * Populates the Courtside VIP Lounge Sofa (Upper-Left) with 2 relaxed, articulated
   * seated 3D human spectators watching the match (matching media_1792490611048.png).
   */
  populateHumanUmpireAndSpectators() {
    if (!this.assets.maleGltf || !this.spectatorSeatAnchors) return;

    const findSeatedClip = (gltf) =>
      gltf.animations.find((c) => c.name.includes('Seated_Spectator')) || gltf.animations[0];

    this.spectators = [];
    this.spectatorSeatAnchors.forEach((seat, idx) => {
      const specRoot = SkeletonUtils.clone(this.assets.maleGltf.scene);
      specRoot.name = `VIP_Lounge_Spectator_${idx}`;
      const skinTex = this.createHumanSkinTexture(seat.skinHex, false);
      let headBone = null;
      const specBones = {};

      specRoot.traverse((child) => {
        if (child.isBone) {
          specBones[child.name] = child;
          if (child.name === 'Head') headBone = child;
        }
        if (child.isMesh) {
          child.castShadow = true;
          child.receiveShadow = true;
          child.frustumCulled = false;
          if (Array.isArray(child.material)) {
            child.material = child.material.map((m) => (m ? m.clone() : m));
          } else if (child.material) {
            child.material = child.material.clone();
          }
          const mats = Array.isArray(child.material) ? child.material : [child.material];
          mats.forEach((m) => {
            if (!m) return;
            const mName = m.name || '';
            if (mName.startsWith('IndianSkin_') || mName.startsWith('Cheek_') || /sleeve/i.test(mName)) {
              m.color.setHex(0xffffff);
              m.map = skinTex;
              m.roughness = 0.46;
              m.needsUpdate = true;
            } else if (/jersey|shirt|collar|trim/i.test(mName)) {
              m.color.setHex(seat.shirtHex);
              m.roughness = 0.72;
            } else if (/short|bottom|sock/i.test(mName)) {
              m.color.setHex(seat.pantsHex);
              m.roughness = 0.78;
            } else if (/hair|headband|visor/i.test(mName)) {
              m.color.setHex(seat.hairHex);
              m.roughness = 0.78;
            } else if (/shoe|accent/i.test(mName)) {
              m.color.setHex(seat.shoeHex);
            }
          });
        }
      });

      const specMixer = new THREE.AnimationMixer(specRoot);
      const seatedClip = findSeatedClip(this.assets.maleGltf);
      if (seatedClip) {
        const act = specMixer.clipAction(seatedClip);
        act.play();
        specMixer.update(0.05);
      }

      specRoot.scale.setScalar(0.86);
      specRoot.position.copy(seat.localPos);
      specRoot.rotation.y = seat.localRotY;
      specRoot.updateMatrixWorld(true);

      seat.parentGroup.add(specRoot);
      this.spectators.push({
        mesh: specRoot,
        headBone,
        baseY: seat.localPos.y,
        xSign: -1,
        zSeat: -6.8,
        phase: idx * 1.2,
      });
    });
  }

  /**
   * Smoothly crossfades an athlete's skeletal animation state
   */
  transitionPlayerAnim(player, animName, fadeSec = 0.16) {
    if (!player || !player.actions[animName]) return;
    if (
      player.currentAnim === animName &&
      (animName === 'Idle_SplitStep' || animName === 'Run_Footwork')
    ) {
      return;
    }
    const prevAct = player.actions[player.currentAnim];
    const nextAct = player.actions[animName];
    nextAct.reset();
    nextAct.play();
    if (prevAct && prevAct !== nextAct) {
      prevAct.crossFadeTo(nextAct, fadeSec, false);
    }
    player.currentAnim = animName;

    if (player.isHuman) {
      const animBadge = document.getElementById('hud-anim-state');
      if (animBadge) animBadge.textContent = animName.replace('_', ' ');
    }
  }

  /**
   * Triggers a rich human facial expression (Shape Key) + optional body language & speech bubble:
   * 'Basis' | 'Celebration' | 'Frustration' | 'Effort' | 'Surprise'
   */
  setPlayerExpression(player, exprName, durationSec = 2.8, customBubble = null, playBodyAnim = false) {
    if (!player) return;
    player.expression = exprName;
    player.expressionTimer = durationSec;
    player.expressionTargets = {
      Celebration: exprName === 'Celebration' ? 0.72 : 0.0,
      Frustration: exprName === 'Frustration' ? 0.72 : 0.0,
      Effort: exprName === 'Effort' ? 0.68 : 0.0,
      Surprise: exprName === 'Surprise' ? 0.68 : 0.0,
    };

    const defaultPhrases = {
      Celebration: ['😄 "YES! Let\'s go!"', '😄 "Great point!"', '😄 "Right on the line!"'],
      Frustration: ['😤 "Ugh, my bad!"', '😤 "Missed the sweet spot!"', '😤 "Gotta focus!"'],
      Effort: ['🔥 "MAX EFFORT!"', '🔥 "Rip it!"'],
      Surprise: ['😮 "Whoa! What a reflex!"', '😮 "Net cord!"'],
      Basis: [''],
    };
    const pool = defaultPhrases[exprName] || [''];
    player.emotionBubbleText =
      customBubble !== null ? customBubble : pool[Math.floor(Math.random() * pool.length)];

    if (playBodyAnim) {
      if (exprName === 'Celebration' && player.actions.Celebrate_FistPump) {
        this.transitionPlayerAnim(player, 'Celebrate_FistPump', 0.14);
      } else if (exprName === 'Frustration' && player.actions.Frustrated_Slump) {
        this.transitionPlayerAnim(player, 'Frustrated_Slump', 0.14);
      }
    }

    if (player.isHuman) {
      this.focusedEmotionPlayer = player;
      const exprEl = document.getElementById('hud-face-state');
      if (exprEl) {
        const icons = {
          Basis: '😐 Calm & Focused',
          Celebration: '😄 Joyful Smile!',
          Frustration: '😤 Upset / Frustrated',
          Effort: '🔥 Intense Grit',
          Surprise: '😮 Surprised Gasp!',
        };
        exprEl.textContent = icons[exprName] || exprName;
      }
    }
  }

  updatePlayerMorphTargets(player, dt) {
    const meshes = player.skinnedMeshes && player.skinnedMeshes.length > 0
      ? player.skinnedMeshes
      : player.skinnedMesh
      ? [player.skinnedMesh]
      : [];
    if (meshes.length === 0) return;

    if (player.expressionTimer > 0) {
      player.expressionTimer -= dt;
      if (player.expressionTimer <= 0) {
        player.expression = 'Basis';
        player.emotionBubbleText = '';
        player.expressionTargets = { Celebration: 0, Frustration: 0, Effort: 0, Surprise: 0 };
        if (player.isHuman) {
          const exprEl = document.getElementById('hud-face-state');
          if (exprEl) exprEl.textContent = '😐 Calm & Focused';
        }
      }
    }

    const alpha = Math.min(1, dt * 8.5);
    for (const sm of meshes) {
      const dict = sm.morphTargetDictionary;
      const infl = sm.morphTargetInfluences;
      if (!dict || !infl) continue;

      for (const key of ['Celebration', 'Frustration', 'Effort', 'Surprise']) {
        const idx = dict[key];
        if (idx !== undefined) {
          const targetVal = player.expressionTargets[key] || 0;
          infl[idx] = THREE.MathUtils.lerp(infl[idx], targetVal, alpha);
        }
      }
    }
  }

  /**
   * Sets the initial PPA Tour 2025 Championship Doubles action pose matching the reference broadcast photo:
   * - p0 (Near-Left, sky-blue long sleeve + purple shorts): at kitchen line (-1.35, 0, 2.25)
   * - p1 (Near-Right, white/ice-blue top + black shorts + blonde ponytail + black visor): lunging at kitchen line (1.02, 0, 2.12) with floating green "PERFECT" callout
   * - p2 (Far-Left, black over white long sleeve + white headband): at far kitchen (-1.32, 0, -2.25)
   * - p3 (Far-Right, sky-blue tank + black skirt + dark visor): at far kitchen (1.25, 0, -2.28)
   * - Neon-yellow pickleball mid-flight right in front of p1's paddle at (0.76, 0.94, 1.48)
   */
  triggerShowcasePose() {
    if (!this.players || this.players.length < 4) return;
    this.showcaseFreeze = true;
    this.physics.inPlay = false;

    const showcaseSpecs = [
      { idx: 0, x: -1.35, z: 2.25, yaw: Math.PI - 0.12, anim: 'Idle_SplitStep', animTime: 0.20 },
      { idx: 1, x: 1.02, z: 2.12, yaw: Math.PI + 0.36, anim: 'Dink_Crosscourt', animTime: 0.52 },
      { idx: 2, x: -1.32, z: -2.25, yaw: 0.14, anim: 'Idle_SplitStep', animTime: 0.42 },
      { idx: 3, x: 1.25, z: -2.28, yaw: -0.15, anim: 'Idle_SplitStep', animTime: 0.10 },
    ];

    showcaseSpecs.forEach((sp) => {
      const p = this.players[sp.idx];
      if (!p) return;
      p.active = true;
      p.root.visible = true;
      p.pos.set(sp.x, 0, sp.z);
      p.homePos.set(sp.x, 0, sp.z);
      p.vel.set(0, 0, 0);
      p.root.position.copy(p.pos);
      p.root.rotation.y = sp.yaw;

      const animKey = p.actions[sp.anim] ? sp.anim : 'Idle_SplitStep';
      this.transitionPlayerAnim(p, animKey, 0.01);
      if (p.actions[animKey]) {
        p.actions[animKey].time = sp.animTime;
      }
      p.mixer.update(0.016);
    });

    this.physics.pos.set(1.52, 0.96, 1.98);
    if (this.ballMesh) {
      this.ballMesh.visible = true;
      this.ballMesh.position.copy(this.physics.pos);
    }
    if (this.strikeFlashMesh) {
      this.strikeFlashMesh.visible = true;
      this.strikeFlashMesh.position.set(1.52, 0.96, 1.98);
    }

    // Clear any previous callouts and spawn the floating neon-green "PERFECT" callout above p1
    const layer = document.getElementById('timing-callouts-layer');
    if (layer) layer.innerHTML = '';
    this.timingCallouts = [];
    this.spawnTimingCallout(this.players[1], 'PERFECT', true);
  }

  /**
   * Releases the initial broadcast showcase freeze when the user starts moving, swinging, or switching modes
   */
  exitShowcaseFreeze() {
    if (!this.showcaseFreeze) return;
    this.showcaseFreeze = false;
    if (this.strikeFlashMesh) {
      this.strikeFlashMesh.visible = false;
    }
    this.timingCallouts = this.timingCallouts.filter((c) => {
      if (c.persistent) {
        if (c.el && c.el.parentNode) c.el.parentNode.removeChild(c.el);
        return false;
      }
      return true;
    });
    this.setupPointPositions();
  }

  /**
   * Spawns a floating 3D-projected timing callout ("PERFECT", "GREAT", "GOOD", "EARLY") above an athlete's head
   */
  spawnTimingCallout(player, label = 'PERFECT', persistent = false) {
    if (!player) return;
    const layer = document.getElementById('timing-callouts-layer');
    if (!layer) return;

    // Remove existing non-persistent callout for the same player so they don't stack
    this.timingCallouts = this.timingCallouts.filter((c) => {
      if (c.player.id === player.id && (!c.persistent || persistent)) {
        if (c.el && c.el.parentNode) c.el.parentNode.removeChild(c.el);
        return false;
      }
      return true;
    });

    const el = document.createElement('div');
    const qualityClass =
      label === 'PERFECT'
        ? 'quality-perfect'
        : label === 'GREAT'
        ? 'quality-great'
        : label === 'GOOD'
        ? 'quality-good'
        : 'quality-early';
    el.className = `timing-callout-badge ${qualityClass}`;
    el.textContent = label;
    layer.appendChild(el);

    this.timingCallouts.push({
      player,
      el,
      label,
      persistent,
      age: 0,
      duration: persistent ? 999999 : 1.15,
      yRise: 0,
    });
  }

  /**
   * Projects active 3D timing callouts above athletes' heads into 2D screen space
   */
  updateTimingCallouts(dt) {
    if (!this.timingCallouts || this.timingCallouts.length === 0) return;
    const w = window.innerWidth;
    const h = window.innerHeight;

    for (let i = this.timingCallouts.length - 1; i >= 0; i--) {
      const c = this.timingCallouts[i];
      if (!c.persistent) {
        c.age += dt;
        c.yRise = Math.min(0.28, c.age * 0.24);
        if (c.age >= c.duration) {
          if (c.el && c.el.parentNode) c.el.parentNode.removeChild(c.el);
          this.timingCallouts.splice(i, 1);
          continue;
        }
      }

      if (!c.player || !c.player.active) {
        c.el.style.display = 'none';
        continue;
      }

      const anchor = new THREE.Vector3(
        c.player.pos.x,
        1.94 + (c.yRise || 0),
        c.player.pos.z
      );
      anchor.project(this.camera);

      if (anchor.z > 1) {
        c.el.style.display = 'none';
        continue;
      }

      const sx = (anchor.x * 0.5 + 0.5) * w;
      const sy = (-anchor.y * 0.5 + 0.5) * h;
      const alpha = c.persistent
        ? 1.0
        : THREE.MathUtils.clamp(1.0 - Math.max(0, (c.age - 0.65) / 0.5), 0, 1);

      c.el.style.display = 'block';
      c.el.style.opacity = alpha.toFixed(2);
      c.el.style.transform = `translate(-50%, -100%) translate(${sx.toFixed(1)}px, ${sy.toFixed(1)}px)`;
    }
  }

  startMode(mode, trainingIndex = 0) {
    this.showcaseFreeze = false;
    this.rules.setMode(mode, trainingIndex);
    this.setupPointPositions();
    this.updateModeUI();
    this.updateScoreHUD();
    if (mode === 'doubles') {
      this.showBanner(
        'PPA Championship Doubles (2v2)',
        'Official USAPA 0-0-2 Side-Out Scoring • Serve diagonally into the green service box!',
        'info'
      );
    } else if (mode === 'singles') {
      this.showBanner(
        'PPA Tour Singles (1v1)',
        'Even score serves from Right (Deuce) • Odd score serves from Left (Ad) • Double-Bounce Rule active!',
        'info'
      );
    } else if (mode === 'training' && trainingIndex > 0) {
      const mod = TRAINING_MODULES[trainingIndex];
      if (mod) this.showBanner(mod.title, mod.subtitle, 'info');
    }
  }

  setupPointPositions() {
    this.rules.updateServerAndReceiver();
    this.ai.computePreServePositions(this.rules, this.players);

    this.players.forEach((p) => {
      p.root.visible = p.active;
      p.pos.copy(p.homePos);
      p.vel.set(0, 0, 0);
      p.root.position.copy(p.pos);
      p.root.rotation.y = p.team === 0 ? Math.PI : 0;
      this.transitionPlayerAnim(p, 'Idle_SplitStep', 0.15);
    });

    // Training Mode Lesson 1 starts at the Kitchen line ready for a Crosscourt Dink rally!
    if (this.rules.mode === 'training' && this.rules.trainingIndex === 0) {
      this.rules.rallyPhase = 'open_rally';
      this.rules.bouncesInRally = 2;
      this.selectedShotType = 'dink';
      this.syncShotButtonsUI();
      const human = this.players[0];
      this.physics.resetBallAtPlayer(human.pos, 0);
      this.aimTarget.set(-1.25, 0.0368, -1.45);
      this.showBanner(
        'Lesson 1: Crosscourt Kitchen Dink',
        'Press SPACE or Left-Click to feed a soft Crosscourt Dink into the Kitchen!',
        'info'
      );
      return;
    }

    // Standard Pre-Serve setup
    this.rules.rallyPhase = 'pre_serve';
    this.rules.bouncesInRally = 0;
    const server =
      this.players.find((p) => p.id === this.rules.currentServerId) || this.players[0];
    this.physics.resetBallAtPlayer(server.pos, server.team);

    // Snap aim reticle inside legal diagonal service box if Player's team is serving
    if (this.rules.servingTeam === 0) {
      const box = this.rules.getTargetServiceBoxBounds();
      this.aimTarget.set(
        (box.minX + box.maxX) * 0.5,
        0.0368,
        (box.minZ + box.maxZ) * 0.5
      );
    } else {
      this.aimTarget.set(0, 0.0368, -4.5);
    }

    if (!server.isHuman) {
      this.autoServeCooldown = 1.35;
    } else {
      this.autoServeCooldown = 0;
    }

    this.updateScoreHUD();
  }

  /**
   * Executes a player or AI paddle strike (Serve or Rally Shot)
   */
  performPlayerStrike(hitter, shotConfig) {
    if (!hitter || !hitter.active) return;

    const wasVolley =
      this.rules.rallyPhase !== 'pre_serve' && this.physics.bounceCountOnCurrentSide === 0;

    // Validate against USAPA Double-Bounce & Non-Volley Zone (Kitchen) Rules!
    const validation = this.rules.validateStrike({
      hitterTeam: hitter.team,
      hitterPos: hitter.pos,
      wasVolley,
    });

    const spec = SHOT_ARCHETYPES[shotConfig.shotType] || SHOT_ARCHETYPES.drive;
    this.transitionPlayerAnim(hitter, spec.anim, 0.08);

    if (shotConfig.shotType === 'smash') {
      this.setPlayerExpression(hitter, 'Effort', 1.2, '🔥 "PUT AWAY!"');
    } else if (shotConfig.shotType === 'drive') {
      this.setPlayerExpression(hitter, 'Effort', 0.9, '🔥 "TOPSPIN DRIVE!"');
    } else if (shotConfig.shotType === 'volley') {
      this.setPlayerExpression(hitter, 'Surprise', 0.85, '⚡ "FAST VOLLEY!"');
    }

    const origin =
      this.rules.rallyPhase === 'pre_serve'
        ? new THREE.Vector3(
            hitter.pos.x + (hitter.team === 0 ? 0.24 : -0.24),
            0.68,
            hitter.pos.z + (hitter.team === 0 ? -0.35 : 0.35)
          )
        : new THREE.Vector3(
            THREE.MathUtils.lerp(this.physics.pos.x, hitter.pos.x, 0.25),
            Math.max(0.32, Math.min(2.15, this.physics.pos.y)),
            this.physics.pos.z
          );

    const telemetry = this.physics.executePaddleStrike({
      origin,
      target: shotConfig.target,
      shotType: shotConfig.shotType,
      team: hitter.team,
      playerId: hitter.id,
      power: shotConfig.power,
      userPitchOffsetDeg: shotConfig.pitchOffset || 0,
      userYawOffsetDeg: shotConfig.yawOffset || 0,
      userBrushOffsetDeg: shotConfig.brushOffset || 0,
      sweetSpotFactor: shotConfig.sweetSpot || 0.96,
    });

    // Spawn floating 3D timing feedback badge ("PERFECT" / "GREAT" / "GOOD") above hitter's head
    const ss = telemetry.sweetSpotFactor || 0.95;
    const timingLabel = ss >= 0.9 ? 'PERFECT' : ss >= 0.8 ? 'GREAT' : ss >= 0.7 ? 'GOOD' : 'EARLY';
    this.spawnTimingCallout(hitter, timingLabel, false);

    // Synthesize spatial Graphite / Carbon-Fiber Paddle "Pop" Audio!
    this.sound.playPaddlePop({
      pos: origin,
      shotType: shotConfig.shotType,
      speedMps: telemetry.speedMps,
      sweetSpot: telemetry.sweetSpotFactor,
    });

    if (shotConfig.shotType === 'smash' || this.rules.rallyShotCount >= 7) {
      this.sound.playCrowdReaction('gasp', this.rules.rallyShotCount);
    }

    this.updateTelemetryHUD(telemetry);
    hitter.swingCooldown = 0.42;

    if (!validation.legal) {
      this.handleFaultOrPointEnd(1 - hitter.team, validation.reason, hitter);
      return;
    }

    this.checkTrainingStrikeProgress(hitter, shotConfig.shotType, telemetry);
  }

  checkTrainingStrikeProgress(hitter, shotType, telemetry) {
    if (this.rules.mode !== 'training' || !hitter.isHuman) return;
    const idx = this.rules.trainingIndex;

    if (idx === 0 && shotType === 'dink') {
      const pBounce = telemetry.predictedBounce;
      if (
        pBounce &&
        Math.abs(pBounce.x) <= COURT_SPECS.HALF_WIDTH &&
        pBounce.z < 0 &&
        Math.abs(pBounce.z) <= COURT_SPECS.NVZ_DEPTH + 0.25
      ) {
        this.advanceTrainingGoal('Legal Crosscourt Dink landed softly inside the Kitchen!');
      }
    } else if (
      idx === 2 &&
      this.rules.rallyShotCount === 3 &&
      (shotType === 'drop' || shotType === 'dink')
    ) {
      this.advanceTrainingGoal('Textbook 3rd-Shot Drop executed after Bounce #2!');
    } else if (idx === 4) {
      this.advanceTrainingGoal(
        `${telemetry.shotLabel} (${telemetry.spinRpm} RPM ${telemetry.spinType}) executed!`
      );
    }
  }

  advanceTrainingGoal(message) {
    const mod = TRAINING_MODULES[this.rules.trainingIndex];
    if (!mod) return;
    this.rules.trainingProgress = Math.min(mod.targetGoals, this.rules.trainingProgress + 1);
    this.setPlayerExpression(this.players[0], 'Celebration', 2.4, '😄 "Nailed the drill!"', true);
    this.crowdCheerTimer = 2.0;
    this.showBanner(
      `Training Goal (${this.rules.trainingProgress}/${mod.targetGoals})`,
      message,
      'point'
    );
    this.updateModeUI();
  }

  handleFaultOrPointEnd(winnerTeam, reason, faultingPlayer = null) {
    const res = this.rules.resolveRallyWinner(winnerTeam, reason);
    this.physics.inPlay = false;
    this.crowdCheerTimer = 2.6;

    // Trigger full-body & facial human emotions (Celebration fist-pump vs Frustrated slump!)
    this.players.forEach((p) => {
      if (!p.active) return;
      if (p.team === winnerTeam) {
        this.setPlayerExpression(
          p,
          'Celebration',
          3.0,
          p.isHuman ? '😄 "YES! Point!"' : '😄 "Nice rally!"',
          true
        );
      } else if (!faultingPlayer || p.id === faultingPlayer.id || p.isHuman) {
        this.setPlayerExpression(
          p,
          'Frustration',
          3.0,
          p.isHuman ? '😤 "Ugh! Next point!"' : '😤 "Tough miss!"',
          true
        );
      }
    });

    if (winnerTeam === 0) {
      this.sound.playCrowdReaction('cheer', this.rules.rallyShotCount);
    } else {
      this.sound.playCrowdReaction('groan', this.rules.rallyShotCount);
    }

    this.sound.announceReferee(`${res.callout.title}. ${this.rules.getSpokenScore()}`);
    this.showBanner(res.callout.title, res.callout.detail, res.callout.type);
    this.updateScoreHUD();
    this.updateModeUI();

    clearTimeout(this.nextPointTimeout);
    this.nextPointTimeout = setTimeout(() => {
      if (res.outcomeType === 'MATCH_OVER') {
        this.rules.score = [0, 0];
      }
      this.setupPointPositions();
    }, 2400);
  }

  /**
   * Main per-frame update loop
   */
  update(dt) {
    const scaledDt = dt * this.timeScale;
    this.time += scaledDt;

    // If in initial PPA Broadcast Showcase Pose, hold the 4-player action tableau until user interacts
    if (this.showcaseFreeze) {
      if (this.ballMesh) {
        this.ballMesh.position.set(0.44, 1.02 + Math.sin(this.time * 2.4) * 0.012, -0.58);
        this.ballMesh.rotation.x += scaledDt * 4.2;
      }
      for (const p of this.players) {
        if (p.chestBone) {
          const breath = 1.0 + Math.sin(this.time * 3.0 + p.team * 1.4) * 0.01;
          p.chestBone.scale.set(breath, 1.0, breath);
        }
      }
      this.overlays.update({
        time: this.time,
        rules: this.rules,
        physics: this.physics,
        aimTarget: this.aimTarget,
        humanPlayer: this.players[0],
        previewPoints: null,
        showcaseFreeze: true,
      });
      this.updateTimingCallouts(scaledDt);
      this.controls.update();
      this.updatePlayerLabels();
      return;
    }

    // 1. Update charging swing bar if player is holding SPACE / Left-Click
    if (this.isChargingSwing) {
      const heldSec = (performance.now() - this.chargeStartTime) / 1000;
      this.shotPower = THREE.MathUtils.clamp(0.55 + Math.sin(heldSec * 2.8) * 0.42, 0.35, 1.0);
      const pSlider = document.getElementById('slider-power');
      const pVal = document.getElementById('val-power');
      const chargeFill = document.getElementById('space-charge-fill');
      const pct = Math.round(this.shotPower * 100);
      if (pSlider) pSlider.value = pct;
      if (pVal) pVal.textContent = `${pct}%`;
      if (chargeFill) chargeFill.style.width = `${pct}%`;
    }

    // 2. Check automatic AI Serve when AI opponent or AI Doubles partner is the active server
    if (this.rules.rallyPhase === 'pre_serve' && this.autoServeCooldown > 0) {
      this.autoServeCooldown -= scaledDt;
      if (this.autoServeCooldown <= 0) {
        const server = this.players.find((p) => p.id === this.rules.currentServerId);
        if (server && !server.isHuman) {
          const shot = this.ai.decideAIShot({
            hitter: server,
            players: this.players,
            physics: this.physics,
            rules: this.rules,
          });
          this.performPlayerStrike(server, shot);
        }
      }
    }

    // 3. Step 40-Hole Aerodynamic & Magnus Ball Physics
    const physEvents = this.physics.step(scaledDt);

    for (const ev of physEvents) {
      if (ev.type === 'net_cord') {
        this.sound.playNetImpact(ev.pos, true);
        this.players.forEach((p) => {
          if (p.active) this.setPlayerExpression(p, 'Surprise', 1.6, '😮 "Net cord roll!"');
        });
        this.showBanner(
          'NET CORD ROLL!',
          'Ball clipped the 34-inch net tape and rolled over — still live!',
          'info'
        );
      } else if (ev.type === 'net_fault') {
        this.sound.playNetImpact(ev.pos, false);
        const hitter = this.players.find((p) => p.id === this.physics.lastHitterId);
        this.handleFaultOrPointEnd(
          1 - ev.hitterTeam,
          'Net Fault! Ball struck the net mesh.',
          hitter
        );
        break;
      } else if (ev.type === 'bounce') {
        this.sound.playCourtBounce(ev.pos, ev.impactSpeed, ev.inBounds);
        const evalRes = this.rules.evaluateBounce(ev);

        if (
          this.rules.mode === 'training' &&
          this.rules.trainingIndex === 1 &&
          !evalRes.rallyEnded &&
          evalRes.bounceCountInRally === 1 &&
          ev.hitterTeam === 0
        ) {
          this.advanceTrainingGoal(
            'Legal Underhand Serve bounced cleanly inside the diagonal service box!'
          );
        }

        if (evalRes.rallyEnded) {
          const hitter = this.players.find((p) => p.id === this.physics.lastHitterId);
          this.handleFaultOrPointEnd(evalRes.winnerTeam, evalRes.reason, hitter);
          break;
        }
      }
    }

    // Check if ball flew way past court apron without bouncing twice
    if (
      this.physics.inPlay &&
      (Math.abs(this.physics.pos.z) > 11.5 || Math.abs(this.physics.pos.x) > 7.5)
    ) {
      const winner =
        this.physics.bounceCountOnCurrentSide >= 1
          ? this.physics.lastHitterTeam
          : 1 - this.physics.lastHitterTeam;
      const reason =
        this.physics.bounceCountOnCurrentSide >= 1
          ? 'Unreturned Winner!'
          : 'Out of Bounds! Ball sailed past the court lines without bouncing in.';
      this.handleFaultOrPointEnd(winner, reason);
    }

    // 4. Sync 3D Pickleball Mesh Position & Spin Quaternion
    if (this.ballMesh) {
      if (this.rules.rallyPhase === 'pre_serve') {
        const server =
          this.players.find((p) => p.id === this.rules.currentServerId) || this.players[0];
        this.physics.resetBallAtPlayer(server.pos, server.team);
      }
      this.ballMesh.position.copy(this.physics.pos);
      this.ballMesh.quaternion.copy(this.physics.orientationQuat);
    }

    // 5. Update Human & AI Athlete Movement, Animations, Paddle Tilt, Breathing & Emotions
    this.updateAthletes(scaledDt);

    // 6. Animate VIP Lounge Spectators (head-tracking the ball + cheering on points)
    if (this.crowdCheerTimer > 0) {
      this.crowdCheerTimer -= scaledDt;
    }
    const cheerAmp = this.crowdCheerTimer > 0 ? 0.06 : 0.004;
    const cheerFreq = this.crowdCheerTimer > 0 ? 10.0 : 1.8;
    const ballZ = this.physics ? this.physics.pos.z : 0;

    for (const sp of this.spectators) {
      sp.mesh.position.y =
        sp.baseY + Math.abs(Math.sin(this.time * cheerFreq + sp.phase)) * cheerAmp;
      if (sp.headBone) {
        const dz = ballZ - (sp.zSeat || 0);
        const sign = sp.xSign > 0 ? 1 : -1;
        const specYaw = THREE.MathUtils.clamp(
          sign * dz * 0.045 + Math.sin(this.time * 1.4 + sp.phase) * 0.04,
          -0.45,
          0.45
        );
        sp.headBone.rotation.y = THREE.MathUtils.lerp(sp.headBone.rotation.y, specYaw, 0.1);
      }
    }

    // 7. Compute Real-Time Predicted Ballistic Trajectory for 3D Overlay
    const human = this.players[0];
    let previewPoints = null;
    if (human && human.active && (this.overlays.showGuides || this.rules.mode === 'training')) {
      const activeShot =
        this.rules.rallyPhase === 'pre_serve' && this.rules.servingTeam === 0
          ? 'serve'
          : this.selectedShotType;
      const spec = SHOT_ARCHETYPES[activeShot] || SHOT_ARCHETYPES.drive;
      const origin = new THREE.Vector3(human.pos.x + 0.22, 0.82, human.pos.z - 0.3);
      const dx = this.aimTarget.x - origin.x;
      const dz = this.aimTarget.z - origin.z;
      const dist = Math.max(1.5, Math.hypot(dx, dz));
      const T = THREE.MathUtils.clamp(
        (dist / (spec.baseSpeed * (0.78 + (this.shotPower - 0.5) * 0.45))) *
          1.15 *
          Math.sqrt(spec.arcBoost),
        0.38,
        1.5
      );
      const v0 = new THREE.Vector3(
        dx / T,
        (0.03683 - origin.y + 0.5 * BALL_SPECS.GRAVITY * T * T) / T,
        dz / T
      );
      const dirH = new THREE.Vector3(dx, 0, dz).normalize();
      const topAxis = new THREE.Vector3(dirH.z, 0, -dirH.x);
      const spinRad = ((spec.topspinRpm + this.paddleBrushOffset * 52) * Math.PI * 2) / 60;
      const w0 = topAxis.multiplyScalar(spinRad);
      const sim = this.physics.simulateArc(origin, v0, w0, T * 1.15, true);
      previewPoints = sim.points;
    }

    this.overlays.update({
      time: this.time,
      rules: this.rules,
      physics: this.physics,
      aimTarget: this.aimTarget,
      humanPlayer: human,
      previewPoints,
      showcaseFreeze: false,
    });

    // 8. Update Floating Timing Callouts & Dynamic On-Screen Key Prompts
    this.updateTimingCallouts(scaledDt);
    this.updateLiveKeyPrompt();

    if (this.cameraPreset === 'closeup' && human) {
      this.controls.target.lerp(new THREE.Vector3(human.pos.x - 0.06, 1.38, human.pos.z), 0.12);
    }

    this.controls.update();
    this.updatePlayerLabels();
  }

  /**
   * Updates the bottom on-screen prompt banner & highlights the recommended shot key (1-6)
   * so the player always knows exactly what keys to hit right now!
   */
  updateLiveKeyPrompt() {
    const badgeEl = document.getElementById('prompt-phase-badge');
    const textEl = document.getElementById('prompt-action-text');
    const strikeCapEl = document.getElementById('strike-btn-caption');
    const human = this.players[0];
    if (!badgeEl || !textEl || !human) return;

    let recShot = 'drive';

    if (this.rules.rallyPhase === 'pre_serve') {
      if (this.rules.servingTeam === 0) {
        recShot = 'drive';
        badgeEl.textContent = '🎯 YOUR SERVE';
        textEl.innerHTML =
          'Aim with <strong>Mouse</strong> in the green diagonal box • Hold &amp; release <kbd class="inline-kbd pulse">SPACE</kbd> or <kbd class="inline-kbd">Left-Click</kbd> to hit Underhand Serve!';
        if (strikeCapEl) strikeCapEl.textContent = 'HOLD & RELEASE TO SERVE';
      } else {
        recShot = 'drive';
        badgeEl.textContent = '👀 AI SERVING';
        textEl.innerHTML =
          'Get ready! Let the serve <strong>bounce once</strong> (Double-Bounce Rule), then press <kbd class="inline-kbd pulse">SPACE</kbd> or <kbd class="inline-kbd">Left-Click</kbd> to Return!';
        if (strikeCapEl) strikeCapEl.textContent = 'PREPARE RETURN OF SERVE';
      }
    } else if (this.physics.inPlay) {
      const ballComingToYou = this.physics.vel.z > 0;
      if (ballComingToYou) {
        if (this.rules.bouncesInRally < 2 && this.physics.bounceCountOnCurrentSide === 0) {
          recShot = this.rules.bouncesInRally === 1 ? 'drop' : 'drive';
          badgeEl.textContent = '⏳ WAIT FOR BOUNCE';
          textEl.innerHTML = `<strong>Double-Bounce Rule:</strong> Let the ball bounce first! Press <kbd class="inline-kbd">${
            recShot === 'drop' ? '3 (Drop)' : '1 (Drive)'
          }</kbd> then hit <kbd class="inline-kbd pulse">SPACE</kbd> after bounce!`;
          if (strikeCapEl) strikeCapEl.textContent = 'WAIT FOR BOUNCE → HIT SPACE';
        } else if (this.physics.pos.y > 1.42) {
          recShot = 'smash';
          badgeEl.textContent = '💥 HIGH BALL!';
          textEl.innerHTML =
            'High ball overhead! Press <kbd class="inline-kbd">5</kbd> (Overhead Smash) + <kbd class="inline-kbd pulse">SPACE</kbd> or <kbd class="inline-kbd">Left-Click</kbd> to put it away!';
          if (strikeCapEl) strikeCapEl.textContent = 'HIT SPACE FOR SMASH!';
        } else if (
          this.physics.pos.z > 0 &&
          this.physics.pos.z <= COURT_SPECS.NVZ_DEPTH + 0.35 &&
          this.physics.bounceCountOnCurrentSide >= 1
        ) {
          recShot = 'dink';
          badgeEl.textContent = '🍯 KITCHEN DINK';
          textEl.innerHTML =
            'Ball bounced in the Kitchen! Press <kbd class="inline-kbd">2</kbd> (Kitchen Dink) + tap <kbd class="inline-kbd pulse">SPACE</kbd> softly!';
          if (strikeCapEl) strikeCapEl.textContent = 'TAP SPACE FOR SOFT DINK';
        } else if (
          this.rules.bouncesInRally >= 2 &&
          this.physics.bounceCountOnCurrentSide === 0 &&
          human.pos.z <= COURT_SPECS.NVZ_DEPTH + 0.85
        ) {
          recShot = 'volley';
          badgeEl.textContent = '⚡ NET VOLLEY';
          textEl.innerHTML =
            'Outside the Kitchen! Press <kbd class="inline-kbd">4</kbd> (Punch Volley) + <kbd class="inline-kbd pulse">SPACE</kbd> to volley out of the air!';
          if (strikeCapEl) strikeCapEl.textContent = 'HIT SPACE TO VOLLEY!';
        } else {
          recShot = human.pos.z > 4.2 ? 'drop' : 'drive';
          badgeEl.textContent = '⚡ BALL INCOMING';
          textEl.innerHTML = `Use <kbd class="inline-kbd">WASD</kbd> to position • Press <kbd class="inline-kbd">${
            recShot === 'drop' ? '3 (3rd-Shot Drop)' : '1 (Topspin Drive)'
          }</kbd> + <kbd class="inline-kbd pulse">SPACE</kbd> or <kbd class="inline-kbd">Left-Click</kbd> to Strike!`;
          if (strikeCapEl) strikeCapEl.textContent = 'HOLD & RELEASE SPACE TO HIT';
        }
      } else {
        recShot = 'dink';
        badgeEl.textContent = '🏃 RECOVER TO LINE';
        textEl.innerHTML =
          'Shot in flight! Use <kbd class="inline-kbd">W</kbd><kbd class="inline-kbd">A</kbd><kbd class="inline-kbd">S</kbd><kbd class="inline-kbd">D</kbd> to hold the 7ft Kitchen Line &amp; prepare for the next ball!';
        if (strikeCapEl) strikeCapEl.textContent = 'OPPONENT RETURNING...';
      }
    }

    if (this.recommendedShotType !== recShot) {
      this.recommendedShotType = recShot;
      document.querySelectorAll('[data-shot-btn]').forEach((btn) => {
        btn.classList.toggle('recommended', btn.getAttribute('data-shot-btn') === recShot);
      });
    }
  }

  updateAthletes(dt) {
    const aiParams = this.ai.getDifficultyParams();
    const ballMovingToTeam = this.physics.inPlay ? (this.physics.vel.z > 0 ? 0 : 1) : -1;
    const responder =
      this.physics.inPlay && ballMovingToTeam !== -1
        ? this.ai.selectResponder(
            this.players,
            ballMovingToTeam,
            this.physics.pos,
            this.physics.vel,
            this.rules
          )
        : null;

    for (const p of this.players) {
      if (!p.active) continue;
      if (p.swingCooldown > 0) p.swingCooldown -= dt;

      const prevVel = p.vel.clone();
      let desiredPos = p.pos.clone();

      if (p.isHuman) {
        let mx = 0;
        let mz = 0;
        if (this.keys['KeyA'] || this.keys['ArrowLeft']) mx -= 1;
        if (this.keys['KeyD'] || this.keys['ArrowRight']) mx += 1;
        if (this.keys['KeyW'] || this.keys['ArrowUp']) mz -= 1;
        if (this.keys['KeyS'] || this.keys['ArrowDown']) mz += 1;

        const manualInput = mx !== 0 || mz !== 0;
        const speed = 5.9;

        if (manualInput) {
          const dir = new THREE.Vector3(mx, 0, mz).normalize();
          p.vel.copy(dir).multiplyScalar(speed);
          p.pos.addScaledVector(p.vel, dt);
        } else if (
          this.autoFootworkAssist &&
          this.physics.inPlay &&
          responder &&
          responder.id === p.id
        ) {
          const tReach = Math.min(
            1.0,
            Math.abs(p.pos.z - this.physics.pos.z) / Math.max(3.5, Math.abs(this.physics.vel.z))
          );
          const predX = THREE.MathUtils.clamp(
            this.physics.pos.x + this.physics.vel.x * tReach,
            -3.4,
            3.4
          );
          let predZ = p.pos.z;

          if (this.physics.bounceMarkers.length > 0 && this.physics.pos.z > 0) {
            predZ = Math.max(
              COURT_SPECS.NVZ_DEPTH + 0.22,
              Math.min(6.9, this.physics.pos.z + 0.55)
            );
          } else if (this.rules.bouncesInRally >= 2 && this.rules.rallyPhase === 'open_rally') {
            predZ = COURT_SPECS.NVZ_DEPTH + 0.24;
          }
          if (
            this.physics.bounceCountOnCurrentSide >= 1 &&
            this.physics.pos.z > 0 &&
            this.physics.pos.z < COURT_SPECS.NVZ_DEPTH
          ) {
            predZ = Math.max(0.85, this.physics.pos.z + 0.35);
          }

          desiredPos.set(predX, 0, predZ);
          const toTarget = desiredPos.sub(p.pos);
          const dist = toTarget.length();
          if (dist > 0.08) {
            p.vel.copy(toTarget.normalize()).multiplyScalar(Math.min(speed, dist * 5.5));
            p.pos.addScaledVector(p.vel, dt);
          } else {
            p.vel.set(0, 0, 0);
          }
        } else {
          p.vel.set(0, 0, 0);
        }

        p.pos.x = THREE.MathUtils.clamp(p.pos.x, -4.1, 4.1);
        p.pos.z = THREE.MathUtils.clamp(p.pos.z, 0.38, 8.2);

        if (p.paddleMesh) {
          p.paddleMesh.rotation.set(
            Math.PI * 0.5 + THREE.MathUtils.degToRad(this.paddlePitchOffset),
            THREE.MathUtils.degToRad(this.paddleYawOffset),
            -Math.PI * 0.5
          );
        }
      } else {
        const zSign = p.team === 0 ? 1 : -1;
        if (this.physics.inPlay && responder && responder.id === p.id) {
          const tReach = Math.min(
            1.05,
            Math.abs(p.pos.z - this.physics.pos.z) / Math.max(3.2, Math.abs(this.physics.vel.z))
          );
          const predX = THREE.MathUtils.clamp(
            this.physics.pos.x + this.physics.vel.x * tReach,
            -3.5,
            3.5
          );
          let targetZ = p.pos.z;

          if (this.rules.bouncesInRally < 2 && this.physics.bounceCountOnCurrentSide === 0) {
            targetZ =
              zSign *
              Math.max(
                COURT_SPECS.NVZ_DEPTH + 0.35,
                Math.min(6.7, Math.abs(this.physics.pos.z) + 1.4)
              );
          } else if (
            this.physics.bounceCountOnCurrentSide >= 1 &&
            Math.abs(this.physics.pos.z) <= COURT_SPECS.NVZ_DEPTH + 0.4
          ) {
            targetZ = zSign * Math.max(0.95, Math.abs(this.physics.pos.z) + 0.32);
          } else if (this.rules.bouncesInRally >= 2) {
            targetZ = zSign * (COURT_SPECS.NVZ_DEPTH + 0.25);
          }

          desiredPos.set(predX, 0, targetZ);
        } else if (this.physics.inPlay) {
          const canAdvanceToNVZ =
            this.rules.bouncesInRally >= 2 ||
            (p.team !== this.rules.servingTeam && this.rules.bouncesInRally >= 1);
          const tacticalZ = canAdvanceToNVZ
            ? zSign * (COURT_SPECS.NVZ_DEPTH + 0.28)
            : p.homePos.z;
          desiredPos.set(p.homePos.x, 0, tacticalZ);
        } else {
          desiredPos.copy(p.homePos);
        }

        const diff = desiredPos.sub(p.pos);
        const dist = diff.length();
        if (dist > 0.06) {
          p.vel.copy(diff.normalize()).multiplyScalar(Math.min(aiParams.moveSpeed, dist * 5.2));
          p.pos.addScaledVector(p.vel, dt);
        } else {
          p.vel.set(0, 0, 0);
        }

        if (
          this.physics.inPlay &&
          responder &&
          responder.id === p.id &&
          p.swingCooldown <= 0 &&
          this.physics.lastHitterTeam !== p.team
        ) {
          const onMySide = p.team === 0 ? this.physics.pos.z > 0.15 : this.physics.pos.z < -0.15;
          const horizDist = Math.hypot(
            this.physics.pos.x - p.pos.x,
            this.physics.pos.z - p.pos.z
          );

          const mustLetBounce =
            this.rules.bouncesInRally < 2 ||
            Math.abs(p.pos.z) <= COURT_SPECS.NVZ_DEPTH + 0.08;
          const readyByBounce = !mustLetBounce || this.physics.bounceCountOnCurrentSide === 1;

          if (onMySide && readyByBounce && horizDist < 1.35 && this.physics.pos.y < 2.25) {
            const shot = this.ai.decideAIShot({
              hitter: p,
              players: this.players,
              physics: this.physics,
              rules: this.rules,
            });
            this.performPlayerStrike(p, shot);
          }
        }
      }

      const accelChange = p.vel.distanceTo(prevVel);
      if (accelChange > 2.6 && p.pos.length() < 9.0 && Math.random() < 0.35) {
        this.sound.playShoeSqueak(p.pos, Math.min(1.0, accelChange / 4.5));
      }

      p.root.position.copy(p.pos);
      const baseYaw = p.team === 0 ? Math.PI : 0;
      if (this.physics.inPlay) {
        const lookAng = Math.atan2(this.physics.pos.x - p.pos.x, this.physics.pos.z - p.pos.z);
        p.root.rotation.y = THREE.MathUtils.lerp(p.root.rotation.y, lookAng, 0.15);
      } else {
        p.root.rotation.y = baseYaw;
      }

      const moveSpeed = p.vel.length();
      if (p.currentAnim === 'Idle_SplitStep' || p.currentAnim === 'Run_Footwork') {
        if (moveSpeed > 0.55) {
          this.transitionPlayerAnim(p, 'Run_Footwork', 0.14);
        } else {
          this.transitionPlayerAnim(p, 'Idle_SplitStep', 0.16);
        }
      }

      p.mixer.update(dt);

      // Subtle organic human breathing on Chest bone
      if (p.chestBone) {
        const breath = 1.0 + Math.sin(this.time * 3.2 + p.team * 1.5) * 0.012;
        p.chestBone.scale.set(breath, 1.0, breath);
      }

      this.updatePlayerMorphTargets(p, dt);
    }
  }

  /**
   * Handles Human Player Swing Request (Spacebar, Left Mouse Click, or On-Screen Button)
   */
  triggerHumanSwing() {
    this.exitShowcaseFreeze();
    const human = this.players[0];
    if (!human || !human.active) return;

    if (this.rules.rallyPhase === 'pre_serve') {
      if (this.rules.servingTeam === 0) {
        const server =
          this.players.find((p) => p.id === this.rules.currentServerId) || human;
        this.performPlayerStrike(server, {
          shotType: 'serve',
          target: this.aimTarget.clone(),
          power: this.shotPower,
          pitchOffset: this.paddlePitchOffset,
          yawOffset: this.paddleYawOffset,
          brushOffset: this.paddleBrushOffset,
          sweetSpot: 0.98,
        });
      }
      return;
    }

    if (!this.physics.inPlay || this.physics.lastHitterTeam === 0) return;

    const distToBall = Math.hypot(
      this.physics.pos.x - human.pos.x,
      this.physics.pos.z - human.pos.z
    );
    if (this.physics.pos.z < -0.35 && distToBall > 2.2) return;

    if (distToBall <= 2.45) {
      human.pos.x = THREE.MathUtils.lerp(human.pos.x, this.physics.pos.x, 0.55);
      if (
        this.physics.bounceCountOnCurrentSide >= 1 ||
        Math.abs(this.physics.pos.z) > COURT_SPECS.NVZ_DEPTH + 0.15
      ) {
        human.pos.z = THREE.MathUtils.lerp(
          human.pos.z,
          Math.max(0.6, this.physics.pos.z + 0.25),
          0.45
        );
      }
    }

    const sweetSpot = THREE.MathUtils.clamp(1.05 - distToBall * 0.15, 0.72, 1.0);
    let chosenShot = this.selectedShotType;
    if (this.physics.pos.y > 1.48 && chosenShot === 'drive') {
      chosenShot = 'smash';
    } else if (
      this.physics.bounceCountOnCurrentSide === 0 &&
      this.rules.bouncesInRally >= 2 &&
      Math.abs(human.pos.z) < 2.9 &&
      chosenShot === 'drive'
    ) {
      chosenShot = 'volley';
    }

    this.performPlayerStrike(human, {
      shotType: chosenShot,
      target: this.aimTarget.clone(),
      power: this.shotPower,
      pitchOffset: this.paddlePitchOffset,
      yawOffset: this.paddleYawOffset,
      brushOffset: this.paddleBrushOffset,
      sweetSpot,
    });
  }

  setCameraPreset(preset) {
    this.cameraPreset = preset;
    const human = this.players[0];
    if (preset === 'broadcast') {
      this.camera.fov = 38;
      this.camera.updateProjectionMatrix();
      this.camera.position.set(0, 5.55, 11.45);
      this.controls.target.set(0, 0.42, 0.10);
    } else if (preset === 'player') {
      this.camera.fov = 44;
      this.camera.updateProjectionMatrix();
      const px = human ? human.pos.x * 0.5 : 0;
      this.camera.position.set(px, 2.85, 10.2);
      this.controls.target.set(0, 0.85, -2.2);
    } else if (preset === 'kitchen') {
      this.camera.fov = 42;
      this.camera.updateProjectionMatrix();
      this.camera.position.set(5.9, 2.15, 0.2);
      this.controls.target.set(0, 0.82, 0);
    } else if (preset === 'overhead') {
      this.camera.fov = 44;
      this.camera.updateProjectionMatrix();
      this.camera.position.set(0, 17.2, 0.01);
      this.controls.target.set(0, 0, 0);
    } else if (preset === 'closeup' && human) {
      this.camera.fov = 38;
      this.camera.updateProjectionMatrix();
      const yaw = human.root.rotation.y;
      const fwdX = Math.sin(yaw);
      const fwdZ = Math.cos(yaw);
      this.camera.position.set(
        human.pos.x + fwdX * 1.55 - fwdZ * 0.28,
        1.48,
        human.pos.z + fwdZ * 1.55 + fwdX * 0.28
      );
      this.controls.target.set(human.pos.x - 0.06, 1.38, human.pos.z);
    }
    this.controls.update();
  }

  setKeycapVisual(code, pressed) {
    const mapCode = {
      ArrowUp: 'KeyW',
      ArrowDown: 'KeyS',
      ArrowLeft: 'KeyA',
      ArrowRight: 'KeyD',
    };
    const normCode = mapCode[code] || code;
    document.querySelectorAll(`[data-keycap="${normCode}"]`).forEach((el) => {
      el.classList.toggle('pressed', pressed);
    });
  }

  bindUIEvents() {
    window.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
      this.keys[e.code] = true;
      this.setKeycapVisual(e.code, true);

      if (
        ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(
          e.code
        )
      ) {
        this.exitShowcaseFreeze();
      }

      if (e.code === 'Space' && !e.repeat) {
        e.preventDefault();
        this.exitShowcaseFreeze();
        this.sound.init();
        this.isChargingSwing = true;
        this.chargeStartTime = performance.now();
      }
      const shotMap = {
        Digit1: 'drive',
        Digit2: 'dink',
        Digit3: 'drop',
        Digit4: 'volley',
        Digit5: 'smash',
        Digit6: 'slice',
      };
      if (shotMap[e.code]) {
        this.selectedShotType = shotMap[e.code];
        this.syncShotButtonsUI();
      }
      if (e.code === 'KeyQ') this.adjustPaddleAngle('pitch', -2);
      if (e.code === 'KeyE') this.adjustPaddleAngle('pitch', +2);
      if (e.code === 'KeyZ') this.adjustPaddleAngle('yaw', -3);
      if (e.code === 'KeyC') this.adjustPaddleAngle('yaw', +3);
      if (e.code === 'KeyR') this.adjustPaddleAngle('brush', +4);
      if (e.code === 'KeyF') this.adjustPaddleAngle('brush', -4);
    });

    window.addEventListener('keyup', (e) => {
      this.keys[e.code] = false;
      this.setKeycapVisual(e.code, false);
      if (e.code === 'Space' && this.isChargingSwing) {
        this.isChargingSwing = false;
        this.triggerHumanSwing();
      }
    });

    // Mouse Aim on 3D Court & Left-Click Strike
    this.canvas.addEventListener('pointermove', (e) => {
      const rect = this.canvas.getBoundingClientRect();
      this.mouseNDC.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      this.mouseNDC.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      this.raycaster.setFromCamera(this.mouseNDC, this.camera);
      const hitPt = new THREE.Vector3();
      if (this.raycaster.ray.intersectPlane(this.groundPlane, hitPt)) {
        this.aimTarget.x = THREE.MathUtils.clamp(hitPt.x, -3.5, 3.5);
        this.aimTarget.z = THREE.MathUtils.clamp(hitPt.z, -7.2, -0.35);
      }
    });

    this.canvas.addEventListener('pointerdown', (e) => {
      if (e.button === 0) {
        this.exitShowcaseFreeze();
        this.sound.init();
        this.isChargingSwing = true;
        this.chargeStartTime = performance.now();
        this.setKeycapVisual('Space', true);
      }
    });

    window.addEventListener('pointerup', (e) => {
      if (e.button === 0 && this.isChargingSwing) {
        this.isChargingSwing = false;
        this.setKeycapVisual('Space', false);
        this.triggerHumanSwing();
      }
    });

    // On-screen SPACE / CLICK button
    const btnOnscreenSwing = document.getElementById('btn-onscreen-swing');
    if (btnOnscreenSwing) {
      btnOnscreenSwing.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        this.exitShowcaseFreeze();
        this.sound.init();
        this.isChargingSwing = true;
        this.chargeStartTime = performance.now();
        this.setKeycapVisual('Space', true);
      });
    }

    // Mode Tabs
    document.querySelectorAll('[data-mode-btn]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.sound.init();
        const mode = btn.getAttribute('data-mode-btn');
        this.startMode(mode, 0);
      });
    });

    // Training Module Selector Buttons
    document.querySelectorAll('[data-lesson-idx]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const idx = Number(btn.getAttribute('data-lesson-idx'));
        this.startMode('training', idx);
      });
    });

    // Shot Type Selector Buttons
    document.querySelectorAll('[data-shot-btn]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.selectedShotType = btn.getAttribute('data-shot-btn');
        this.syncShotButtonsUI();
      });
    });

    // Clean Broadcast HUD Toggle Button
    const btnCleanHud = document.getElementById('btn-toggle-clean-hud');
    if (btnCleanHud) {
      btnCleanHud.addEventListener('click', () => {
        const isClean = document.body.classList.toggle('broadcast-clean-hud');
        btnCleanHud.classList.toggle('active', isClean);
        btnCleanHud.textContent = isClean
          ? '📺 Clean Broadcast HUD'
          : '🎛️ Full Telemetry HUD';
      });
    }

    // Pro Spin & Angle Lab Drawer Toggle
    const btnToggleLab = document.getElementById('btn-toggle-lab');
    const btnCloseLab = document.getElementById('btn-close-lab');
    const labDrawer = document.getElementById('paddle-lab-drawer');
    if (btnToggleLab && labDrawer) {
      btnToggleLab.addEventListener('click', () => {
        if (document.body.classList.contains('broadcast-clean-hud')) {
          document.body.classList.remove('broadcast-clean-hud');
          if (btnCleanHud) {
            btnCleanHud.classList.remove('active');
            btnCleanHud.textContent = '🎛️ Full Telemetry HUD';
          }
        }
        const isClosed = labDrawer.classList.toggle('drawer-collapsed');
        btnToggleLab.classList.toggle('active', !isClosed);
      });
    }
    if (btnCloseLab && labDrawer && btnToggleLab) {
      btnCloseLab.addEventListener('click', () => {
        labDrawer.classList.add('drawer-collapsed');
        btnToggleLab.classList.remove('active');
      });
    }

    // Explicit Paddle Contact Angle Sliders
    const bindSlider = (id, valId, suffix, onChange) => {
      const el = document.getElementById(id);
      const valEl = document.getElementById(valId);
      if (!el) return;
      el.addEventListener('input', () => {
        const v = Number(el.value);
        if (valEl) valEl.textContent = `${v > 0 && suffix === '°' ? '+' : ''}${v}${suffix}`;
        onChange(v);
      });
    };

    bindSlider('slider-pitch', 'val-pitch', '°', (v) => {
      this.paddlePitchOffset = v;
    });
    bindSlider('slider-yaw', 'val-yaw', '°', (v) => {
      this.paddleYawOffset = v;
    });
    bindSlider('slider-brush', 'val-brush', '°', (v) => {
      this.paddleBrushOffset = v;
    });
    bindSlider('slider-power', 'val-power', '%', (v) => {
      this.shotPower = v / 100;
      const chargeFill = document.getElementById('space-charge-fill');
      if (chargeFill) chargeFill.style.width = `${v}%`;
    });
    bindSlider('slider-wind', 'val-wind', ' m/s', (v) => {
      this.physics.wind.set(v, 0, v * 0.35);
    });

    // Camera Presets
    document.querySelectorAll('[data-cam-btn]').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('[data-cam-btn]').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        this.setCameraPreset(btn.getAttribute('data-cam-btn'));
      });
    });

    const btnGuides = document.getElementById('btn-toggle-guides');
    if (btnGuides) {
      btnGuides.addEventListener('click', () => {
        this.overlays.showGuides = !this.overlays.showGuides;
        btnGuides.classList.toggle('active', this.overlays.showGuides);
        btnGuides.textContent = this.overlays.showGuides ? '3D Guides: ON' : '3D Guides: OFF';
      });
    }

    const btnFootwork = document.getElementById('btn-toggle-footwork');
    if (btnFootwork) {
      btnFootwork.addEventListener('click', () => {
        this.autoFootworkAssist = !this.autoFootworkAssist;
        btnFootwork.classList.toggle('active', this.autoFootworkAssist);
        btnFootwork.textContent = this.autoFootworkAssist
          ? 'Footwork: Auto-Assist'
          : 'Footwork: Manual WASD';
      });
    }

    const btnAudio = document.getElementById('btn-toggle-audio');
    if (btnAudio) {
      btnAudio.addEventListener('click', () => {
        this.sound.enabled = !this.sound.enabled;
        btnAudio.classList.toggle('active', this.sound.enabled);
        btnAudio.textContent = this.sound.enabled ? '🔊 Audio: ON' : '🔇 Audio: OFF';
      });
    }

    const selCore = document.getElementById('select-paddle-core');
    if (selCore) {
      selCore.addEventListener('change', () => {
        this.sound.paddleCoreMaterial = selCore.value;
        this.sound.playPaddlePop({ shotType: 'drive', speedMps: 16 });
      });
    }

    const selDiff = document.getElementById('select-ai-difficulty');
    if (selDiff) {
      selDiff.addEventListener('change', () => {
        this.ai.difficulty = selDiff.value;
      });
    }

    // Live Human Emotion & Animation Triggers
    document.querySelectorAll('[data-expr-btn]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const expr = btn.getAttribute('data-expr-btn');
        this.players.forEach((p) =>
          this.setPlayerExpression(
            p,
            expr,
            4.0,
            null,
            expr === 'Celebration' || expr === 'Frustration'
          )
        );
      });
    });

    document.querySelectorAll('[data-anim-btn]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const anim = btn.getAttribute('data-anim-btn');
        if (this.players[0]) this.transitionPlayerAnim(this.players[0], anim, 0.12);
      });
    });

    // Rules Reference Modal (<dialog closedby="any">)
    const btnOpenModal = document.getElementById('btn-open-rules');
    const dialog = document.getElementById('rules-modal');
    if (btnOpenModal && dialog) {
      btnOpenModal.addEventListener('click', () => {
        dialog.showModal();
      });
    }
  }

  adjustPaddleAngle(type, delta) {
    if (type === 'pitch') {
      this.paddlePitchOffset = THREE.MathUtils.clamp(this.paddlePitchOffset + delta, -15, 20);
      const s = document.getElementById('slider-pitch');
      const v = document.getElementById('val-pitch');
      if (s) s.value = this.paddlePitchOffset;
      if (v) v.textContent = `${this.paddlePitchOffset > 0 ? '+' : ''}${this.paddlePitchOffset}°`;
    } else if (type === 'yaw') {
      this.paddleYawOffset = THREE.MathUtils.clamp(this.paddleYawOffset + delta, -25, 25);
      const s = document.getElementById('slider-yaw');
      const v = document.getElementById('val-yaw');
      if (s) s.value = this.paddleYawOffset;
      if (v) v.textContent = `${this.paddleYawOffset > 0 ? '+' : ''}${this.paddleYawOffset}°`;
    } else if (type === 'brush') {
      this.paddleBrushOffset = THREE.MathUtils.clamp(this.paddleBrushOffset + delta, -25, 25);
      const s = document.getElementById('slider-brush');
      const v = document.getElementById('val-brush');
      if (s) s.value = this.paddleBrushOffset;
      if (v) v.textContent = `${this.paddleBrushOffset > 0 ? '+' : ''}${this.paddleBrushOffset}°`;
    }
  }

  syncShotButtonsUI() {
    document.querySelectorAll('[data-shot-btn]').forEach((btn) => {
      btn.classList.toggle('active', btn.getAttribute('data-shot-btn') === this.selectedShotType);
    });
  }

  updateModeUI() {
    document.querySelectorAll('[data-mode-btn]').forEach((btn) => {
      btn.classList.toggle('active', btn.getAttribute('data-mode-btn') === this.rules.mode);
    });

    const trainingPanel = document.getElementById('training-panel');
    if (trainingPanel) {
      trainingPanel.classList.toggle('hidden', this.rules.mode !== 'training');
    }

    const name0 = document.getElementById('team-name-0');
    const name1 = document.getElementById('team-name-1');
    if (name0 && name1) {
      if (this.rules.isDoublesActive()) {
        name0.textContent = 'ARJUN / PRIYA (YOU)';
        name1.textContent = 'VIKRAM / ANANYA (AI)';
      } else {
        name0.textContent = 'ARJUN (YOU)';
        name1.textContent = 'VIKRAM (TOUR AI)';
      }
    }

    if (this.rules.mode === 'training') {
      const mod = TRAINING_MODULES[this.rules.trainingIndex];
      document.querySelectorAll('[data-lesson-idx]').forEach((btn) => {
        btn.classList.toggle(
          'active',
          Number(btn.getAttribute('data-lesson-idx')) === this.rules.trainingIndex
        );
      });
      const titleEl = document.getElementById('lesson-title');
      const subEl = document.getElementById('lesson-subtitle');
      const descEl = document.getElementById('lesson-summary');
      const tipEl = document.getElementById('lesson-tip');
      const progEl = document.getElementById('lesson-progress');
      if (titleEl) titleEl.textContent = mod.title;
      if (subEl) subEl.textContent = mod.subtitle;
      if (descEl) descEl.textContent = mod.ruleSummary;
      if (tipEl) tipEl.textContent = mod.proTip;
      if (progEl) progEl.textContent = `${this.rules.trainingProgress} / ${mod.targetGoals} Completed`;
    }
  }

  updateScoreHUD() {
    const scoreCallEl = document.getElementById('score-call');
    const scoreNearEl = document.getElementById('score-team0');
    const scoreFarEl = document.getElementById('score-team1');
    const serverBadgeEl = document.getElementById('server-badge');
    const bounceStatusEl = document.getElementById('double-bounce-status');
    const row0 = document.getElementById('team-row-0');
    const row1 = document.getElementById('team-row-1');

    if (scoreCallEl) scoreCallEl.textContent = this.rules.getFormattedScore();
    if (scoreNearEl) scoreNearEl.textContent = this.rules.score[0];
    if (scoreFarEl) scoreFarEl.textContent = this.rules.score[1];

    if (row0) row0.classList.toggle('active-srv', this.rules.servingTeam === 0);
    if (row1) row1.classList.toggle('active-srv', this.rules.servingTeam === 1);

    if (serverBadgeEl) {
      const boxLabel =
        this.rules.getServeSideBox() === 'right_even' ? 'Right (Even)' : 'Left (Odd)';
      serverBadgeEl.textContent = this.rules.isDoublesActive()
        ? `Server #${this.rules.serverNumber} • ${boxLabel}`
        : `Serving ${boxLabel}`;
    }

    if (bounceStatusEl) {
      if (this.rules.rallyPhase === 'pre_serve') {
        bounceStatusEl.textContent = 'Awaiting Legal Underhand Serve';
        bounceStatusEl.className = 'rule-status-strip neutral';
      } else if (this.rules.bouncesInRally === 0) {
        bounceStatusEl.textContent = 'Bounce 0/2: Serve MUST bounce before return!';
        bounceStatusEl.className = 'rule-status-strip warn';
      } else if (this.rules.bouncesInRally === 1) {
        bounceStatusEl.textContent = 'Bounce 1/2: Return MUST bounce before volleying!';
        bounceStatusEl.className = 'rule-status-strip warn';
      } else {
        bounceStatusEl.textContent =
          'Bounce 2/2 Complete: Open Volleying Legal (Outside Kitchen)!';
        bounceStatusEl.className = 'rule-status-strip ok';
      }
    }
  }

  updateTelemetryHUD(t) {
    const setTxt = (id, val) => {
      const el = document.getElementById(id);
      if (el) el.textContent = val;
    };
    setTxt('tel-shot', t.shotLabel || 'Topspin Drive');
    setTxt('tel-speed', `${t.speedMph} mph (${t.speedKmh} km/h)`);
    setTxt('tel-spin', `${t.spinRpm} RPM (${t.spinType})`);
    setTxt('tel-angles', `P:${t.facePitchDeg}° Y:${t.faceYawDeg}° B:${t.brushAngleDeg}°`);
    setTxt('tel-net', `${t.netClearanceCm >= 0 ? '+' : ''}${t.netClearanceCm} cm`);
  }

  showBanner(title, detail, type = 'info') {
    const banner = document.getElementById('callout-banner');
    const titleEl = document.getElementById('callout-title');
    const detailEl = document.getElementById('callout-detail');
    if (!banner || !titleEl || !detailEl) return;

    titleEl.textContent = title;
    detailEl.textContent = detail;
    banner.className = `callout-banner ${type}`;
  }

  updatePlayerLabels() {
    const container = document.getElementById('player-labels-layer');
    if (!container) return;

    const cleanMode = document.body.classList.contains('broadcast-clean-hud');

    this.players.forEach((p) => {
      let badge = document.getElementById(`label-${p.id}`);
      if (!badge) {
        badge = document.createElement('div');
        badge.id = `label-${p.id}`;
        badge.className = `player-floating-label ${p.team === 0 ? 'team-near' : 'team-far'}`;
        container.appendChild(badge);
      }

      if (cleanMode || !p.active || (this.cameraPreset === 'closeup' && p.isHuman)) {
        badge.style.display = 'none';
        return;
      }

      const headWorld = new THREE.Vector3(p.pos.x, 1.92, p.pos.z);
      headWorld.project(this.camera);

      if (headWorld.z > 1) {
        badge.style.display = 'none';
        return;
      }

      const x = (headWorld.x * 0.5 + 0.5) * window.innerWidth;
      const y = (-headWorld.y * 0.5 + 0.5) * window.innerHeight;
      if (y < 95) {
        badge.style.display = 'none';
        return;
      }
      badge.style.display = 'flex';
      badge.style.transform = `translate(-50%, -100%) translate(${x}px, ${y}px)`;

      const exprIcon =
        p.expression === 'Celebration'
          ? '😄'
          : p.expression === 'Frustration'
          ? '😤'
          : p.expression === 'Effort'
          ? '🔥'
          : p.expression === 'Surprise'
          ? '😮'
          : '🙂';

      const bubbleHtml = p.emotionBubbleText
        ? `<div class="pl-emotion-bubble">${p.emotionBubbleText}</div>`
        : '';

      badge.innerHTML = `<span class="pl-name">${exprIcon} ${p.name}</span><span class="pl-role">${p.roleLabel}</span>${bubbleHtml}`;
    });
  }

  /**
   * Renders the Main 3D Court Scene + the Top-Right Live 3D Human Emotion Portrait Cam (PiP)
   */
  renderSceneAndEmotionPiP() {
    const w = window.innerWidth;
    const h = window.innerHeight;

    // 1. Full-Screen Main Broadcast Camera
    this.renderer.setViewport(0, 0, w, h);
    this.renderer.setScissor(0, 0, w, h);
    this.renderer.setScissorTest(false);
    this.renderer.clear();
    this.renderer.render(this.scene, this.camera);

    // Skip secondary PiP portrait scissor render when Clean Broadcast HUD mode is active
    if (document.body.classList.contains('broadcast-clean-hud')) return;

    // 2. Picture-in-Picture Portrait Render inside #emotion-cam-frame
    const pipEl = document.getElementById('emotion-cam-frame');
    const targetPlayer = this.focusedEmotionPlayer || this.players[0];
    if (!pipEl || !targetPlayer || !targetPlayer.active) return;

    const rect = pipEl.getBoundingClientRect();
    if (rect.width < 20 || rect.height < 20) return;

    const pipLeft = Math.round(rect.left);
    const pipBottom = Math.round(h - rect.bottom);
    const pipW = Math.round(rect.width);
    const pipH = Math.round(rect.height);

    this.faceCamera.aspect = pipW / pipH;
    this.faceCamera.updateProjectionMatrix();

    // Position portrait camera right in front of the athlete's face based on their facing direction!
    const yaw = targetPlayer.root.rotation.y;
    const fwdX = Math.sin(yaw);
    const fwdZ = Math.cos(yaw);
    const facePos = new THREE.Vector3(
      targetPlayer.pos.x,
      1.56,
      targetPlayer.pos.z
    );
    this.faceCamera.position.set(
      facePos.x + fwdX * 0.86 + fwdZ * 0.12,
      1.59,
      facePos.z + fwdZ * 0.86 - fwdX * 0.12
    );
    this.faceCamera.lookAt(facePos.x, 1.54, facePos.z);

    this.renderer.setViewport(pipLeft, pipBottom, pipW, pipH);
    this.renderer.setScissor(pipLeft, pipBottom, pipW, pipH);
    this.renderer.setScissorTest(true);
    this.renderer.clearDepth();
    this.renderer.render(this.scene, this.faceCamera);
    this.renderer.setScissorTest(false);
  }

  animate() {
    requestAnimationFrame(() => this.animate());
    const now = performance.now();
    const dt = Math.min(0.05, (now - this.lastFrameTime) / 1000);
    this.lastFrameTime = now;
    this.update(dt);
    this.renderSceneAndEmotionPiP();
  }
}

window.addEventListener('DOMContentLoaded', () => {
  window.pickleballApp = new PickleballSimulationApp();
});
