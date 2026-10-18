import * as THREE from 'three';

/**
 * USAPA Official Court & 40-Hole Outdoor Pickleball Constants (SI Units: meters, kg, seconds, radians)
 * Coordinate System (Three.js Y-Up):
 *   X: Lateral court width [-3.048m, +3.048m] (20 feet total)
 *   Y: Vertical height above court surface (0m = court floor)
 *   Z: Longitudinal court length [-6.7056m, +6.7056m] (44 feet total)
 *      Near Side (Team 0 / Player): z in [0, +6.7056m]
 *      Far Side  (Team 1 / AI Opp): z in [-6.7056m, 0]
 */
export const COURT_SPECS = {
  WIDTH: 6.096,               // 20 ft
  LENGTH: 13.4112,            // 44 ft
  HALF_WIDTH: 3.048,          // 10 ft
  HALF_LENGTH: 6.7056,        // 22 ft
  NVZ_DEPTH: 2.1336,          // 7 ft Non-Volley Zone ("The Kitchen") from net
  LINE_WIDTH: 0.0508,         // 2 inches
  NET_POST_X: 3.3528,         // 11 ft (1 ft outside sideline)
  NET_HEIGHT_POST: 0.9144,    // 36 inches at sidelines/posts
  NET_HEIGHT_CENTER: 0.8636,  // 34 inches at center strap
  APRON_HALF_W: 4.572,        // 15 ft
  APRON_HALF_L: 9.144,        // 30 ft
};

export const BALL_SPECS = {
  MASS: 0.026,                // 26.0 grams (USAPA standard outdoor ball)
  RADIUS: 0.03683,            // 73.66 mm diameter -> 36.83 mm radius
  HOLES: 40,                  // 40 precision-drilled circular holes (outdoor spec)
  AREA: Math.PI * 0.03683 * 0.03683, // ~0.004261 m^2
  INERTIA: (2 / 3) * 0.026 * 0.03683 * 0.03683, // Thin-walled perforated polymer shell
  AIR_DENSITY: 1.225,         // kg/m^3 at sea level
  GRAVITY: 9.80665,           // m/s^2
  BASE_CD: 0.505,             // Elevated drag coefficient due to 40-hole porosity & internal wake
  COURT_COR: 0.79,            // USAPA bounce restitution (30-34 inch rebound from 78 inch drop)
  COURT_FRICTION: 0.34,       // Silica-sand acrylic court friction coefficient
  SPIN_DECAY_RATE: 0.28,      // Aerodynamic angular spin decay (1/s)
};

/**
 * Returns the exact USAPA net top height at lateral coordinate x (meters),
 * accounting for the physical 36-inch post height sagging parabolically to 34 inches at center.
 */
export function getNetHeightAtX(x) {
  const normX = Math.min(1.1, Math.abs(x) / COURT_SPECS.HALF_WIDTH);
  return (
    COURT_SPECS.NET_HEIGHT_CENTER +
    (COURT_SPECS.NET_HEIGHT_POST - COURT_SPECS.NET_HEIGHT_CENTER) * (normX * normX)
  );
}

/**
 * Shot Archetype Presets for both Interactive Learning & Advanced Shot Shaping
 */
