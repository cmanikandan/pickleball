import * as THREE from 'three';
import { COURT_SPECS } from '../physics/PickleballPhysics.js';

/**
 * Hawkeye / ESPN Broadcast Augmented Reality (AR) 3D Court Overlays:
 * - Non-Volley Zone ("The Kitchen") precision laser perimeter & state-reactive tint
 * - Legal Diagonal Service Box AR boundary + Underhand Serve Pendulum Arc
 * - Real-time 3D Hawkeye Target Reticle, Ballistic Trajectory Arc, and Bounce Spot Rings
 */
export class CourtOverlays {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.group.name = 'CourtTutorialOverlays';
    this.scene.add(this.group);

    this.showGuides = false;

    this.buildKitchenOverlay();
    this.buildServiceBoxOverlay();
    this.buildAimAndTrajectoryOverlay();
    this.buildBounceMarkerPool();
  }

  buildKitchenOverlay() {
    this.kitchenGroup = new THREE.Group();
    const w = COURT_SPECS.WIDTH - 0.08;
    const d = COURT_SPECS.NVZ_DEPTH - 0.06;
    const geo = new THREE.PlaneGeometry(w, d);
    geo.rotateX(-Math.PI / 2);

    this.nearKitchenMat = new THREE.MeshBasicMaterial({
      color: 0xf59e0b,
      transparent: true,
      opacity: 0.05,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.farKitchenMat = new THREE.MeshBasicMaterial({
      color: 0xf59e0b,
      transparent: true,
      opacity: 0.04,
      depthWrite: false,
      side: THREE.DoubleSide,
    });

    this.nearKitchenMesh = new THREE.Mesh(geo, this.nearKitchenMat);
    this.nearKitchenMesh.position.set(0, 0.008, COURT_SPECS.NVZ_DEPTH * 0.5);

    this.farKitchenMesh = new THREE.Mesh(geo, this.farKitchenMat);
    this.farKitchenMesh.position.set(0, 0.008, -COURT_SPECS.NVZ_DEPTH * 0.5);

    // Sleek Broadcast AR NVZ Indicator Strip at z = ±2.1336m
    const lineGeo = new THREE.PlaneGeometry(COURT_SPECS.WIDTH - 0.04, 0.045);
    lineGeo.rotateX(-Math.PI / 2);
    this.nvzLineMat = new THREE.MeshBasicMaterial({
      color: 0xfacc15,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
    });
    this.nearNvzBar = new THREE.Mesh(lineGeo, this.nvzLineMat);
    this.nearNvzBar.position.set(0, 0.011, COURT_SPECS.NVZ_DEPTH);

    this.farNvzBar = new THREE.Mesh(lineGeo, this.nvzLineMat);
    this.farNvzBar.position.set(0, 0.011, -COURT_SPECS.NVZ_DEPTH);

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
      color: 0x10b981,
      transparent: true,
      opacity: 0.14,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.serveBoxMesh = new THREE.Mesh(fillGeo, this.serveBoxMat);

    const edges = new THREE.EdgesGeometry(new THREE.BoxGeometry(boxW, 0.012, boxL));
    this.serveBorder = new THREE.LineSegments(
      edges,
      new THREE.LineBasicMaterial({ color: 0x34d399, transparent: true, opacity: 0.78 })
    );
    this.serveBoxMesh.add(this.serveBorder);

    const arcCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, 0.55, 0.45),
      new THREE.Vector3(0, 0.38, 0.12),
      new THREE.Vector3(0, 0.58, -0.25),
      new THREE.Vector3(0, 0.96, -0.58),
    ]);
    const arcGeo = new THREE.TubeGeometry(arcCurve, 20, 0.014, 8, false);
    this.underhandArcMesh = new THREE.Mesh(
      arcGeo,
      new THREE.MeshBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.68 })
    );

    this.serveGroup.add(this.serveBoxMesh, this.underhandArcMesh);
    this.group.add(this.serveGroup);
  }

  buildAimAndTrajectoryOverlay() {
    // 1. Sleek Hawkeye Spot Target Reticle on Court
    this.aimReticle = new THREE.Group();
    const outerRing = new THREE.Mesh(
      new THREE.RingGeometry(0.24, 0.29, 40).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({
        color: 0x38bdf8,
        transparent: true,
        opacity: 0.85,
        depthWrite: false,
        side: THREE.DoubleSide,
      })
    );
    const innerRing = new THREE.Mesh(
      new THREE.RingGeometry(0.11, 0.135, 32).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.75,
        depthWrite: false,
        side: THREE.DoubleSide,
      })
    );
    const innerDot = new THREE.Mesh(
      new THREE.CircleGeometry(0.055, 24).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({
        color: 0xfacc15,
        transparent: true,
        opacity: 0.92,
        depthWrite: false,
        side: THREE.DoubleSide,
      })
    );
    this.aimReticle.add(outerRing, innerRing, innerDot);
    this.aimReticle.position.set(0, 0.014, -4.2);
    this.group.add(this.aimReticle);

    // 2. Predicted Ballistic Trajectory Line
    const maxPts = 120;
    const positions = new Float32Array(maxPts * 3);
    this.trajGeo = new THREE.BufferGeometry();
    this.trajGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.trajGeo.setDrawRange(0, 0);
    this.trajMat = new THREE.LineBasicMaterial({
      color: 0x7dd3fc,
      transparent: true,
      opacity: 0.62,
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
      color: 0xfef08a,
      transparent: true,
      opacity: 0.78,
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
        new THREE.RingGeometry(0.07, 0.13, 28).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({
          color: 0x10b981,
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
    showcaseFreeze = false,
  }) {
    const pulse = 0.5 + 0.5 * Math.sin(time * 4.5);
    const showOverlays = !showcaseFreeze && (this.showGuides || rules.mode === 'training');

    this.aimReticle.visible = showOverlays && Boolean(aimTarget);
    if (showOverlays && aimTarget) {
      this.aimReticle.position.set(aimTarget.x, 0.014, aimTarget.z);
      const s = 1.0 + 0.05 * Math.sin(time * 5.5);
      this.aimReticle.scale.set(s, 1, s);

      if (rules.rallyPhase === 'pre_serve' && rules.servingTeam === 0) {
        const box = rules.getTargetServiceBoxBounds();
        const validServeAim =
          aimTarget.x >= box.minX &&
          aimTarget.x <= box.maxX &&
          aimTarget.z >= box.minZ &&
          aimTarget.z <= box.maxZ;
        this.aimReticle.children[0].material.color.setHex(validServeAim ? 0x34d399 : 0xef4444);
      } else {
        const inCourt =
          Math.abs(aimTarget.x) <= COURT_SPECS.HALF_WIDTH &&
          Math.abs(aimTarget.z) <= COURT_SPECS.HALF_LENGTH;
        this.aimReticle.children[0].material.color.setHex(inCourt ? 0x38bdf8 : 0xef4444);
      }
    }

    this.kitchenGroup.visible = showOverlays;
    if (showOverlays) {
      const nearSafeToEnter =
        physics.inPlay && physics.pos.z > 0 && physics.bounceCountOnCurrentSide >= 1;
      const playerTouchingKitchen =
        humanPlayer && Math.abs(humanPlayer.pos.z) <= COURT_SPECS.NVZ_DEPTH + 0.05;

      if (nearSafeToEnter) {
        this.nearKitchenMat.color.setHex(0x10b981);
        this.nearKitchenMat.opacity = 0.12 + 0.05 * pulse;
        this.nvzLineMat.color.setHex(0x10b981);
      } else if (playerTouchingKitchen) {
        this.nearKitchenMat.color.setHex(0xef4444);
        this.nearKitchenMat.opacity = 0.22 + 0.08 * pulse;
        this.nvzLineMat.color.setHex(0xef4444);
      } else {
        this.nearKitchenMat.color.setHex(0xf59e0b);
        this.nearKitchenMat.opacity = 0.03;
        this.nvzLineMat.color.setHex(0xfacc15);
      }

      if (rules.mode === 'training' && (rules.trainingIndex === 0 || rules.trainingIndex === 2)) {
        this.farKitchenMat.color.setHex(0x10b981);
        this.farKitchenMat.opacity = 0.14 + 0.06 * pulse;
      } else {
        this.farKitchenMat.color.setHex(0xf59e0b);
        this.farKitchenMat.opacity = 0.025;
      }
    }

    const showServeBox = showOverlays && rules.rallyPhase === 'pre_serve';
    this.serveGroup.visible = showServeBox;
    if (showServeBox) {
      const box = rules.getTargetServiceBoxBounds();
      const cx = (box.minX + box.maxX) * 0.5;
      const cz = (box.minZ + box.maxZ) * 0.5;
      this.serveBoxMesh.position.set(cx, 0.012, cz);
      this.serveBoxMat.opacity = 0.11 + 0.07 * pulse;

      if (humanPlayer && rules.servingTeam === 0) {
        this.underhandArcMesh.visible = true;
        this.underhandArcMesh.position.set(humanPlayer.pos.x + 0.32, 0.0, humanPlayer.pos.z);
      } else {
        this.underhandArcMesh.visible = false;
      }
    }

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
      ring.position.set(marker.pos.x, 0.015, marker.pos.z);
      const scale = 1.0 + age * 2.0;
      ring.scale.set(scale, 1, scale);
      ring.material.color.setHex(marker.inBounds ? 0x10b981 : 0xef4444);
      ring.material.opacity = Math.max(0, (1 - age / 2.2) * 0.85);
    }
  }
}
