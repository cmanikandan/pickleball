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
    this.scene.background = new THREE.Color(0x9bd2f5);
    this.scene.fog = new THREE.FogExp2(0xcbe7fb, 0.0065);

    this.camera = new THREE.PerspectiveCamera(
      45,
      window.innerWidth / window.innerHeight,
      0.1,
      260
    );
    this.camera.position.set(0, 6.4, 12.6);

    // Secondary Portrait Camera for the Top-Right "Live 3D Human Emotion Cam" (PiP)
    this.faceCamera = new THREE.PerspectiveCamera(25, 2.0, 0.08, 40);

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
    this.renderer.toneMappingExposure = 1.12;
    this.renderer.autoClear = false;

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.maxPolarAngle = Math.PI * 0.485;
    this.controls.minDistance = 1.2;
    this.controls.maxDistance = 34;
    this.controls.target.set(0, 0.7, 0);
    // Right-click drag orbits camera so Left-click is dedicated to paddle strikes!
    this.controls.mouseButtons = {
      LEFT: null,
      MIDDLE: THREE.MOUSE.DOLLY,
      RIGHT: THREE.MOUSE.ROTATE,
    };

    // Realistic Outdoor Sunlit Daylight + Golden-Hour Stadium Lighting
    const hemiLight = new THREE.HemisphereLight(0xeef8ff, 0x5c7a52, 1.15);
    this.scene.add(hemiLight);

    const sunLight = new THREE.DirectionalLight(0xfff6e5, 2.35);
    sunLight.position.set(14.0, 22.0, 14.0);
    sunLight.castShadow = true;
    sunLight.shadow.mapSize.set(2048, 2048);
    sunLight.shadow.camera.near = 1;
    sunLight.shadow.camera.far = 55;
    const d = 14.0;
    sunLight.shadow.camera.left = -d;
    sunLight.shadow.camera.right = d;
    sunLight.shadow.camera.top = d;
    sunLight.shadow.camera.bottom = -d;
    sunLight.shadow.bias = -0.0004;
    this.scene.add(sunLight);

    // Soft warm bounce light on faces so facial emotions are crystal clear from every angle
    const faceFillNear = new THREE.DirectionalLight(0xffe8d6, 0.65);
    faceFillNear.position.set(0, 4.5, -10.0);
    const faceFillFar = new THREE.DirectionalLight(0xffe8d6, 0.65);
    faceFillFar.position.set(0, 4.5, 10.0);
    this.scene.add(faceFillNear, faceFillFar);

    // Build Photorealistic Outdoor Pickleball Stadium, Sky Dome, Windscreens, Grandstands & Trees
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
   * Builds a realistic real-world outdoor pickleball tournament stadium:
   * - Atmospheric Sky Dome with Sun & Cumulus Clouds
   * - Lush Country-Club Park Grounds & Walkways
   * - 360° Dark-Green USAPA Windscreens with Sponsor Banners
   * - Sideline Spectator Bleachers with 3D Cheering Crowd
   * - Umpire High Chair, Shaded Player Canopies, Trees & Floodlight Towers
   */
  buildRealisticOutdoorStadium() {
    const envGroup = new THREE.Group();
    envGroup.name = 'Outdoor_Pickleball_Stadium';

    // 1. Atmospheric Sky Dome Shader
    const skyGeo = new THREE.SphereGeometry(180, 36, 20);
    const skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        topColor: { value: new THREE.Color(0x2563eb) },
        midColor: { value: new THREE.Color(0x7dd3fc) },
        bottomColor: { value: new THREE.Color(0xfff1d6) },
        sunDir: { value: new THREE.Vector3(0.45, 0.55, 0.45).normalize() },
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
        void main() {
          vec3 dir = normalize(vWorldPos);
          float h = clamp(dir.y, 0.0, 1.0);
          vec3 col = mix(bottomColor, midColor, smoothstep(0.0, 0.28, h));
          col = mix(col, topColor, smoothstep(0.28, 0.85, h));
          float sunAmt = max(dot(dir, sunDir), 0.0);
          col += vec3(1.0, 0.92, 0.72) * pow(sunAmt, 32.0) * 0.45;
          col += vec3(1.0, 0.98, 0.9) * smoothstep(0.996, 0.9995, sunAmt);
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });
    envGroup.add(new THREE.Mesh(skyGeo, skyMat));

    // 2. Lush Country-Club Turf & Park Grounds outside Concrete Court Apron
    const turfMat = new THREE.MeshStandardMaterial({
      color: 0x3b7a3e,
      roughness: 0.92,
      metalness: 0.02,
    });
    const turfDisk = new THREE.Mesh(
      new THREE.CircleGeometry(140, 64).rotateX(-Math.PI / 2),
      turfMat
    );
    turfDisk.position.y = -0.025;
    turfDisk.receiveShadow = true;
    envGroup.add(turfDisk);

    // Outer terracotta/stone tournament concourse ring
    const walkway = new THREE.Mesh(
      new THREE.RingGeometry(11.8, 17.5, 64).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: 0xc2b59b, roughness: 0.88 })
    );
    walkway.position.y = -0.018;
    walkway.receiveShadow = true;
    envGroup.add(walkway);

    // 3. Perimeter USAPA Dark-Green Windscreens & Sponsor Banners
    const makeBannerTexture = (title, subtitle, accentHex) => {
      const c = document.createElement('canvas');
      c.width = 512;
      c.height = 128;
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#0f3822';
      ctx.fillRect(0, 0, 512, 128);
      ctx.strokeStyle = accentHex;
      ctx.lineWidth = 6;
      ctx.strokeRect(8, 8, 496, 112);
      ctx.fillStyle = '#ffffff';
      ctx.font = '900 34px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(title, 256, 62);
      ctx.fillStyle = accentHex;
      ctx.font = '700 20px Inter, sans-serif';
      ctx.fillText(subtitle, 256, 96);
      const tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace;
      return tex;
    };

    const bannerTexMain = makeBannerTexture('PPA INDIA OPEN', 'OFFICIAL USAPA 20x44 PRO COURT', '#facc15');
    const bannerTexSide = makeBannerTexture('T700 CARBON PRO', '40-HOLE AERODYNAMICS LAB', '#38bdf8');
    const windscreenMat = new THREE.MeshStandardMaterial({
      color: 0x113e25,
      roughness: 0.85,
      side: THREE.DoubleSide,
    });
    const bannerMatMain = new THREE.MeshStandardMaterial({ map: bannerTexMain, roughness: 0.65 });
    const bannerMatSide = new THREE.MeshStandardMaterial({ map: bannerTexSide, roughness: 0.65 });

    // North & South Baseline Windscreens (at z = ±10.2m, width = 12.4m, height = 1.35m)
    for (const zSign of [-1, 1]) {
      const zPos = zSign * 10.2;
      const wall = new THREE.Mesh(new THREE.BoxGeometry(12.4, 1.35, 0.08), windscreenMat);
      wall.position.set(0, 0.675, zPos);
      wall.castShadow = true;
      wall.receiveShadow = true;
      envGroup.add(wall);

      for (const xOff of [-3.2, 0, 3.2]) {
        const b = new THREE.Mesh(
          new THREE.PlaneGeometry(2.7, 0.72),
          xOff === 0 ? bannerMatMain : bannerMatSide
        );
        b.position.set(xOff, 0.72, zPos - zSign * 0.05);
        if (zSign > 0) b.rotation.y = Math.PI;
        envGroup.add(b);
      }
    }

    // East & West Sideline Low Barrier Walls (at x = ±6.2m, length = 20.4m, height = 0.85m)
    for (const xSign of [-1, 1]) {
      const xPos = xSign * 6.2;
      const sideWall = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.85, 20.4), windscreenMat);
      sideWall.position.set(xPos, 0.425, 0);
      sideWall.castShadow = true;
      sideWall.receiveShadow = true;
      envGroup.add(sideWall);

      for (const zOff of [-5.2, 0, 5.2]) {
        const b = new THREE.Mesh(
          new THREE.PlaneGeometry(2.6, 0.62),
          zOff === 0 ? bannerMatMain : bannerMatSide
        );
        b.position.set(xPos - xSign * 0.05, 0.44, zOff);
        b.rotation.y = xSign > 0 ? -Math.PI / 2 : Math.PI / 2;
        envGroup.add(b);
      }
    }

    // 4. Official Umpire High-Chair at West Net Post (x = -3.85, z = 0)
    const chairMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.4, metalness: 0.6 });
    const umpireGroup = new THREE.Group();
    umpireGroup.position.set(-4.15, 0, 0);
    const legGeo = new THREE.CylinderGeometry(0.03, 0.03, 1.85, 10);
    for (const [lx, lz] of [[-0.25, -0.25], [0.25, -0.25], [-0.25, 0.25], [0.25, 0.25]]) {
      const leg = new THREE.Mesh(legGeo, chairMat);
      leg.position.set(lx, 0.92, lz);
      umpireGroup.add(leg);
    }
    const seat = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.08, 0.54), chairMat);
    seat.position.set(0, 1.85, 0);
    const backrest = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.52, 0.52), chairMat);
    backrest.position.set(-0.25, 2.12, 0);
    // Canopy shade above umpire chair
    const canopy = new THREE.Mesh(
      new THREE.ConeGeometry(0.85, 0.35, 8),
      new THREE.MeshStandardMaterial({ color: 0x0f3822, roughness: 0.7 })
    );
    canopy.position.set(0, 2.95, 0);
    umpireGroup.add(seat, backrest, canopy);
    envGroup.add(umpireGroup);

    // 5. Sideline Spectator Bleachers & Animated 3D Spectators (East & West Grandstands)
    const stepMat = new THREE.MeshStandardMaterial({ color: 0x64748b, roughness: 0.6, metalness: 0.2 });
    const skinMatCrowd = new THREE.MeshStandardMaterial({ color: 0xb8734b, roughness: 0.55 });
    const hairMatCrowd = new THREE.MeshStandardMaterial({ color: 0x1a1412, roughness: 0.7 });
    const shirtColors = [0x38bdf8, 0xf97316, 0xfacc15, 0x10b981, 0xec4899, 0xa855f7, 0xffffff];

    for (const xSign of [-1, 1]) {
      const standGroup = new THREE.Group();
      standGroup.position.set(xSign * 8.4, 0, 0);

      for (let tier = 0; tier < 3; tier++) {
        const tierMesh = new THREE.Mesh(
          new THREE.BoxGeometry(0.95, 0.42 * (tier + 1), 14.5),
          stepMat
        );
        tierMesh.position.set(xSign * tier * 0.95, 0.21 * (tier + 1), 0);
        tierMesh.castShadow = true;
        tierMesh.receiveShadow = true;
        standGroup.add(tierMesh);

        // Populate each tier with cheering human spectators
        for (let s = -5; s <= 5; s += 2) {
          const specGroup = new THREE.Group();
          const baseH = 0.42 * (tier + 1);
          const zPos = s * 1.15 + (tier % 2) * 0.45;
          specGroup.position.set(xSign * tier * 0.95, baseH, zPos);
          specGroup.rotation.y = xSign > 0 ? -Math.PI / 2 : Math.PI / 2;

          const shirtMat = new THREE.MeshStandardMaterial({
            color: shirtColors[Math.abs(s + tier * 3) % shirtColors.length],
            roughness: 0.65,
          });
          const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.16, 0.34, 8, 12), shirtMat);
          torso.position.y = 0.32;
          const head = new THREE.Mesh(new THREE.SphereGeometry(0.125, 12, 10), skinMatCrowd);
          head.position.y = 0.66;
          const hair = new THREE.Mesh(new THREE.SphereGeometry(0.13, 12, 8), hairMatCrowd);
          hair.position.set(0, 0.70, -0.02);
          specGroup.add(torso, head, hair);

          standGroup.add(specGroup);
          this.spectators.push({
            mesh: specGroup,
            baseY: baseH,
            phase: (s * 1.3 + tier) * 0.9,
          });
        }
      }
      envGroup.add(standGroup);
    }

    // 6. Lush Surrounding Cypress & Park Trees + 4 Stadium Floodlight Towers
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x5c4033, roughness: 0.9 });
    const foliageMat1 = new THREE.MeshStandardMaterial({ color: 0x2d6a32, roughness: 0.82 });
    const foliageMat2 = new THREE.MeshStandardMaterial({ color: 0x3f8244, roughness: 0.82 });

    const treeCoords = [
      [-14, -15], [-9, -17], [0, -18], [9, -17], [14, -15],
      [-16, -6], [-16, 6], [16, -6], [16, 6],
      [-14, 15], [-8, 17], [8, 17], [14, 15],
    ];
    treeCoords.forEach(([tx, tz], i) => {
      const tGroup = new THREE.Group();
      const s = 0.9 + (i % 3) * 0.22;
      tGroup.position.set(tx, 0, tz);
      tGroup.scale.setScalar(s);

      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.34, 2.2, 10), trunkMat);
      trunk.position.y = 1.1;
      trunk.castShadow = true;
      const crown1 = new THREE.Mesh(new THREE.SphereGeometry(1.45, 14, 12), foliageMat1);
      crown1.position.set(0, 2.9, 0);
      crown1.scale.set(1, 1.35, 1);
      crown1.castShadow = true;
      const crown2 = new THREE.Mesh(new THREE.SphereGeometry(1.1, 12, 10), foliageMat2);
      crown2.position.set(0.35, 4.1, 0.2);
      crown2.castShadow = true;
      tGroup.add(trunk, crown1, crown2);
      envGroup.add(tGroup);
    });

    // 4 Corner Stadium Light Poles
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x334155, metalness: 0.7, roughness: 0.35 });
    const lampMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      emissive: 0xfff8dc,
      emissiveIntensity: 1.5,
    });
    for (const [px, pz] of [[-11.5, -11.5], [11.5, -11.5], [-11.5, 11.5], [11.5, 11.5]]) {
      const pGroup = new THREE.Group();
      pGroup.position.set(px, 0, pz);
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.18, 11.5, 12), poleMat);
      pole.position.y = 5.75;
      const headBox = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.45, 0.35), lampMat);
      headBox.position.set(0, 11.5, 0);
      headBox.lookAt(0, 0, 0);
      pGroup.add(pole, headBox);
      envGroup.add(pGroup);
    }

    this.scene.add(envGroup);
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

      // Add 20x44ft USAPA Court
      this.assets.court.traverse((child) => {
        if (child.isMesh) {
          child.receiveShadow = true;
          child.castShadow = child.name.includes('Post') || child.position.y > 0.05;
        }
      });
      this.scene.add(this.assets.court);

      // Add 40-Hole USAPA Pickleball
      this.ballMesh = this.assets.ball;
      this.ballMesh.traverse((c) => {
        if (c.isMesh) {
          c.castShadow = true;
          c.receiveShadow = true;
        }
      });
      this.scene.add(this.ballMesh);

      // Build 4 Lifelike Rigged Human Athletes (Male & Female) with Paddles & Facial Morphs
      this.createAthletes();

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

      let skinnedMesh = null;
      let rightHandBone = null;
      let headBone = null;
      let chestBone = null;

      root.traverse((child) => {
        if (child.isMesh) {
          child.castShadow = true;
          child.receiveShadow = true;
          if (child.isSkinnedMesh) {
            skinnedMesh = child;
          }
          // Fine-tune human skin, lip, cheek, and eye materials for natural outdoor sunlight warmth
          const mats = Array.isArray(child.material) ? child.material : [child.material];
          mats.forEach((m) => {
            if (!m) return;
            if (m.name.startsWith('Lips_')) {
              m.color.setHex(cfg.gender === 'female' ? 0x9e423b : 0x7c352d);
              m.roughness = 0.42;
            } else if (m.name.startsWith('Cheek_')) {
              m.color.setHex(cfg.gender === 'female' ? 0xb86646 : 0xa5593b);
              m.roughness = 0.5;
            } else if (m.name.startsWith('IndianSkin_')) {
              m.color.setHex(cfg.gender === 'female' ? 0xb56d49 : 0xa35e3c);
              m.roughness = 0.48;
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

      // Set up THREE.AnimationMixer with all 9 exported actions (including Celebrate_FistPump & Frustrated_Slump!)
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
      Celebration: exprName === 'Celebration' ? 1.0 : 0.0,
      Frustration: exprName === 'Frustration' ? 1.0 : 0.0,
      Effort: exprName === 'Effort' ? 0.95 : 0.0,
      Surprise: exprName === 'Surprise' ? 0.95 : 0.0,
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
    if (!player.skinnedMesh || !player.skinnedMesh.morphTargetDictionary) return;
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
    const dict = player.skinnedMesh.morphTargetDictionary;
    const infl = player.skinnedMesh.morphTargetInfluences;
    if (!infl) return;

    for (const key of ['Celebration', 'Frustration', 'Effort', 'Surprise']) {
      const idx = dict[key];
      if (idx !== undefined) {
        const targetVal = player.expressionTargets[key] || 0;
        infl[idx] = THREE.MathUtils.lerp(infl[idx], targetVal, Math.min(1, dt * 8.5));
      }
    }
  }

  startMode(mode, trainingIndex = 0) {
    this.rules.setMode(mode, trainingIndex);
    this.setupPointPositions();
    this.updateModeUI();
    this.updateScoreHUD();
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

    // 6. Animate Stadium Spectators (cheering bounce when points are scored!)
    if (this.crowdCheerTimer > 0) {
      this.crowdCheerTimer -= scaledDt;
    }
    const cheerAmp = this.crowdCheerTimer > 0 ? 0.14 : 0.015;
    const cheerFreq = this.crowdCheerTimer > 0 ? 14.0 : 2.2;
    for (const sp of this.spectators) {
      sp.mesh.position.y =
        sp.baseY + Math.abs(Math.sin(this.time * cheerFreq + sp.phase)) * cheerAmp;
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
      this.controls.target.lerp(new THREE.Vector3(human.pos.x, 1.54, human.pos.z), 0.12);
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
      this.camera.position.set(0, 6.4, 12.6);
      this.controls.target.set(0, 0.6, 0);
    } else if (preset === 'player') {
      const px = human ? human.pos.x * 0.5 : 0;
      this.camera.position.set(px, 3.0, 9.8);
      this.controls.target.set(0, 0.8, -2.5);
    } else if (preset === 'kitchen') {
      this.camera.position.set(6.2, 2.2, 0.0);
      this.controls.target.set(0, 0.75, 0);
    } else if (preset === 'overhead') {
      this.camera.position.set(0, 16.5, 0.01);
      this.controls.target.set(0, 0, 0);
    } else if (preset === 'closeup' && human) {
      this.camera.position.set(human.pos.x + 0.25, 1.62, human.pos.z - 1.25);
      this.controls.target.set(human.pos.x, 1.54, human.pos.z);
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

      if (!p.active) {
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
    const fwdX = -Math.sin(yaw);
    const fwdZ = -Math.cos(yaw);
    const facePos = new THREE.Vector3(
      targetPlayer.pos.x,
      1.58,
      targetPlayer.pos.z
    );
    this.faceCamera.position.set(
      facePos.x + fwdX * 0.92 + fwdZ * 0.14,
      1.61,
      facePos.z + fwdZ * 0.92 - fwdX * 0.14
    );
    this.faceCamera.lookAt(facePos.x, 1.56, facePos.z);

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