export const SHOT_ARCHETYPES = {
  serve: {
    id: 'serve',
    label: 'Underhand Serve',
    anim: 'Serve_Underhand',
    pitchDeg: 22,       // Open upward pendulum face
    brushDeg: 24,       // Low-to-high topspin lift for deep clearance
    baseSpeed: 14.8,
    topspinRpm: 950,
    sidespinRpm: 0,
    cor: 0.58,
    arcBoost: 1.0,
  },
  dink: {
    id: 'dink',
    label: 'Crosscourt Dink',
    anim: 'Dink_Crosscourt',
    pitchDeg: 32,       // Soft open paddle face at NVZ line
    brushDeg: 10,       // Gentle lift & absorb
    baseSpeed: 6.9,
    topspinRpm: 320,
    sidespinRpm: 180,
    cor: 0.44,          // Polypropylene honeycomb energy absorption
    arcBoost: 0.85,
  },
  drop: {
    id: 'drop',
    label: '3rd-Shot Drop',
    anim: 'ThirdShot_Drop',
    pitchDeg: 27,       // Measured loft from baseline into the Kitchen
    brushDeg: 22,       // Topspin-slice hybrid control
    baseSpeed: 10.6,
    topspinRpm: 780,
    sidespinRpm: 120,
    cor: 0.48,
    arcBoost: 1.15,
  },
  drive: {
    id: 'drive',
    label: 'Topspin Drive',
    anim: 'ThirdShot_Drop',
    pitchDeg: 9,        // Low aggressive launch angle
    brushDeg: 34,       // Heavy low-to-high carbon-fiber brush
    baseSpeed: 18.6,
    topspinRpm: 1850,   // Strong Magnus dip over the net
    sidespinRpm: 0,
    cor: 0.62,
    arcBoost: 0.72,
  },
  slice: {
    id: 'slice',
    label: 'Backspin Slice',
    anim: 'Dink_Crosscourt',
    pitchDeg: 24,       // Open face bevel
    brushDeg: -28,      // High-to-low cutting brush
    baseSpeed: 12.8,
    topspinRpm: -1350,  // Backspin Magnus lift + low skidding bounce
    sidespinRpm: 260,
    cor: 0.52,
    arcBoost: 0.82,
  },
  volley: {
    id: 'volley',
    label: 'Kitchen Punch Volley',
    anim: 'Volley_Kitchen',
    pitchDeg: 8,        // Compact firm punch face
    brushDeg: -6,       // Crisp punch with slight underspin stability
    baseSpeed: 15.8,
    topspinRpm: -250,
    sidespinRpm: 0,
    cor: 0.60,
    arcBoost: 0.65,
  },
  smash: {
    id: 'smash',
    label: 'Overhead Smash',
    anim: 'Smash_Overhead',
    pitchDeg: -14,      // Downward closed-face angle from high contact point
    brushDeg: 18,       // Pronated wrist snap
    baseSpeed: 22.4,
    topspinRpm: 1400,
    sidespinRpm: 220,
    cor: 0.66,
    arcBoost: 0.35,
  },
  lob: {
    id: 'lob',
    label: 'Offensive Topspin Lob',
    anim: 'ThirdShot_Drop',
    pitchDeg: 44,       // High lofted face angle
    brushDeg: 26,
    baseSpeed: 13.4,
    topspinRpm: 920,
    sidespinRpm: 0,
    cor: 0.56,
    arcBoost: 1.85,
  },
};

export class PickleballPhysics {
  constructor() {
    this.pos = new THREE.Vector3(0, 0.9, 5.8);
    this.vel = new THREE.Vector3(0, 0, 0);
    // Angular velocity vector omega (rad/s) in world axes:
    // For shot traveling toward -Z: omega.x < 0 is Topspin, omega.x > 0 is Backspin/Slice, omega.y != 0 is Sidespin
    this.omega = new THREE.Vector3(0, 0, 0);
    this.wind = new THREE.Vector3(0, 0, 0); // Outdoor wind vector (m/s)
    this.orientationQuat = new THREE.Quaternion();
    this.holePhase = 0;

    this.inPlay = false;
    this.bounceCountTotal = 0;
    this.bounceCountOnCurrentSide = 0;
    this.lastHitterTeam = 0;
    this.lastHitterId = null;
    this.lastShotType = 'serve';
    this.lastStrikeTelemetry = {
      speedMph: 0,
      speedKmh: 0,
      spinRpm: 0,
      spinType: 'Flat',
      launchAngleDeg: 0,
      facePitchDeg: 0,
      faceYawDeg: 0,
      brushAngleDeg: 0,
      netClearanceCm: 0,
      sweetSpotFactor: 1.0,
    };

    // Trail history for 3D ribbon visualization
    this.trail = [];
    this.maxTrailLength = 55;
    this.bounceMarkers = [];
  }

