import * as THREE from 'three';
import { COURT_SPECS, BALL_SPECS } from '../physics/PickleballPhysics.js';

/**
 * 3D Court Visual Guides & Holographic Tutorial Overlays:
 * - Non-Volley Zone ("The Kitchen") state-reactive highlight & laser boundary
 * - Legal Diagonal Service Box highlight + Underhand Serve Pendulum Arc
 * - Double-Bounce Rule floor rings (Bounce #1 & Bounce #2 indicators)
 * - Real-time 3D Aim Reticle, Ballistic Trajectory Preview Ribbon, and Bounce Impact Rings
 */
export class CourtOverlays {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.group.name = 'CourtTutorialOverlays';
    this.scene.add(this.group);

    this.showGuides = true;

    this.buildKitchenOverlay();
    this.buildServiceBoxOverlay();
    this.buildAimAndTrajectoryOverlay();
    this.buildBounceMarkerPool();
  }

  buildKitchenOverlay() {
    this.kitchenGroup = new THREE.Group();
    // Near Kitchen (z in [0, +2.1336m]) and Far Kitchen (z in [-2.1336m, 0])
    const geo = new THREE.PlaneGeometry(COURT_SPECS.WIDTH - 0.08, COURT_SPECS.NVZ_DEPTH - 0.06);
    geo.rotateX(-Math.PI / 2);

    this.nearKitchenMat = new THREE.MeshBasicMaterial({
      color: 0xff5238,
      transparent: true,
      opacity: 0.18,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.farKitchenMat = new THREE.MeshBasicMaterial({
      color: 0xff5238,
      transparent: true,
      opacity: 0.14,
      depthWrite: false,
      side: THREE.DoubleSide,
    });

    this.nearKitchenMesh = new THREE.Mesh(geo, this.nearKitchenMat);
    this.nearKitchenMesh.position.set(0, 0.012, COURT_SPECS.NVZ_DEPTH * 0.5);

    this.farKitchenMesh = new THREE.Mesh(geo, this.farKitchenMat);
    this.farKitchenMesh.position.set(0, 0.012, -COURT_SPECS.NVZ_DEPTH * 0.5);

    // Glowing NVZ Laser Line bars at z = +-2.1336m
    const lineGeo = new THREE.BoxGeometry(COURT_SPECS.WIDTH, 0.014, 0.065);
    this.nvzLineMat = new THREE.MeshBasicMaterial({
      color: 0xffaa00,
      transparent: true,
      opacity: 0.82,
    });
    this.nearNvzBar = new THREE.Mesh(lineGeo, this.nvzLineMat);
    this.nearNvzBar.position.set(0, 0.015, COURT_SPECS.NVZ_DEPTH);

    this.farNvzBar = new THREE.Mesh(lineGeo, this.nvzLineMat);
    this.farNvzBar.position.set(0, 0.015, -COURT_SPECS.NVZ_DEPTH);

    this.kitchenGroup.add(
      this.nearKitchenMesh,
      this.farKitchenMesh,
      this.nearNvzBar,
      this.farNvzBar
    );
    this.group.add(this.kitchenGroup);
  }

  buildServiceBoxOverlay() {
    this.serveGroup = new THREE.Group();
    const boxW = COURT_SPECS.HALF_WIDTH - 0.06;
    const boxL = COURT_SPECS.HALF_LENGTH - COURT_SPECS.NVZ_DEPTH - 0.06;

    const fillGeo = new THREE.PlaneGeometry(boxW, boxL);
    fillGeo.rotateX(-Math.PI / 2);
    this.serveBoxMat = new THREE.MeshBasicMaterial({
      color: 0x00f5a0,
      transparent: true,
      opacity: 0.24,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.serveBoxMesh = new THREE.Mesh(fillGeo, this.serveBoxMat);

    // Border outline around target service box
    const edges = new THREE.EdgesGeometry(new THREE.BoxGeometry(boxW, 0.02, boxL));
    this.serveBorder = new THREE.LineSegments(
      edges,
      new THREE.LineBasicMaterial({ color: 0x00ffcc, transparent: true, opacity: 0.9 })
    );
    this.serveBoxMesh.add(this.serveBorder);

    // Underhand Pendulum Serve Arc visual indicator beside server
    const arcCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, 0.55, 0.45),
      new THREE.Vector3(0, 0.38, 0.12),
      new THREE.Vector3(0, 0.58, -0.25),
      new THREE.Vector3(0, 0.96, -0.58),
    ]);
    const arcGeo = new THREE.TubeGeometry(arcCurve, 20, 0.018, 8, false);
    this.underhandArcMesh = new THREE.Mesh(
      arcGeo,
      new THREE.MeshBasicMaterial({ color: 0x00e5ff, transparent: true, opacity: 0.78 })
    );

    this.serveGroup.add(this.serveBoxMesh, this.underhandArcMesh);
    this.group.add(this.serveGroup);
  }

  buildAimAndTrajectoryOverlay() {
    // 1. 3D Target Aim Reticle on Court
    this.aimReticle = new THREE.Group();
    const outerRing = new THREE.Mesh(
      new THREE.RingGeometry(0.28, 0.35, 32).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0x00f0ff, transparent: true, opacity: 0.88, side: THREE.DoubleSide })
    );
    const innerDot = new THREE.Mesh(
      new THREE.CircleGeometry(0.09, 24).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0xffb800, transparent: true, opacity: 0.9, side: THREE.DoubleSide })
    );
    this.aimReticle.add(outerRing, innerDot);
    this.aimReticle.position.set(0, 0.018, -4.2);
    this.group.add(this.aimReticle);

    // 2. Predicted Ballistic Trajectory Line (with Magnus curve & 40-hole drag!)
    const maxPts = 120;
    const positions = new Float32Array(maxPts * 3);
    this.trajGeo = new THREE.BufferGeometry();
    this.trajGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.trajGeo.setDrawRange(0, 0);
    this.trajMat = new THREE.LineBasicMaterial({
      color: 0x38f8ff,
      transparent: true,
      opacity: 0.72,
    });
    this.trajLine = new THREE.Line(this.trajGeo, this.trajMat);
    this.group.add(this.trajLine);

    // 3. Live Ball Flight Ribbon Trail
    const trailMax = 55;
    const trailPos = new Float32Array(trailMax * 3);
    this.trailGeo = new THREE.BufferGeometry();
    this.trailGeo.setAttribute('position', new THREE.BufferAttribute(trailPos, 3));
    this.trailGeo.setDrawRange(0, 0);
    this.trailMat = new THREE.LineBasicMaterial({
      color: 0xd9ff00,
      transparent: true,
      opacity: 0.85,
    });
    this.trailLine = new THREE.Line(this.trailGeo, this.trailMat);
    this.scene.add(this.trailLine);
  }

  buildBounceMarkerPool() {
    this.bounceRingGroup = new THREE.Group();
    this.scene.add(this.bounceRingGroup);
    this.bounceRings = [];
    for (let i = 0; i < 6; i++) {
      const mesh = new THREE.Mesh(
        new THREE.RingGeometry(0.08, 0.15, 24).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({
          color: 0x00ff99,
          transparent: true,
          opacity: 0,
          depthWrite: false,
          side: THREE.DoubleSide,
        })
      );
      mesh.visible = false;
      this.bounceRingGroup.add(mesh);
      this.bounceRings.push(mesh);
    }
  }

  update({
    time,
    rules,
    physics,
    aimTarget,
    humanPlayer,
    previewPoints,
  }) {
    const pulse = 0.5 + 0.5 * Math.sin(time * 5.0);

    // 1. Update Aim Reticle position & scale pulse
    if (aimTarget) {
      this.aimReticle.position.set(aimTarget.x, 0.018, aimTarget.z);
      const s = 1.0 + 0.08 * Math.sin(time * 6.5);
      this.aimReticle.scale.set(s, 1, s);

      // Color reticle red if aiming a serve inside the Kitchen or out of service box!
      if (rules.rallyPhase === 'pre_serve' && rules.servingTeam === 0) {
        const box = rules.getTargetServiceBoxBounds();
        const validServeAim =
          aimTarget.x >= box.minX &&
          aimTarget.x <= box.maxX &&
          aimTarget.z >= box.minZ &&
          aimTarget.z <= box.maxZ;
        this.aimReticle.children[0].material.color.setHex(validServeAim ? 0x00ffaa : 0xff3b3b);
      } else {
        const inCourt =
          Math.abs(aimTarget.x) <= COURT_SPECS.HALF_WIDTH &&
          Math.abs(aimTarget.z) <= COURT_SPECS.HALF_LENGTH;
        this.aimReticle.children[0].material.color.setHex(inCourt ? 0x00f0ff : 0xff3b3b);
      }
    }

    // 2. Update Kitchen (NVZ) Zone Overlay
    const showOverlays = this.showGuides || rules.mode === 'training';
    this.kitchenGroup.visible = showOverlays;
    if (showOverlays) {
      // If ball has bounced on near side, stepping into Kitchen is SAFE (green); otherwise warn against volleying in Kitchen!
      const nearSafeToEnter = physics.inPlay && physics.pos.z > 0 && physics.bounceCountOnCurrentSide >= 1;
      const playerTouchingKitchen =
        humanPlayer && Math.abs(humanPlayer.pos.z) <= COURT_SPECS.NVZ_DEPTH + 0.05;

      if (nearSafeToEnter) {
        this.nearKitchenMat.color.setHex(0x00e676);
        this.nearKitchenMat.opacity = 0.22 + 0.08 * pulse;
        this.nvzLineMat.color.setHex(0x00e676);
      } else if (playerTouchingKitchen) {
        this.nearKitchenMat.color.setHex(0xff1744);
        this.nearKitchenMat.opacity = 0.34 + 0.12 * pulse;
        this.nvzLineMat.color.setHex(0xff1744);
      } else {
        this.nearKitchenMat.color.setHex(0xff6d00);
        this.nearKitchenMat.opacity = 0.14 + 0.05 * pulse;
        this.nvzLineMat.color.setHex(0xffaa00);
      }

      // Highlight Far Kitchen in emerald when practicing Crosscourt Dinks (Lesson 1) or 3rd-Shot Drops (Lesson 3)
      if (rules.mode === 'training' && (rules.trainingIndex === 0 || rules.trainingIndex === 2)) {
        this.farKitchenMat.color.setHex(0x00f5a0);
        this.farKitchenMat.opacity = 0.24 + 0.10 * pulse;
      } else {
        this.farKitchenMat.color.setHex(0xff6d00);
        this.farKitchenMat.opacity = 0.12;
      }
    }

    // 3. Update Legal Diagonal Service Box Overlay during Pre-Serve
    const showServeBox = showOverlays && rules.rallyPhase === 'pre_serve';
    this.serveGroup.visible = showServeBox;
    if (showServeBox) {
      const box = rules.getTargetServiceBoxBounds();
      const cx = (box.minX + box.maxX) * 0.5;
      const cz = (box.minZ + box.maxZ) * 0.5;
      this.serveBoxMesh.position.set(cx, 0.014, cz);
      this.serveBoxMat.opacity = 0.18 + 0.12 * pulse;

      if (humanPlayer && rules.servingTeam === 0) {
        this.underhandArcMesh.visible = true;
        this.underhandArcMesh.position.set(humanPlayer.pos.x + 0.32, 0.0, humanPlayer.pos.z);
      } else {
        this.underhandArcMesh.visible = false;
      }
    }

    // 4. Update Predicted Trajectory Preview Curve
    if (showOverlays && previewPoints && previewPoints.length > 1) {
      this.trajLine.visible = true;
      const posAttr = this.trajGeo.attributes.position;
      const count = Math.min(previewPoints.length, posAttr.count);
      for (let i = 0; i < count; i++) {
        posAttr.setXYZ(i, previewPoints[i].x, previewPoints[i].y, previewPoints[i].z);
      }
      posAttr.needsUpdate = true;
      this.trajGeo.setDrawRange(0, count);
    } else {
      this.trajLine.visible = false;
    }

    // 5. Update Ball Flight Trail
    const trail = physics.trail;
    if (physics.inPlay && trail.length > 1) {
      this.trailLine.visible = true;
      const posAttr = this.trailGeo.attributes.position;
      const count = Math.min(trail.length, posAttr.count);
      for (let i = 0; i < count; i++) {
        posAttr.setXYZ(i, trail[i].x, trail[i].y, trail[i].z);
      }
      posAttr.needsUpdate = true;
      this.trailGeo.setDrawRange(0, count);
    } else {
      this.trailLine.visible = false;
    }

    // 6. Update Bounce Impact Rings
    const nowPerf = performance.now();
    for (let i = 0; i < this.bounceRings.length; i++) {
      const ring = this.bounceRings[i];
      const marker = physics.bounceMarkers[physics.bounceMarkers.length - 1 - i];
      if (!marker) {
        ring.visible = false;
        continue;
      }
      const age = (nowPerf - marker.time) / 1000;
      if (age > 2.2) {
        ring.visible = false;
        continue;
      }
      ring.visible = true;
      ring.position.set(marker.pos.x, 0.016, marker.pos.z);
      const scale = 1.0 + age * 2.2;
      ring.scale.set(scale, 1, scale);
      ring.material.color.setHex(marker.inBounds ? 0x00ff99 : 0xff2a55);
      ring.material.opacity = Math.max(0, (1 - age / 2.2) * 0.85);
    }
  }
}
