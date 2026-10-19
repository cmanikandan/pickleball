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
    this.scene.background = new THREE.Color(0x8ec5f0);
    this.scene.fog = new THREE.FogExp2(0xd6e8f7, 0.0042);

    this.camera = new THREE.PerspectiveCamera(
      43,
      window.innerWidth / window.innerHeight,
      0.1,
      280
    );
    this.camera.position.set(0, 7.2, 13.9);

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
    this.renderer.toneMappingExposure = 1.06;
    this.renderer.autoClear = false;

    // Generate Realistic Outdoor Stadium PMREM Environment Map for PBR Reflections
    this.buildOutdoorEnvironmentMap();

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.maxPolarAngle = Math.PI * 0.485;
    this.controls.minDistance = 1.2;
    this.controls.maxDistance = 36;
    this.controls.target.set(0, 0.25, 0.45);
    // Right-click drag orbits camera so Left-click is dedicated to paddle strikes!
    this.controls.mouseButtons = {
      LEFT: null,
      MIDDLE: THREE.MOUSE.DOLLY,
      RIGHT: THREE.MOUSE.ROTATE,
    };

    // Realistic Outdoor Sunlit Daylight + Golden-Hour Stadium Lighting
    const hemiLight = new THREE.HemisphereLight(0xf0f7ff, 0x4b6344, 0.95);
    this.scene.add(hemiLight);

    const sunLight = new THREE.DirectionalLight(0xfff4e0, 2.45);
    sunLight.position.set(16.0, 24.0, 14.0);
    sunLight.castShadow = true;
    sunLight.shadow.mapSize.set(4096, 4096);
    sunLight.shadow.camera.near = 1;
    sunLight.shadow.camera.far = 65;
    const d = 16.5;
    sunLight.shadow.camera.left = -d;
    sunLight.shadow.camera.right = d;
    sunLight.shadow.shadowBias = -0.0003;
    sunLight.shadow.camera.top = d;
    sunLight.shadow.camera.bottom = -d;
    sunLight.shadow.bias = -0.0003;
    this.scene.add(sunLight);

    // Subtle cool sky rim light + warm court bounce fill light on athletes
    const rimLight = new THREE.DirectionalLight(0xdbeafe, 0.65);
    rimLight.position.set(-14.0, 12.0, -14.0);
    const faceFillNear = new THREE.DirectionalLight(0xfff1e0, 1.35);
    faceFillNear.position.set(2.5, 5.2, -12.0);
    const faceFillFar = new THREE.DirectionalLight(0xfff1e0, 0.85);
    faceFillFar.position.set(-2.5, 5.2, 12.0);
    this.scene.add(rimLight, faceFillNear, faceFillFar);

    // Build Photorealistic Championship Pickleball Stadium, Covered Grandstands & Grounds
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
   * Generates a procedural HDR-style outdoor sky/court PMREM environment map
   * so carbon-fiber paddles, stadium glass/steel, and acrylic court surfaces have natural specular sheen.
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
              vec3 ground = vec3(0.14, 0.28, 0.22);
              vec3 horizon = vec3(0.88, 0.92, 0.96);
              vec3 zenith = vec3(0.18, 0.42, 0.78);
              vec3 col = d.y < 0.0
                ? mix(horizon, ground, clamp(-d.y * 3.0, 0.0, 1.0))
                : mix(horizon, zenith, pow(d.y, 0.55));
              vec3 sunDir = normalize(vec3(0.45, 0.62, 0.42));
              float sun = max(dot(d, sunDir), 0.0);
              col += vec3(1.0, 0.92, 0.76) * pow(sun, 24.0) * 1.4;
              gl_FragColor = vec4(col, 1.0);
            }
          `,
        })
      );
      envScene.add(skyDome);
      const envRT = pmrem.fromScene(envScene, 0.03);
      this.scene.environment = envRT.texture;
      this.scene.environmentIntensity = 0.65;
      pmrem.dispose();
    } catch (_) {
      // Fallback if PMREM fails
    }
  }

  /**
   * Builds a Pro Broadcast Championship Pickleball Stadium (PPA Tour / US Open Center Court):
   * - Volumetric-style Cumulus Cloud Sky Dome Shader
   * - Architectural Concourse Pavers & Manicured Championship Grounds
   * - 360° Perimeter Barrier Walls with High-Res LED Sponsor Ribbon Boards
   * - Covered East & West Grandstand Pavilions with Cantilevered Roofs, Glass Railings, Bucket Seats & Articulated Seated Spectators
   * - Pro Umpire High-Chair with Rectangular Sun Canopy & Seated Match Referee
   * - Shaded Player Changeover Benches, Coolers, Broadcast Camera Platform, Floodlight Towers & Multi-Layered Trees
   */
  buildRealisticOutdoorStadium() {
    const envGroup = new THREE.Group();
    envGroup.name = 'Outdoor_Pickleball_Stadium';

    // 1. Atmospheric Sky Dome Shader with Volumetric-Style Cumulus Clouds
    const skyGeo = new THREE.SphereGeometry(200, 48, 28);
    const skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        topColor: { value: new THREE.Color(0x1d4ed8) },
        midColor: { value: new THREE.Color(0x60a5fa) },
        bottomColor: { value: new THREE.Color(0xeef6ff) },
        sunDir: { value: new THREE.Vector3(0.46, 0.56, 0.42).normalize() },
      },
      vertexShader: `
        varying vec3 vWorldPos;
        void main() {
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vWorldPos = wp.xyz;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: `
        uniform vec3 topColor;
        uniform vec3 midColor;
        uniform vec3 bottomColor;
        uniform vec3 sunDir;
        varying vec3 vWorldPos;

        float hash(vec2 p) {
          return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
        }
        float noise(vec2 p) {
          vec2 i = floor(p);
          vec2 f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          float a = hash(i);
          float b = hash(i + vec2(1.0, 0.0));
          float c = hash(i + vec2(0.0, 1.0));
          float d = hash(i + vec2(1.0, 1.0));
          return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
        }
        float fbm(vec2 p) {
          float v = 0.0;
          float a = 0.5;
          for (int i = 0; i < 4; i++) {
            v += a * noise(p);
            p *= 2.04;
            a *= 0.5;
          }
          return v;
        }

        void main() {
          vec3 dir = normalize(vWorldPos);
          float h = clamp(dir.y, 0.0, 1.0);
          vec3 col = mix(bottomColor, midColor, smoothstep(0.0, 0.24, h));
          col = mix(col, topColor, smoothstep(0.24, 0.88, h));

          // Soft cumulus cloud layer on upper hemisphere
          if (dir.y > 0.03) {
            vec2 uv = dir.xz / (dir.y + 0.18) * 2.2;
            float n = fbm(uv + vec2(1.7, -0.8));
            float cloud = smoothstep(0.48, 0.76, n) * smoothstep(0.03, 0.22, dir.y) * smoothstep(0.92, 0.35, dir.y);
            float sunLit = max(dot(dir, sunDir), 0.0);
            vec3 cloudCol = mix(vec3(0.88, 0.92, 0.97), vec3(1.0, 0.98, 0.94), 0.5 + 0.5 * sunLit);
            col = mix(col, cloudCol, cloud * 0.68);
          }

          float sunAmt = max(dot(dir, sunDir), 0.0);
          col += vec3(1.0, 0.91, 0.72) * pow(sunAmt, 28.0) * 0.42;
          col += vec3(1.0, 0.98, 0.92) * smoothstep(0.996, 0.9995, sunAmt);
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });
    envGroup.add(new THREE.Mesh(skyGeo, skyMat));

    // 2. Championship Grounds & Textured Architectural Concourse
    const turfCanvas = document.createElement('canvas');
    turfCanvas.width = 512;
    turfCanvas.height = 512;
    const tCtx = turfCanvas.getContext('2d');
    tCtx.fillStyle = '#2d5a34';
    tCtx.fillRect(0, 0, 512, 512);
    for (let s = 0; s < 16; s++) {
      tCtx.fillStyle = s % 2 === 0 ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.03)';
      tCtx.fillRect(0, s * 32, 512, 32);
    }
    const turfTex = new THREE.CanvasTexture(turfCanvas);
    turfTex.wrapS = THREE.RepeatWrapping;
    turfTex.wrapT = THREE.RepeatWrapping;
    turfTex.repeat.set(18, 18);
    turfTex.colorSpace = THREE.SRGBColorSpace;

    const turfDisk = new THREE.Mesh(
      new THREE.CircleGeometry(150, 64).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({ map: turfTex, roughness: 0.92, metalness: 0.02 })
    );
    turfDisk.position.y = -0.028;
    turfDisk.receiveShadow = true;
    envGroup.add(turfDisk);

    // Architectural stone paver concourse apron around the stadium
    const paverMat = new THREE.MeshStandardMaterial({
      color: 0x334155,
      roughness: 0.82,
      metalness: 0.08,
    });
    const concourseSlab = new THREE.Mesh(
      new THREE.PlaneGeometry(32, 34).rotateX(-Math.PI / 2),
      paverMat
    );
    concourseSlab.position.y = -0.019;
    concourseSlab.receiveShadow = true;
    envGroup.add(concourseSlab);

    // 3. Perimeter Court Walls & High-Contrast LED Sponsor Ribbon Boards
    const makeSponsorBoardTex = (brand, tagline, bgHex, accentHex, badgeText) => {
      const c = document.createElement('canvas');
      c.width = 1024;
      c.height = 256;
      const ctx = c.getContext('2d');
      const grad = ctx.createLinearGradient(0, 0, 1024, 256);
      grad.addColorStop(0, bgHex);
      grad.addColorStop(1, '#091526');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, 1024, 256);

      // Subtle diagonal carbon-style stripes
      ctx.strokeStyle = 'rgba(255,255,255,0.04)';
      ctx.lineWidth = 14;
      for (let x = -256; x < 1280; x += 48) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x + 200, 256);
        ctx.stroke();
      }

      // Top & bottom accent bars
      ctx.fillStyle = accentHex;
      ctx.fillRect(0, 0, 1024, 10);
      ctx.fillRect(0, 246, 1024, 10);

      // Left badge pill
      ctx.fillStyle = accentHex;
      ctx.beginPath();
      ctx.roundRect(36, 46, 156, 42, 8);
      ctx.fill();
      ctx.fillStyle = '#091526';
      ctx.font = '900 22px Inter, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(badgeText, 114, 75);

      // Main brand typography
      ctx.fillStyle = '#ffffff';
      ctx.font = '900 66px Inter, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(brand, 540, 134);

      ctx.fillStyle = accentHex;
      ctx.font = '700 30px Inter, system-ui, sans-serif';
      ctx.fillText(tagline, 540, 194);

      const tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = 8;
      return tex;
    };

    const texPPA = makeSponsorBoardTex(
      'PPA INDIA OPEN',
      'CHAMPIONSHIP CENTER COURT • USAPA PRO TOUR',
      '#0c2d48',
      '#facc15',
      'LIVE TV'
    );
    const texCarbon = makeSponsorBoardTex(
      'T700 CARBON PRO',
      'RAW TORAY CARBON • 16MM HONEYCOMB CORE',
      '#0f172a',
      '#38bdf8',
      'PRO LAB'
    );
    const texDupr = makeSponsorBoardTex(
      'DUPR PRO ANALYTICS',
      '40-HOLE MAGNUS AERODYNAMICS ENGINE',
      '#0b3b24',
      '#34d399',
      'OFFICIAL'
    );

    const wallMat = new THREE.MeshStandardMaterial({
      color: 0x0f291e,
      roughness: 0.78,
      metalness: 0.12,
    });
    const trimCopingMat = new THREE.MeshStandardMaterial({
      color: 0x1e293b,
      roughness: 0.35,
      metalness: 0.65,
    });
    const matPPA = new THREE.MeshStandardMaterial({ map: texPPA, roughness: 0.4, metalness: 0.1 });
    const matCarbon = new THREE.MeshStandardMaterial({ map: texCarbon, roughness: 0.4, metalness: 0.1 });
    const matDupr = new THREE.MeshStandardMaterial({ map: texDupr, roughness: 0.4, metalness: 0.1 });

    // North & South Baseline Perimeter Walls (at z = ±10.25m, width = 12.6m, height = 1.28m)
    for (const zSign of [-1, 1]) {
      const zPos = zSign * 10.25;
      const wall = new THREE.Mesh(new THREE.BoxGeometry(12.6, 1.28, 0.14), wallMat);
      wall.position.set(0, 0.64, zPos);
      wall.castShadow = true;
      wall.receiveShadow = true;
      envGroup.add(wall);

      const coping = new THREE.Mesh(new THREE.BoxGeometry(12.68, 0.06, 0.2), trimCopingMat);
      coping.position.set(0, 1.29, zPos);
      envGroup.add(coping);

      const mats = [matCarbon, matPPA, matDupr];
      [-3.85, 0, 3.85].forEach((xOff, idx) => {
        const b = new THREE.Mesh(new THREE.PlaneGeometry(3.55, 0.88), mats[idx]);
        b.position.set(xOff, 0.66, zPos - zSign * 0.075);
        if (zSign > 0) b.rotation.y = Math.PI;
        envGroup.add(b);
      });
    }

    // East & West Sideline Perimeter Barrier Walls (at x = ±6.15m, length = 20.6m, height = 0.88m)
    for (const xSign of [-1, 1]) {
      const xPos = xSign * 6.15;
      const sideWall = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.88, 20.6), wallMat);
      sideWall.position.set(xPos, 0.44, 0);
      sideWall.castShadow = true;
      sideWall.receiveShadow = true;
      envGroup.add(sideWall);

      const coping = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.05, 20.66), trimCopingMat);
      coping.position.set(xPos, 0.89, 0);
      envGroup.add(coping);

      const mats = [matDupr, matPPA, matCarbon, matPPA, matDupr];
      [-7.4, -3.7, 0, 3.7, 7.4].forEach((zOff, idx) => {
        const b = new THREE.Mesh(new THREE.PlaneGeometry(3.3, 0.68), mats[idx]);
        b.position.set(xPos - xSign * 0.075, 0.45, zOff);
        b.rotation.y = xSign > 0 ? -Math.PI / 2 : Math.PI / 2;
        envGroup.add(b);
      });
    }

    // 4. Official Pro Umpire High-Chair + Rectangular Awning + Seated Referee + Courtside Player Benches
    const chairSteelMat = new THREE.MeshStandardMaterial({
      color: 0x1e293b,
      roughness: 0.35,
      metalness: 0.72,
    });
    const cushionMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.55 });
    const awningMat = new THREE.MeshStandardMaterial({ color: 0x0c2d48, roughness: 0.65 });

    const umpireGroup = new THREE.Group();
    umpireGroup.position.set(-4.22, 0, 0);
    // 4 angled structural legs + ladder rungs
    for (const [lx, lz] of [[-0.28, -0.26], [0.28, -0.26], [-0.28, 0.26], [0.28, 0.26]]) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.032, 1.85, 12), chairSteelMat);
      leg.position.set(lx, 0.925, lz);
      leg.castShadow = true;
      umpireGroup.add(leg);
    }
    for (let r = 1; r <= 4; r++) {
      const rung = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.52, 8), chairSteelMat);
      rung.rotation.x = Math.PI / 2;
      rung.position.set(0.28, r * 0.38, 0);
      umpireGroup.add(rung);
    }
    const seat = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.07, 0.54), cushionMat);
    seat.position.set(0, 1.86, 0);
    const backrest = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.54, 0.52), cushionMat);
    backrest.position.set(-0.25, 2.15, 0);
    // Rear awning support posts + rectangular architectural sun shade canopy
    for (const pz of [-0.24, 0.24]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 1.15, 8), chairSteelMat);
      post.position.set(-0.26, 2.42, pz);
      umpireGroup.add(post);
    }
    const awningRoof = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.06, 0.88), awningMat);
    awningRoof.position.set(0.05, 2.98, 0);
    awningRoof.rotation.z = -0.06;
    awningRoof.castShadow = true;

    umpireGroup.add(seat, backrest, awningRoof);
    this.umpireGroup = umpireGroup;
    envGroup.add(umpireGroup);

    // Courtside Player Changeover Benches & Drink Coolers (West Sideline at z = ±3.8m)
    const benchSeatMat = new THREE.MeshStandardMaterial({ color: 0x1e3a8a, roughness: 0.5 });
    const coolerMat = new THREE.MeshStandardMaterial({ color: 0x0284c7, roughness: 0.35 });
    const coolerLidMat = new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.3 });
    for (const zBench of [-3.6, 3.6]) {
      const bGroup = new THREE.Group();
      bGroup.position.set(-4.85, 0, zBench);
      const bSeat = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.08, 1.85), benchSeatMat);
      bSeat.position.set(0, 0.46, 0);
      bSeat.castShadow = true;
      const bBack = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.45, 1.85), benchSeatMat);
      bBack.position.set(-0.22, 0.72, 0);
      bBack.castShadow = true;
      const bLeg1 = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.45, 0.08), chairSteelMat);
      bLeg1.position.set(0, 0.225, -0.78);
      const bLeg2 = bLeg1.clone();
      bLeg2.position.z = 0.78;
      const cooler = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.48, 0.56), coolerMat);
      cooler.position.set(0, 0.24, zBench > 0 ? 1.32 : -1.32);
      cooler.castShadow = true;
      const coolerLid = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.06, 0.58), coolerLidMat);
      coolerLid.position.set(0, 0.50, zBench > 0 ? 1.32 : -1.32);
      bGroup.add(bSeat, bBack, bLeg1, bLeg2, cooler, coolerLid);
      envGroup.add(bGroup);
    }

    // 5. Covered East & West Championship Grandstand Pavilions with Seated 3D Human Spectators
    const riserMat = new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.75, metalness: 0.15 });
    const roofCanopyMat = new THREE.MeshStandardMaterial({
      color: 0xf1f5f9,
      roughness: 0.42,
      metalness: 0.18,
    });
    const roofBeamMat = new THREE.MeshStandardMaterial({
      color: 0x0f172a,
      roughness: 0.35,
      metalness: 0.75,
    });
    const glassRailMat = new THREE.MeshStandardMaterial({
      color: 0xbae6fd,
      roughness: 0.15,
      metalness: 0.1,
      transparent: true,
      opacity: 0.38,
    });
    const bucketSeatMat = new THREE.MeshStandardMaterial({
      color: 0x1e3a8a,
      roughness: 0.45,
      metalness: 0.1,
    });

    const seatBaseGeo = new THREE.BoxGeometry(0.42, 0.06, 0.44);
    const seatBackGeo = new THREE.BoxGeometry(0.06, 0.38, 0.42);
    this.spectatorSeatAnchors = [];

    for (const xSign of [-1, 1]) {
      const standGroup = new THREE.Group();
      standGroup.position.set(xSign * 7.85, 0, 0);

      // Front walkway podium + glass safety balustrade
      const frontWalkway = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.42, 17.6), riserMat);
      frontWalkway.position.set(-xSign * 0.55, 0.21, 0);
      frontWalkway.receiveShadow = true;
      standGroup.add(frontWalkway);

      const glassPanel = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.68, 17.4), glassRailMat);
      glassPanel.position.set(-xSign * 0.90, 0.76, 0);
      const topRail = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.04, 17.5), roofBeamMat);
      topRail.position.set(-xSign * 0.90, 1.11, 0);
      standGroup.add(glassPanel, topRail);

      // 4 Tiered Concrete Risers with Molded Stadium Bucket Seats
      for (let tier = 0; tier < 4; tier++) {
        const tierH = 0.52 + tier * 0.54;
        const tierX = xSign * tier * 0.96;
        const tierMesh = new THREE.Mesh(
          new THREE.BoxGeometry(0.98, tierH, 17.6),
          riserMat
        );
        tierMesh.position.set(tierX, tierH * 0.5, 0);
        tierMesh.castShadow = true;
        tierMesh.receiveShadow = true;
        standGroup.add(tierMesh);

        for (let s = -6; s <= 6; s++) {
          const zSeat = s * 1.22;
          const sBase = new THREE.Mesh(seatBaseGeo, bucketSeatMat);
          sBase.position.set(tierX, tierH + 0.03, zSeat);
          const sBack = new THREE.Mesh(seatBackGeo, bucketSeatMat);
          sBack.position.set(tierX + xSign * 0.17, tierH + 0.23, zSeat);
          standGroup.add(sBase, sBack);

          // Populate ~65% of seats with real 3D human spectators once GLBs load
          if ((Math.abs(s * 3 + tier * 5 + (xSign > 0 ? 1 : 0)) % 3) === 0) continue;

          const jitterZ = ((s * 7 + tier * 3) % 5 - 2) * 0.025;
          const idxHash = Math.abs(s * 11 + tier * 7 + (xSign > 0 ? 5 : 0));
          this.spectatorSeatAnchors.push({
            standGroup,
            xSign,
            tier,
            s,
            tierX,
            tierH,
            zSeat: zSeat + jitterZ,
            idxHash,
          });
        }
      }

      // Rear architectural wall & steel columns supporting cantilevered stadium roof
      const rearX = xSign * 3.55;
      const rearWall = new THREE.Mesh(new THREE.BoxGeometry(0.28, 3.6, 17.8), riserMat);
      rearWall.position.set(rearX, 1.8, 0);
      rearWall.castShadow = true;
      rearWall.receiveShadow = true;
      standGroup.add(rearWall);

      for (const zCol of [-8.2, -4.1, 0, 4.1, 8.2]) {
        const col = new THREE.Mesh(new THREE.BoxGeometry(0.24, 5.4, 0.24), roofBeamMat);
        col.position.set(rearX, 2.7, zCol);
        col.castShadow = true;
        const beam = new THREE.Mesh(new THREE.BoxGeometry(4.8, 0.18, 0.22), roofBeamMat);
        beam.position.set(xSign * 1.35, 5.25, zCol);
        beam.rotation.z = xSign * 0.07;
        standGroup.add(col, beam);
      }

      // Cantilevered Stadium Roof Canopy
      const roof = new THREE.Mesh(new THREE.BoxGeometry(5.1, 0.14, 18.4), roofCanopyMat);
      roof.position.set(xSign * 1.35, 5.38, 0);
      roof.rotation.z = xSign * 0.07;
      roof.castShadow = true;
      roof.receiveShadow = true;

      const fascia = new THREE.Mesh(
        new THREE.BoxGeometry(0.12, 0.28, 18.4),
        new THREE.MeshStandardMaterial({ color: 0x0c2d48, roughness: 0.4 })
      );
      fascia.position.set(-xSign * 1.15, 5.22, 0);
      standGroup.add(roof, fascia);

      envGroup.add(standGroup);
    }

    // 6. North End-Court Broadcast Camera Platform & VIP Media Deck (at z = -11.6m)
    const mediaDeck = new THREE.Group();
    mediaDeck.position.set(0, 0, -11.65);
    const deckBase = new THREE.Mesh(new THREE.BoxGeometry(5.2, 1.45, 1.8), riserMat);
    deckBase.position.y = 0.725;
    deckBase.castShadow = true;
    deckBase.receiveShadow = true;
    const camTripod = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.22, 0.95, 10), roofBeamMat);
    camTripod.position.set(0, 1.92, 0.2);
    const camBody = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.28, 0.56), roofBeamMat);
    camBody.position.set(0, 2.45, 0.25);
    const camLens = new THREE.Mesh(
      new THREE.CylinderGeometry(0.09, 0.11, 0.34, 12).rotateX(Math.PI / 2),
      chairSteelMat
    );
    camLens.position.set(0, 2.45, 0.62);
    mediaDeck.add(deckBase, camTripod, camBody, camLens);
    envGroup.add(mediaDeck);

    // 7. Realistic Textured Foliage Trees with Multi-Bough Wooden Trunks & Leafy Canopies
    const leafCanvas = document.createElement('canvas');
    leafCanvas.width = 256;
    leafCanvas.height = 256;
    const lCtx = leafCanvas.getContext('2d');
    lCtx.fillStyle = '#245832';
    lCtx.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 900; i++) {
      const lx = (i * 73) % 256;
      const ly = (i * 139) % 256;
      lCtx.fillStyle = i % 3 === 0 ? '#367542' : i % 3 === 1 ? '#1a4325' : '#468952';
      lCtx.beginPath();
      lCtx.ellipse(lx, ly, 6, 3.5, (i * 0.7) % Math.PI, 0, Math.PI * 2);
      lCtx.fill();
    }
    const leafTex = new THREE.CanvasTexture(leafCanvas);
    leafTex.wrapS = THREE.RepeatWrapping;
    leafTex.wrapT = THREE.RepeatWrapping;
    leafTex.repeat.set(3, 3);
    leafTex.colorSpace = THREE.SRGBColorSpace;

    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x4a3525, roughness: 0.94 });
    const foliageMats = [
      new THREE.MeshStandardMaterial({ map: leafTex, color: 0xd8f3dc, roughness: 0.88, flatShading: true }),
      new THREE.MeshStandardMaterial({ map: leafTex, color: 0xb7e4c7, roughness: 0.86, flatShading: true }),
      new THREE.MeshStandardMaterial({ map: leafTex, color: 0x95d5b2, roughness: 0.85, flatShading: true }),
    ];

    // Sculpt organic vertex-displaced leaf cluster geometry (never smooth round spheres!)
    const leafClusterGeo = new THREE.IcosahedronGeometry(1.0, 2);
    const posAttr = leafClusterGeo.attributes.position;
    for (let vi = 0; vi < posAttr.count; vi++) {
      const vx = posAttr.getX(vi);
      const vy = posAttr.getY(vi);
      const vz = posAttr.getZ(vi);
      const noise =
        1.0 +
        0.18 * Math.sin(vx * 5.2 + vy * 3.7) * Math.cos(vz * 4.8) +
        0.10 * Math.cos(vx * 9.1 - vz * 7.3);
      posAttr.setXYZ(vi, vx * noise, vy * (0.78 + 0.12 * noise), vz * noise);
    }
    leafClusterGeo.computeVertexNormals();

    // Trimmed perimeter boxwood hedges behind north & south walls
    for (const zHedge of [-10.9, 10.9]) {
      for (const xHedge of [-8.2, 8.2]) {
        const hedge = new THREE.Mesh(new THREE.BoxGeometry(3.4, 1.05, 0.95), foliageMats[0]);
        hedge.position.set(xHedge, 0.525, zHedge);
        hedge.castShadow = true;
        hedge.receiveShadow = true;
        envGroup.add(hedge);
      }
    }

    const treeCoords = [
      [-15.5, -15.5], [-9.5, -17.5], [-4.2, -18.5], [4.2, -18.5], [9.5, -17.5], [15.5, -15.5],
      [-17.5, -7.5], [-17.5, 7.5], [17.5, -7.5], [17.5, 7.5],
      [-15.5, 15.5], [-9.0, 17.8], [9.0, 17.8], [15.5, 15.5],
    ];
    treeCoords.forEach(([tx, tz], i) => {
      const tGroup = new THREE.Group();
      const s = 0.92 + (i % 3) * 0.22;
      tGroup.position.set(tx, 0, tz);
      tGroup.scale.setScalar(s);

      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.34, 2.6, 9), trunkMat);
      trunk.position.y = 1.3;
      trunk.castShadow = true;
      tGroup.add(trunk);

      // Angled wooden boughs/branches reaching into the canopy
      for (const [bx, bz, rotZ, rotX] of [[-0.38, 0.25, 0.48, 0.28], [0.40, -0.22, -0.45, -0.25], [0.15, 0.38, -0.22, 0.44]]) {
        const branch = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.13, 1.35, 7), trunkMat);
        branch.position.set(bx, 2.35, bz);
        branch.rotation.set(rotX, 0, rotZ);
        tGroup.add(branch);
      }

      const clusters = [
        [0.0, 3.15, 0.0, 1.55, 1.10, 1.55, 0],
        [-0.85, 2.85, 0.55, 1.18, 0.92, 1.18, 1],
        [0.85, 2.90, -0.50, 1.22, 0.95, 1.22, 2],
        [-0.60, 3.65, -0.60, 1.20, 0.96, 1.20, 1],
        [0.65, 3.70, 0.60, 1.15, 0.92, 1.15, 0],
        [0.05, 4.25, 0.05, 1.28, 0.95, 1.28, 2],
      ];
      clusters.forEach(([cx, cy, cz, sx, sy, sz, mIdx]) => {
        const cl = new THREE.Mesh(leafClusterGeo, foliageMats[mIdx]);
        cl.position.set(cx, cy, cz);
        cl.scale.set(sx, sy, sz);
        cl.rotation.set(cx * 0.9 + i, cy * 0.6, cz * 0.8);
        cl.castShadow = true;
        cl.receiveShadow = true;
        tGroup.add(cl);
      });

      envGroup.add(tGroup);
    });

    // 8. 4 Architectural Stadium Floodlight Masts with Multi-Cell LED Arrays
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, metalness: 0.78, roughness: 0.28 });
    const lampGlowMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      emissive: 0xfff6e0,
      emissiveIntensity: 2.2,
    });
    for (const [px, pz] of [[-13.2, -13.2], [13.2, -13.2], [-13.2, 13.2], [13.2, 13.2]]) {
      const pGroup = new THREE.Group();
      pGroup.position.set(px, 0, pz);
      const basePedestal = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.42, 1.2, 12), riserMat);
      basePedestal.position.y = 0.6;
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.26, 13.5, 14), poleMat);
      pole.position.y = 6.75;
      pole.castShadow = true;

      const headMount = new THREE.Group();
      headMount.position.set(0, 13.5, 0);
      headMount.lookAt(0, 1.0, 0);
      const frameBox = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.82, 0.28), poleMat);
      const ledPanel = new THREE.Mesh(new THREE.PlaneGeometry(1.92, 0.66), lampGlowMat);
      ledPanel.position.z = 0.15;
      headMount.add(frameBox, ledPanel);

      pGroup.add(basePedestal, pole, headMount);
      envGroup.add(pGroup);
    }

    this.scene.add(envGroup);
  }

  /**
   * Upgrades the loaded court.glb materials at runtime with a high-resolution 2048x4096
   * Laykold/SportMaster Pro Tournament Acrylic silica-grit texture, micro-roughness map,
   * woven alpha net cord mesh, and official white center net strap.
   */
  upgradeCourtMaterials(courtRoot) {
    const maxAniso = Math.min(16, this.renderer.capabilities.getMaxAnisotropy());

    // 1. High-Resolution 2048x4096 Pro Tournament Acrylic Court Texture
    // court.glb maps X in [-5.70, 5.70] (11.40m) -> U in [0, 1]
    // and Z in [-10.30, 10.30] (20.60m) -> V in [0, 1]
    const W = 2048;
    const H = 4096;
    const courtCanvas = document.createElement('canvas');
    courtCanvas.width = W;
    courtCanvas.height = H;
    const ctx = courtCanvas.getContext('2d');

    const uFromX = (x) => ((x + 5.70) / 11.40) * W;
    const vFromZ = (z) => ((z + 10.30) / 20.60) * H;

    // Outer Stadium Apron: Deep Tournament Forest/Teal Green (#164e35)
    ctx.fillStyle = '#154c34';
    ctx.fillRect(0, 0, W, H);

    // Subtle directional acrylic roller bands across the court & apron
    for (let i = 0; i < 44; i++) {
      ctx.fillStyle = i % 2 === 0 ? 'rgba(255,255,255,0.014)' : 'rgba(0,0,0,0.014)';
      const y0 = (i / 44) * H;
      ctx.fillRect(0, y0, W, H / 44);
    }

    // Main 20x44ft Playing Surface (X in [-3.048, 3.048], Z in [-6.7056, 6.7056]): Pro Championship Royal Blue (#124e8c)
    const xLeft = uFromX(-3.048);
    const xRight = uFromX(3.048);
    const zNorth = vFromZ(-6.7056);
    const zSouth = vFromZ(6.7056);
    ctx.fillStyle = '#145394';
    ctx.fillRect(xLeft, zNorth, xRight - xLeft, zSouth - zNorth);

    // Non-Volley Zone (7ft Kitchen on both sides of net, Z in [-2.1336, 2.1336]): Pro Contrast Oasis Cyan-Blue (#0c7bb3)
    const zNvzNorth = vFromZ(-2.1336);
    const zNvzSouth = vFromZ(2.1336);
    ctx.fillStyle = '#0e74a8';
    ctx.fillRect(xLeft, zNvzNorth, xRight - xLeft, zNvzSouth - zNvzNorth);

    // Realistic Silica-Sand Micro-Grit & Subtle Baseline Footwork Scuffs
    const bumpCanvas = document.createElement('canvas');
    bumpCanvas.width = 512;
    bumpCanvas.height = 512;
    const bCtx = bumpCanvas.getContext('2d');
    const imgData = bCtx.createImageData(512, 512);
    let seed = 1337;
    for (let i = 0; i < imgData.data.length; i += 4) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      const g = 115 + (seed & 0x1f);
      imgData.data[i] = g;
      imgData.data[i + 1] = g;
      imgData.data[i + 2] = g;
      imgData.data[i + 3] = 255;
    }
    bCtx.putImageData(imgData, 0, 0);

    // Subtle court wear / scuff marks near baselines and kitchen lines
    ctx.save();
    for (const zZone of [-6.85, -2.35, 2.35, 6.85]) {
      const cy = vFromZ(zZone);
      const radGrad = ctx.createRadialGradient(W * 0.5, cy, 20, W * 0.5, cy, 380);
      radGrad.addColorStop(0, 'rgba(255,255,255,0.035)');
      radGrad.addColorStop(1, 'rgba(255,255,255,0.0)');
      ctx.fillStyle = radGrad;
      ctx.fillRect(xLeft, cy - 380, xRight - xLeft, 760);
    }
    ctx.restore();

    // Official USAPA 2-inch (5.08 cm) Crisp Textured White Court Lines
    const lineW = (0.0508 / 11.40) * W;
    const lineH = (0.0508 / 20.60) * H;
    ctx.fillStyle = '#f8fafc';

    // Outer perimeter rectangle (baselines & sidelines)
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

    // Baseline center serving hash marks (2-inch x 6-inch)
    const hashLen = (0.15 / 20.60) * H;
    ctx.fillRect(xCenter - lineW * 0.5, zNorth - hashLen, lineW, hashLen);
    ctx.fillRect(xCenter - lineW * 0.5, zSouth, lineW, hashLen);

    const courtTex = new THREE.CanvasTexture(courtCanvas);
    courtTex.flipY = false;
    courtTex.colorSpace = THREE.SRGBColorSpace;
    courtTex.anisotropy = maxAniso;

    const bumpTex = new THREE.CanvasTexture(bumpCanvas);
    bumpTex.wrapS = THREE.RepeatWrapping;
    bumpTex.wrapT = THREE.RepeatWrapping;
    bumpTex.repeat.set(24, 48);

    // 2. Woven Black Cord Net Mesh Texture
    const netCanvas = document.createElement('canvas');
    netCanvas.width = 128;
    netCanvas.height = 128;
    const nCtx = netCanvas.getContext('2d');
    nCtx.clearRect(0, 0, 128, 128);
    nCtx.fillStyle = 'rgba(15, 23, 42, 0.22)';
    nCtx.fillRect(0, 0, 128, 128);
    nCtx.strokeStyle = 'rgba(15, 23, 42, 0.92)';
    nCtx.lineWidth = 18;
    nCtx.strokeRect(0, 0, 128, 128);
    const netTex = new THREE.CanvasTexture(netCanvas);
    netTex.wrapS = THREE.RepeatWrapping;
    netTex.wrapT = THREE.RepeatWrapping;
    netTex.repeat.set(96, 12);
    netTex.anisotropy = maxAniso;

    courtRoot.traverse((child) => {
      if (!child.isMesh) return;
      child.receiveShadow = true;
      child.castShadow = child.name.includes('Post') || child.position.y > 0.05;

      const matName = child.material ? child.material.name : '';
      if (child.name === 'Court_Surface' || matName === 'Court_Acrylic_Concrete_Mat') {
        child.material = new THREE.MeshStandardMaterial({
          map: courtTex,
          bumpMap: bumpTex,
          bumpScale: 0.0025,
          roughness: 0.64,
          metalness: 0.04,
        });
      } else if (child.name === 'Net_Mesh' || matName === 'Net_Mesh_Black_Mat') {
        child.material = new THREE.MeshStandardMaterial({
          color: 0x0f172a,
          map: netTex,
          transparent: true,
          opacity: 0.82,
          roughness: 0.75,
          side: THREE.DoubleSide,
        });
      } else if (matName === 'Net_Tape_White_Mat') {
        child.material = new THREE.MeshStandardMaterial({
          color: 0xf8fafc,
          roughness: 0.42,
          metalness: 0.05,
        });
      } else if (matName === 'Net_Post_Steel_Mat') {
        child.material = new THREE.MeshStandardMaterial({
          color: 0x0f172a,
          roughness: 0.28,
          metalness: 0.82,
        });
      }
    });

    // Add 3D Official White Center Net Strap & Tension Buckle at X=0, Z=0
    const centerStrap = new THREE.Mesh(
      new THREE.BoxGeometry(0.052, 0.8636, 0.032),
      new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.45 })
    );
    centerStrap.position.set(0, 0.4318, 0);
    centerStrap.castShadow = true;
    courtRoot.add(centerStrap);
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

      // Upgrade 20x44ft USAPA Court with High-Res Laykold Acrylic Texture & Woven Net
      this.upgradeCourtMaterials(this.assets.court);
      this.scene.add(this.assets.court);

      // Add 40-Hole USAPA Pickleball with realistic satin polymer finish
      this.ballMesh = this.assets.ball;
      this.ballMesh.traverse((c) => {
        if (c.isMesh) {
          c.castShadow = true;
          c.receiveShadow = true;
          if (c.material) {
            c.material.roughness = 0.32;
            c.material.metalness = 0.04;
          }
        }
      });
      this.scene.add(this.ballMesh);

      // Build 4 Lifelike Rigged Human Athletes (Male & Female) with Paddles & Facial Morphs
      this.createAthletes();

      // Populate Chair Umpire & Grandstand Audience with Real Articulated Seated 3D Humans
      this.populateHumanUmpireAndSpectators();

      // Hide loading screen & start in Training Mode (Interactive Tutorial)
      const loadingEl = document.getElementById('loading-overlay');
      if (loadingEl) loadingEl.classList.add('hidden');

      this.startMode('training', 0);
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

  createAthletes() {
    const configs = [
      { id: 'p0', name: 'Arjun (You)', gender: 'male', team: 0, isHuman: true },
      { id: 'p1', name: 'Priya (Partner)', gender: 'female', team: 0, isHuman: false },
      { id: 'p2', name: 'Vikram (AI)', gender: 'male', team: 1, isHuman: false },
      { id: 'p3', name: 'Ananya (AI)', gender: 'female', team: 1, isHuman: false },
    ];

    this.players = configs.map((cfg) => {
      const srcGltf = cfg.gender === 'female' ? this.assets.femaleGltf : this.assets.maleGltf;
      const root = SkeletonUtils.clone(srcGltf.scene);
      root.name = `Player_${cfg.id}`;

      const skinHex =
        cfg.id === 'p0'
          ? 0xb87551
          : cfg.id === 'p1'
          ? 0xc68460
          : cfg.id === 'p2'
          ? 0xaa6846
          : 0xbf7c58;
      const humanSkinTex = this.createHumanSkinTexture(skinHex, cfg.gender === 'female');

      let skinnedMesh = null;
      const skinnedMeshes = [];
      let rightHandBone = null;
      let headBone = null;
      let chestBone = null;

      root.traverse((child) => {
        if (child.isMesh) {
          child.castShadow = true;
          child.receiveShadow = true;
          if (child.isSkinnedMesh) {
            skinnedMesh = child;
            skinnedMeshes.push(child);
            if (child.morphTargetInfluences) {
              child.morphTargetInfluences.fill(0);
            }
          }

          // Clone material per athlete so Team 0 vs Team 1 have distinct pro tournament kits
          if (Array.isArray(child.material)) {
            child.material = child.material.map((m) => (m ? m.clone() : m));
          } else if (child.material) {
            child.material = child.material.clone();
          }

          const mats = Array.isArray(child.material) ? child.material : [child.material];
          mats.forEach((m) => {
            if (!m) return;
            if (m.name.startsWith('Lips_')) {
              m.color.setHex(cfg.gender === 'female' ? 0xa64b45 : 0x874039);
              m.roughness = 0.36;
            } else if (m.name.startsWith('IndianSkin_') || m.name.startsWith('Cheek_')) {
              m.color.setHex(0xffffff);
              m.map = humanSkinTex;
              m.roughness = 0.44;
              m.metalness = 0.02;
              m.envMapIntensity = 0.25;
              m.needsUpdate = true;
            } else if (m.name.includes('Hair')) {
              m.color.setHex(cfg.gender === 'female' ? 0x1a120e : 0x16110e);
              m.roughness = 0.86;
              m.metalness = 0.0;
              m.envMapIntensity = 0.12;
            } else if (m.name.startsWith('Jersey_')) {
              // Team 0 (Arjun/Priya): Championship Royal Navy/Cobalt; Team 1 (Vikram/Ananya): Pro Crimson/Burgundy
              if (cfg.team === 0) {
                m.color.setHex(cfg.gender === 'female' ? 0x0284c7 : 0x1d4ed8);
              } else {
                m.color.setHex(cfg.gender === 'female' ? 0xbe123c : 0xb91c1c);
              }
              m.roughness = 0.62;
            } else if (m.name.startsWith('Shorts_') || m.name.startsWith('Bottoms_')) {
              m.color.setHex(cfg.team === 0 ? 0x0f172a : 0x18181b);
              m.roughness = 0.68;
            } else if (m.name.startsWith('Accent_')) {
              m.color.setHex(cfg.team === 0 ? 0xfacc15 : 0x38bdf8);
              m.roughness = 0.35;
            }
          });
        }
        if (child.isBone) {
          if (child.name === 'Hand.R') rightHandBone = child;
          if (child.name === 'Head') headBone = child;
          if (child.name === 'Chest') chestBone = child;
        }
      });

      // Attach cloned 3D Honeycomb Paddle to Right Hand Bone
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
        this.transitionPlayerAnim(playerObj, 'Idle_SplitStep', 0.22);
      });

      const playerObj = {
        ...cfg,
        root,
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
   * Populates the Chair Umpire high chair and Grandstand spectator seats with real,
   * articulated, seated 3D human characters cloned from our rigged athlete GLBs.
   */
  populateHumanUmpireAndSpectators() {
    if (!this.assets.maleGltf || !this.assets.femaleGltf) return;

    const findSeatedClip = (gltf) =>
      gltf.animations.find((c) => c.name.includes('Seated_Spectator')) || gltf.animations[0];

    const skinTones = [0xc6865e, 0xb5724e, 0xd4966e, 0x9c5c3c, 0x8a4e32, 0xe0a67e];
    const hairTones = [0x14110f, 0x261a14, 0x3b261c, 0x1c1817, 0x4a3222];
    const shirtPalette = [
      0x1d4ed8, 0xe11d48, 0xf59e0b, 0x10b981, 0x7c3aed, 0x0284c7, 0xf8fafc, 0xea580c, 0x0d9488,
    ];
    const pantsPalette = [0x1e293b, 0x334155, 0x0f172a, 0x27272a, 0x3f3f46];

    const skinTexCache = {
      male: skinTones.map((hex) => this.createHumanSkinTexture(hex, false)),
      female: skinTones.map((hex) => this.createHumanSkinTexture(hex, true)),
    };

    // 1. Seated Official Chair Umpire on the Sideline High Chair
    if (this.umpireGroup) {
      const umpireRoot = SkeletonUtils.clone(this.assets.maleGltf.scene);
      umpireRoot.name = 'ChairUmpire_Human';
      let umpireHead = null;

      umpireRoot.traverse((child) => {
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
            if (m.name.startsWith('IndianSkin_') || m.name.startsWith('Cheek_')) {
              m.color.setHex(0xffffff);
              m.map = skinTexCache.male[1];
              m.roughness = 0.44;
              m.needsUpdate = true;
            } else if (m.name.startsWith('Jersey_')) {
              // Official PPA Tour Referee Amber-Gold Polo
              m.color.setHex(0xeab308);
              m.roughness = 0.65;
            } else if (m.name.startsWith('Shorts_') || m.name.startsWith('Bottoms_')) {
              // Navy Referee Slacks
              m.color.setHex(0x0f172a);
              m.roughness = 0.72;
            } else if (m.name.startsWith('Accent_')) {
              m.color.setHex(0x1e293b);
            }
          });
        }
        if (child.isBone && child.name === 'Head') {
          umpireHead = child;
        }
      });

      const umpMixer = new THREE.AnimationMixer(umpireRoot);
      const seatedClip = findSeatedClip(this.assets.maleGltf);
      if (seatedClip) {
        const act = umpMixer.clipAction(seatedClip);
        act.play();
        umpMixer.update(0.05);
      }

      // Position seated umpire on high-chair seat pan (y = 1.80) facing +X toward the court
      umpireRoot.scale.setScalar(0.88);
      umpireRoot.position.set(0.02, 1.32, 0);
      umpireRoot.rotation.y = Math.PI / 2;
      umpireRoot.updateMatrixWorld(true);
      this.umpireGroup.add(umpireRoot);
      this.umpireHeadBone = umpireHead;
    }

    // 2. Articulated 3D Human Grandstand Spectators
    if (this.spectatorSeatAnchors && this.spectatorSeatAnchors.length > 0) {
      this.spectators = [];
      this.spectatorSeatAnchors.forEach((seat, idx) => {
        const isFemale = idx % 2 === 1;
        const srcGltf = isFemale ? this.assets.femaleGltf : this.assets.maleGltf;
        const specRoot = SkeletonUtils.clone(srcGltf.scene);
        specRoot.name = `Spectator_Human_${idx}`;

        const skinIdx = idx % skinTones.length;
        const skinTex = isFemale ? skinTexCache.female[skinIdx] : skinTexCache.male[skinIdx];
        const shirtHex = shirtPalette[(idx * 3 + Math.floor(idx / 2)) % shirtPalette.length];
        const pantsHex = pantsPalette[idx % pantsPalette.length];
        const hairHex = hairTones[idx % hairTones.length];
        let headBone = null;

        specRoot.traverse((child) => {
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
              if (m.name.startsWith('IndianSkin_') || m.name.startsWith('Cheek_')) {
                m.color.setHex(0xffffff);
                m.map = skinTex;
                m.roughness = 0.46;
                m.needsUpdate = true;
              } else if (m.name.startsWith('Jersey_')) {
                m.color.setHex(shirtHex);
                m.roughness = 0.72;
              } else if (m.name.startsWith('Shorts_') || m.name.startsWith('Bottoms_')) {
                m.color.setHex(pantsHex);
                m.roughness = 0.78;
              } else if (m.name.startsWith('Hair_')) {
                m.color.setHex(hairHex);
              } else if (m.name.startsWith('Accent_') || m.name.startsWith('Shoe_')) {
                m.color.setHex(idx % 3 === 0 ? 0xf8fafc : 0x1e293b);
              }
            });
          }
          if (child.isBone && child.name === 'Head') {
            headBone = child;
          }
        });

        const specMixer = new THREE.AnimationMixer(specRoot);
        const seatedClip = findSeatedClip(srcGltf);
        if (seatedClip) {
          const act = specMixer.clipAction(seatedClip);
          act.play();
          specMixer.update(0.05);
        }

        const scale = 0.80 + (idx % 3) * 0.03;
        specRoot.scale.setScalar(scale);

        // Seat cushion top is at y = seat.tierH + 0.02; character's seated pelvis/thigh underside is ~0.58 * scale above root
        const baseY = seat.tierH + 0.02 - 0.56 * scale;
        const seatX = seat.tierX - seat.xSign * 0.04;
        specRoot.position.set(seatX, baseY, seat.zSeat);

        // Face across the court toward the net & action
        const baseFacing = seat.xSign > 0 ? -Math.PI / 2 : Math.PI / 2;
        const courtTurn = (seat.xSign > 0 ? 1 : -1) * Math.atan2(seat.zSeat, 9.5) * 0.35;
        specRoot.rotation.y = baseFacing + courtTurn;
        specRoot.updateMatrixWorld(true);

        seat.standGroup.add(specRoot);
        this.spectators.push({
          mesh: specRoot,
          headBone,
          baseY,
          xSign: seat.xSign,
          zSeat: seat.zSeat,
          phase: idx * 0.95,
        });
      });
    }
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

  startMode(mode, trainingIndex = 0) {
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
      this.rules.rallyPhase === 'serve_in_flight' && this.rules.rallyShotCount === 1
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

    // 6. Animate Stadium Spectators & Chair Umpire (head-tracking the ball + cheering on points)
    if (this.crowdCheerTimer > 0) {
      this.crowdCheerTimer -= scaledDt;
    }
    const cheerAmp = this.crowdCheerTimer > 0 ? 0.10 : 0.008;
    const cheerFreq = this.crowdCheerTimer > 0 ? 12.0 : 2.0;
    const ballZ = this.physics ? this.physics.pos.z : 0;

    if (this.umpireHeadBone) {
      const targetYaw = THREE.MathUtils.clamp(-ballZ * 0.085, -0.52, 0.52);
      this.umpireHeadBone.rotation.y = THREE.MathUtils.lerp(
        this.umpireHeadBone.rotation.y,
        targetYaw,
        0.12
      );
    }

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
    });

    // 8. Update Dynamic On-Screen Key Prompts & Recommended Shot Badges
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
        const breath = 1.0 + Math.sin(this.time * 3.2 + (p.team * 1.5)) * 0.012;
        p.chestBone.scale.set(breath, 1.0, breath);
      }

      this.updatePlayerMorphTargets(p, dt);
    }
  }

  /**
   * Handles Human Player Swing Request (Spacebar, Left Mouse Click, or On-Screen Button)
   */
  triggerHumanSwing() {
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
      this.camera.position.set(0, 7.2, 13.9);
      this.controls.target.set(0, 0.25, 0.45);
    } else if (preset === 'player') {
      const px = human ? human.pos.x * 0.5 : 0;
      this.camera.position.set(px, 2.85, 10.2);
      this.controls.target.set(0, 0.85, -2.2);
    } else if (preset === 'kitchen') {
      this.camera.position.set(5.9, 2.15, 0.2);
      this.controls.target.set(0, 0.82, 0);
    } else if (preset === 'overhead') {
      this.camera.position.set(0, 17.2, 0.01);
      this.controls.target.set(0, 0, 0);
    } else if (preset === 'closeup' && human) {
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

      if (e.code === 'Space' && !e.repeat) {
        e.preventDefault();
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

    // Pro Spin & Angle Lab Drawer Toggle
    const btnToggleLab = document.getElementById('btn-toggle-lab');
    const btnCloseLab = document.getElementById('btn-close-lab');
    const labDrawer = document.getElementById('paddle-lab-drawer');
    if (btnToggleLab && labDrawer) {
      btnToggleLab.addEventListener('click', () => {
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
          this.setPlayerExpression(p, expr, 4.0, null, expr === 'Celebration' || expr === 'Frustration')
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

    this.players.forEach((p) => {
      let badge = document.getElementById(`label-${p.id}`);
      if (!badge) {
        badge = document.createElement('div');
        badge.id = `label-${p.id}`;
        badge.className = `player-floating-label ${p.team === 0 ? 'team-near' : 'team-far'}`;
        container.appendChild(badge);
      }

      if (!p.active || (this.cameraPreset === 'closeup' && p.isHuman)) {
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