  resetBallAtPlayer(playerPos, team = 0) {
    const dirZ = team === 0 ? -1 : 1;
    this.pos.set(playerPos.x + (team === 0 ? 0.22 : -0.22), 0.72, playerPos.z + dirZ * 0.32);
    this.vel.set(0, 0, 0);
    this.omega.set(0, 0, 0);
    this.inPlay = false;
    this.bounceCountTotal = 0;
    this.bounceCountOnCurrentSide = 0;
    this.trail.length = 0;
  }

  /**
   * Computes aerodynamic acceleration (Gravity + 40-Hole Drag + Magnus Spin Lift)
   */
  computeAcceleration(vel, omega, wind, holePhase = 0) {
    const vRel = new THREE.Vector3().subVectors(vel, wind);
    const speed = vRel.length();
    const acc = new THREE.Vector3(0, -BALL_SPECS.GRAVITY, 0);

    if (speed < 0.05) return acc;

    // 1. 40-Hole Perforated Aerodynamic Drag Force:
    // Reynolds number Re = v * D / nu
    const Re = (speed * (BALL_SPECS.RADIUS * 2)) / 1.5e-5;
    // 40-hole boundary layer trip + subtle hole-lattice orientation ripple
    const holeRipple = 0.012 * Math.sin(holePhase * 8.0);
    const Cd = BALL_SPECS.BASE_CD + 0.055 * Math.exp(-Re / 75000) + holeRipple;
    const dynPressure = 0.5 * BALL_SPECS.AIR_DENSITY * BALL_SPECS.AREA * speed;
    const dragFactor = (dynPressure * Cd) / BALL_SPECS.MASS;

    acc.x -= dragFactor * vRel.x;
    acc.y -= dragFactor * vRel.y;
    acc.z -= dragFactor * vRel.z;

    // 2. Magnus Effect (Spin-Induced Aerodynamic Lift / Curve):
    // F_M = 0.5 * rho * A * C_L(S) * |v_rel| * (omega_hat x v_rel)
    const omegaMag = omega.length();
    if (omegaMag > 0.5) {
      const spinRatio = (BALL_SPECS.RADIUS * omegaMag) / speed;
      // Perforated 40-hole pickleball Magnus lift curve
      const Cl = Math.min(0.38, (0.54 * spinRatio) / (1.0 + 0.85 * spinRatio));
      const cross = new THREE.Vector3().crossVectors(omega, vRel).divideScalar(omegaMag);
      const magnusFactor = (dynPressure * Cl) / BALL_SPECS.MASS;
      acc.addScaledVector(cross, magnusFactor);
    }

    return acc;
  }

  /**
   * Explicit 3D Paddle Face Contact Angle & Ballistic Strike Solver.
   * Combines target aiming with explicit paddle face pitch (open/closed), yaw (crosscourt angle),
   * and swing brush angle (topspin/slice) so advanced players can shape shots realistically.
   */
  executePaddleStrike({
    origin,
    target,
    shotType = 'drive',
    team = 0,
    playerId = 'p0',
    power = 0.78,            // [0.2 .. 1.0]
    userPitchOffsetDeg = 0,  // Explicit paddle face tilt adjustment (-15 to +15 deg)
    userYawOffsetDeg = 0,    // Explicit paddle face yaw adjustment (-25 to +25 deg)
    userBrushOffsetDeg = 0,  // Explicit topspin/slice brush adjustment (-25 to +25 deg)
    sweetSpotFactor = 0.96,  // [0.65 .. 1.0] based on player positioning distance to ball
  }) {
    const spec = SHOT_ARCHETYPES[shotType] || SHOT_ARCHETYPES.drive;
    const dirSign = team === 0 ? -1 : 1; // Team 0 hits toward -Z, Team 1 hits toward +Z

    // Apply explicit paddle face yaw offset to target X
    const dxRaw = target.x - origin.x;
    const dzRaw = target.z - origin.z;
    const horizDist = Math.max(1.5, Math.hypot(dxRaw, dzRaw));
    const yawRad = THREE.MathUtils.degToRad(userYawOffsetDeg);
    const cosY = Math.cos(yawRad);
    const sinY = Math.sin(yawRad);
    const dx = dxRaw * cosY - dzRaw * sinY;
    const dz = dxRaw * sinY + dzRaw * cosY;

    const effectiveTarget = new THREE.Vector3(origin.x + dx, 0.03683, origin.z + dz);

    // Compute total spin from preset + userBrushOffsetDeg + userPitchOffsetDeg
    const brushDeg = spec.brushDeg + userBrushOffsetDeg;
    const facePitchDeg = spec.pitchDeg + userPitchOffsetDeg;
    const topspinRpm =
      spec.topspinRpm +
      userBrushOffsetDeg * 52.0 -
      userPitchOffsetDeg * 18.0;
    const sidespinRpm =
      spec.sidespinRpm +
      userYawOffsetDeg * 28.0 +
      (dx / Math.max(2.0, horizDist)) * 240.0;

    // Convert RPM to rad/s
    const topspinRad = (topspinRpm * Math.PI * 2) / 60;
    const sidespinRad = (sidespinRpm * Math.PI * 2) / 60;

    // Direction of flight horizontal unit vector
    const dirHoriz = new THREE.Vector3(dx, 0, dz).normalize();
    // Perpendicular right vector in XZ plane: (dirHoriz x +Y)
    // Wait: for Topspin, we want (omega x v) to point in -Y (downward).
    // Since (axis x dirHoriz) = -Y when axis = (dirHoriz x +Y) = (dz, 0, -dx),
    // setting omega = axis * topspinRad guarantees (omega x v) points strictly downward (-Y) for positive topspinRad!
    const topspinAxis = new THREE.Vector3(dirHoriz.z, 0, -dirHoriz.x).normalize();
    const omegaVec = new THREE.Vector3()
      .addScaledVector(topspinAxis, topspinRad)
      .add(new THREE.Vector3(0, sidespinRad, 0));

    // Solve ballistic flight time T so the ball clears the 34-36" net and lands at effectiveTarget
    // factoring in aerodynamic drag and Magnus downward/upward force!
    const powerScale = 0.78 + (power - 0.5) * 0.48;
    const pitchArcMod = Math.max(0.45, 1.0 + userPitchOffsetDeg * 0.028);

    // Desired flight duration based on distance, shot archetype arc, and explicit paddle face pitch
    let flightTime =
      (horizDist / (spec.baseSpeed * powerScale * sweetSpotFactor)) *
      1.18 *
      Math.sqrt(spec.arcBoost * pitchArcMod);
    flightTime = THREE.MathUtils.clamp(flightTime, 0.36, 1.65);

    // Iterative shooting solver (3-step Newton correction with full 40-hole drag + Magnus integration)
    // to find exact launch velocity v0 that lands at effectiveTarget in flightTime AND clears the net!
    let vx = dx / flightTime;
    let vz = dz / flightTime;
    let vy = (0.03683 - origin.y + 0.5 * BALL_SPECS.GRAVITY * flightTime * flightTime) / flightTime;

    for (let iter = 0; iter < 4; iter++) {
      const sim = this.simulateArc(origin, new THREE.Vector3(vx, vy, vz), omegaVec, flightTime);
      const errX = effectiveTarget.x - sim.endPos.x;
      const errY = 0.03683 - sim.endPos.y;
      const errZ = effectiveTarget.z - sim.endPos.z;
      vx += errX / flightTime;
      vy += errY / flightTime;
      vz += errZ / flightTime;

      // Ensure safe net clearance unless player intentionally closed the paddle face too low
      const netH = getNetHeightAtX(sim.netCrossX);
      const minDesiredNetY =
        userPitchOffsetDeg < -8
          ? netH + 0.02
          : shotType === 'dink' || shotType === 'drive' || shotType === 'volley'
          ? netH + 0.14
          : shotType === 'drop' || shotType === 'serve'
          ? netH + 0.32
          : shotType === 'lob'
          ? netH + 1.45
          : netH + 0.22;

      if (sim.netCrossY !== null && sim.netCrossY < minDesiredNetY && userPitchOffsetDeg >= -8) {
        const liftNeeded = (minDesiredNetY - sim.netCrossY) * 2.1;
        vy += liftNeeded;
        flightTime *= 1.04;
      }
    }

    this.pos.copy(origin);
    this.vel.set(vx, vy, vz);
    this.omega.copy(omegaVec);
    this.inPlay = true;
    this.bounceCountOnCurrentSide = 0;
    this.lastHitterTeam = team;
    this.lastHitterId = playerId;
    this.lastShotType = shotType;
    this.trail = [this.pos.clone()];

    // Measure net clearance from final launch vector
    const finalSim = this.simulateArc(this.pos, this.vel, this.omega, flightTime * 1.15);
    const speedMps = this.vel.length();
    const launchAngleDeg = THREE.MathUtils.radToDeg(
      Math.atan2(this.vel.y, Math.hypot(this.vel.x, this.vel.z))
    );
    const netClearanceM =
      finalSim.netCrossY !== null
        ? finalSim.netCrossY - getNetHeightAtX(finalSim.netCrossX)
        : 0.25;

    let spinLabel = 'Flat';
    if (topspinRpm > 450) spinLabel = 'Topspin';
    else if (topspinRpm < -450) spinLabel = 'Backspin Slice';
    else if (Math.abs(sidespinRpm) > 300) spinLabel = 'Corkscrew Sidespin';
    else if (shotType === 'dink') spinLabel = 'Soft Touch Dink';

    this.lastStrikeTelemetry = {
      shotLabel: spec.label,
      speedMps: Number(speedMps.toFixed(1)),
      speedMph: Math.round(speedMps * 2.23694),
      speedKmh: Math.round(speedMps * 3.6),
      spinRpm: Math.round(Math.hypot(topspinRpm, sidespinRpm)),
      topspinRpm: Math.round(topspinRpm),
      sidespinRpm: Math.round(sidespinRpm),
      spinType: spinLabel,
      launchAngleDeg: Number(launchAngleDeg.toFixed(1)),
      facePitchDeg: Number(facePitchDeg.toFixed(1)),
      faceYawDeg: Number(userYawOffsetDeg.toFixed(1)),
      brushAngleDeg: Number(brushDeg.toFixed(1)),
      netClearanceCm: Math.round(netClearanceM * 100),
      sweetSpotFactor: Number(sweetSpotFactor.toFixed(2)),
      predictedBounce: finalSim.bouncePos || effectiveTarget.clone(),
    };

    return this.lastStrikeTelemetry;
  }

  /**
   * Simulates the aerodynamic trajectory forward for durationSec (used by solver & 3D Tutorial Predictor)
   */
  simulateArc(startPos, startVel, startOmega, durationSec = 1.6, recordPoints = false) {
    const dt = 1 / 120;
    const steps = Math.ceil(durationSec / dt);
    const p = startPos.clone();
    const v = startVel.clone();
    const w = startOmega.clone();
    let netCrossY = null;
    let netCrossX = 0;
    let bouncePos = null;
    const points = recordPoints ? [p.clone()] : null;

    for (let i = 0; i < steps; i++) {
      const prevZ = p.z;
      const prevY = p.y;
      const prevX = p.x;

      const acc = this.computeAcceleration(v, w, this.wind, i * 0.15);
      v.addScaledVector(acc, dt);
      p.addScaledVector(v, dt);
      w.multiplyScalar(Math.max(0, 1 - BALL_SPECS.SPIN_DECAY_RATE * dt));

      if ( (prevZ > 0 && p.z <= 0) || (prevZ < 0 && p.z >= 0) ) {
        const frac = Math.abs(prevZ) / (Math.abs(prevZ - p.z) + 1e-6);
        netCrossY = prevY + frac * (p.y - prevY);
        netCrossX = prevX + frac * (p.x - prevX);
      }

      if (p.y <= BALL_SPECS.RADIUS && !bouncePos && i > 3) {
        bouncePos = new THREE.Vector3(p.x, BALL_SPECS.RADIUS, p.z);
        if (!recordPoints) break;
        // Simulate one post-bounce hop for visual trajectory preview
        p.y = BALL_SPECS.RADIUS;
        v.y = Math.abs(v.y) * BALL_SPECS.COURT_COR;
        const dirH = new THREE.Vector3(v.x, 0, v.z).normalize();
        const topAxis = new THREE.Vector3(dirH.z, 0, -dirH.x);
        const topSpinVal = w.dot(topAxis);
        v.addScaledVector(dirH, topSpinVal * 0.009);
      }

      if (recordPoints && i % 2 === 0) {
        points.push(p.clone());
      }
    }

    return {
      endPos: p,
      netCrossY,
      netCrossX,
      bouncePos,
      points,
    };
  }

  /**
   * Advances the real-time physics simulation by delta seconds using 240Hz sub-stepping.
   * Returns a list of physics events ({ type: 'bounce' | 'net_cord' | 'net_fault', pos, side, inBounds, ... })
   */
  step(dt) {
    const events = [];
    if (!this.inPlay) return events;

    const clampedDt = Math.min(dt, 0.05);
    const subSteps = 6;
    const subDt = clampedDt / subSteps;

    for (let s = 0; s < subSteps; s++) {
      const prevPos = this.pos.clone();

      // Integrate velocity and position
      const acc = this.computeAcceleration(this.vel, this.omega, this.wind, this.holePhase);
      this.vel.addScaledVector(acc, subDt);
      this.pos.addScaledVector(this.vel, subDt);

      // Integrate angular spin decay and 3D ball visual rotation
      this.omega.multiplyScalar(Math.max(0, 1 - BALL_SPECS.SPIN_DECAY_RATE * subDt));
      const omegaLen = this.omega.length();
      if (omegaLen > 0.01) {
        const dq = new THREE.Quaternion().setFromAxisAngle(
          this.omega.clone().normalize(),
          omegaLen * subDt
        );
        this.orientationQuat.premultiply(dq).normalize();
      }
      this.holePhase += omegaLen * subDt;

      // 1. Check Net Plane Crossing (z = 0)
      if ((prevPos.z > 0 && this.pos.z <= 0) || (prevPos.z < 0 && this.pos.z >= 0)) {
        const frac = Math.abs(prevPos.z) / (Math.abs(prevPos.z - this.pos.z) + 1e-6);
        const crossX = prevPos.x + frac * (this.pos.x - prevPos.x);
        const crossY = prevPos.y + frac * (this.pos.y - prevPos.y);

        if (Math.abs(crossX) <= COURT_SPECS.NET_POST_X) {
          const netTopY = getNetHeightAtX(crossX);
          if (crossY <= netTopY + BALL_SPECS.RADIUS) {
            // Did it clip the top white vinyl tape (Net Cord Roll) or hit into the net mesh?
            if (crossY >= netTopY - 0.018) {
              // Net Cord Clip! Deflects upward & slows down while continuing over net
              this.vel.z *= 0.52;
              this.vel.y = Math.max(1.8, Math.abs(this.vel.y) * 0.45 + 1.5);
              this.omega.multiplyScalar(0.5);
              this.bounceCountOnCurrentSide = 0;
              events.push({
                type: 'net_cord',
                pos: new THREE.Vector3(crossX, netTopY, 0),
              });
            } else {
              // Hit into the net mesh -> deadens & drops straight down
              this.pos.z = prevPos.z > 0 ? 0.045 : -0.045;
              this.vel.z = -this.vel.z * 0.18;
              this.vel.x *= 0.4;
              this.vel.y *= 0.25;
              this.omega.multiplyScalar(0.2);
              events.push({
                type: 'net_fault',
                pos: new THREE.Vector3(crossX, crossY, 0),
                hitterTeam: this.lastHitterTeam,
              });
            }
          } else {
            // Cleanly crossed the net to the opposing side! Reset side bounce counter
            this.bounceCountOnCurrentSide = 0;
          }
        }
      }

      // 2. Check Court Floor Bounce (y <= BALL_SPECS.RADIUS)
      if (this.pos.y <= BALL_SPECS.RADIUS && this.vel.y < 0) {
        this.pos.y = BALL_SPECS.RADIUS;
        const impactSpeedY = Math.abs(this.vel.y);
        this.vel.y = impactSpeedY * BALL_SPECS.COURT_COR;

        // Spin-to-Surface Friction Coupling:
        // Topspin accelerates forward and kicks lower; Backspin/Slice checks up (decelerates forward);
        // Sidespin kicks laterally!
        const horizSpeed = Math.hypot(this.vel.x, this.vel.z);
        if (horizSpeed > 0.1) {
          const dirH = new THREE.Vector3(this.vel.x, 0, this.vel.z).normalize();
          const rightH = new THREE.Vector3(dirH.z, 0, -dirH.x);
          const topspinComp = this.omega.dot(rightH); // > 0 for topspin, < 0 for backspin
          const sidespinComp = this.omega.y;

          // Apply tangential friction impulse
          this.vel.x *= 0.84;
          this.vel.z *= 0.84;
          this.vel.addScaledVector(dirH, topspinComp * 0.011);
          this.vel.addScaledVector(rightH, -sidespinComp * 0.006);

          // Topspin lowers bounce angle slightly; heavy backspin pops up slightly
          if (topspinComp > 30) {
            this.vel.y *= 0.92;
          } else if (topspinComp < -30) {
            this.vel.y *= 1.06;
          }

          // Update spin after surface grip
          this.omega.multiplyScalar(0.68);
        }

        this.bounceCountTotal += 1;
        this.bounceCountOnCurrentSide += 1;

        const bounceSide = this.pos.z >= 0 ? 0 : 1; // 0 = Near court, 1 = Far court
        const inBoundsCourt =
          Math.abs(this.pos.x) <= COURT_SPECS.HALF_WIDTH + BALL_SPECS.RADIUS * 0.65 &&
          Math.abs(this.pos.z) <= COURT_SPECS.HALF_LENGTH + BALL_SPECS.RADIUS * 0.65;
        const inKitchen =
          inBoundsCourt &&
          Math.abs(this.pos.z) <= COURT_SPECS.NVZ_DEPTH + BALL_SPECS.RADIUS * 0.35;

        const bounceEvent = {
          type: 'bounce',
          pos: this.pos.clone(),
          side: bounceSide,
          bounceNumberOnSide: this.bounceCountOnCurrentSide,
          bounceNumberTotal: this.bounceCountTotal,
          inBounds: inBoundsCourt,
          inKitchen,
          impactSpeed: impactSpeedY,
          hitterTeam: this.lastHitterTeam,
        };
        events.push(bounceEvent);

        this.bounceMarkers.push({
          pos: this.pos.clone(),
          inBounds: inBoundsCourt,
          inKitchen,
          time: performance.now(),
        });
        if (this.bounceMarkers.length > 8) this.bounceMarkers.shift();
      }
    }

    // Record trail point
    this.trail.push(this.pos.clone());
    if (this.trail.length > this.maxTrailLength) {
      this.trail.shift();
    }

    return events;
  }
}
