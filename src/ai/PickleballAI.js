import * as THREE from 'three';
import { COURT_SPECS } from '../physics/PickleballPhysics.js';

/**
 * State-Driven Multi-Agent AI Controller for Singles (1v1), Doubles (2v2 Teammate + Opponents),
 * and Interactive Training Coach.
 */
export class PickleballAI {
  constructor() {
    this.difficulty = 'pro'; // 'club' | 'pro' | 'championship'
    this.aiServeTimer = 0;
  }

  getDifficultyParams() {
    if (this.difficulty === 'club') {
      return { moveSpeed: 4.8, reactionDelay: 0.14, accuracySpread: 0.45, powerBase: 0.68 };
    }
    if (this.difficulty === 'championship') {
      return { moveSpeed: 6.8, reactionDelay: 0.02, accuracySpread: 0.12, powerBase: 0.88 };
    }
    return { moveSpeed: 5.8, reactionDelay: 0.06, accuracySpread: 0.24, powerBase: 0.78 };
  }

  /**
   * Computes official USAPA starting positions for all active athletes before a serve
   */
  computePreServePositions(rules, players) {
    const isDoubles = rules.isDoublesActive();
    const srvTeam = rules.servingTeam;
    const serveBox = rules.getServeSideBox(); // 'right_even' or 'left_odd'

    // Helper for X coordinate of 'right_even' vs 'left_odd' from each team's perspective
    // Team 0 (Near, z > 0 looking toward -Z): Right is +X (+1.45m), Left is -X (-1.45m)
    // Team 1 (Far,  z < 0 looking toward +Z): Right is -X (-1.45m), Left is +X (+1.45m)
    const getBoxX = (team, boxName) => {
      if (team === 0) return boxName === 'right_even' ? 1.42 : -1.42;
      return boxName === 'right_even' ? -1.42 : 1.42;
    };

    // Training Mode Lesson 1 (Kitchen Dink Drill): start both players right at the NVZ Kitchen line!
    if (rules.mode === 'training' && rules.trainingIndex === 0) {
      players.forEach((p) => {
        p.active = p.id === 'p0' || p.id === 'p2';
        if (p.id === 'p0') p.homePos.set(0.85, 0, COURT_SPECS.NVZ_DEPTH + 0.22);
        if (p.id === 'p2') p.homePos.set(-0.85, 0, -(COURT_SPECS.NVZ_DEPTH + 0.22));
      });
      return;
    }

    if (!isDoubles) {
      players.forEach((p) => {
        p.active = p.id === 'p0' || p.id === 'p2';
        if (!p.active) return;
        const boxX = getBoxX(p.team, serveBox);
        const zBase = p.team === 0 ? COURT_SPECS.HALF_LENGTH + 0.28 : -(COURT_SPECS.HALF_LENGTH + 0.28);
        p.homePos.set(boxX, 0, zBase);
        p.roleLabel = p.team === srvTeam ? 'SERVER' : 'RECEIVER';
      });
      return;
    }

    // Doubles (2v2): All 4 players active!
    // Serving team: Both partners start behind baseline (because of Double-Bounce Rule on return!)
    // Receiving team: Receiver starts behind baseline; Receiver's partner starts up at the 7ft Kitchen Line!
    players.forEach((p) => {
      p.active = true;
      const rightPlayerId = rules.teamRightCourtPlayer[p.team];
      const isRightCourt = p.id === rightPlayerId;
      const boxName = isRightCourt ? 'right_even' : 'left_odd';
      const xPos = getBoxX(p.team, boxName);
      const zSign = p.team === 0 ? 1 : -1;

      if (p.id === rules.currentServerId) {
        p.homePos.set(xPos, 0, zSign * (COURT_SPECS.HALF_LENGTH + 0.32));
        p.roleLabel = `SERVER #${rules.serverNumber}`;
      } else if (p.team === srvTeam) {
        p.homePos.set(xPos, 0, zSign * (COURT_SPECS.HALF_LENGTH + 0.15));
        p.roleLabel = 'PARTNER (BASELINE)';
      } else if (p.id === rules.currentReceiverId) {
        p.homePos.set(xPos, 0, zSign * (COURT_SPECS.HALF_LENGTH + 0.20));
        p.roleLabel = 'RECEIVER';
      } else {
        // Receiver's partner starts right outside the 7-foot Non-Volley Zone (Kitchen) line!
        p.homePos.set(xPos, 0, zSign * (COURT_SPECS.NVZ_DEPTH + 0.26));
        p.roleLabel = 'NVZ PARTNER';
      }
    });
  }

  /**
   * Chooses which player on the receiving side should intercept the incoming ball
   */
  selectResponder(players, team, ballPos, ballVel, rules) {
    const activeTeamPlayers = players.filter((p) => p.active && p.team === team);
    if (activeTeamPlayers.length <= 1) return activeTeamPlayers[0] || null;

    // On the serve, ONLY the designated receiver is legally allowed to return the serve!
    if (rules.rallyPhase === 'serve_in_flight') {
      return activeTeamPlayers.find((p) => p.id === rules.currentReceiverId) || activeTeamPlayers[0];
    }

    // In open rally / return of serve, pick the teammate closest to the predicted X trajectory
    const timeToReach = Math.min(1.1, Math.abs(ballPos.z - activeTeamPlayers[0].pos.z) / Math.max(3.0, Math.abs(ballVel.z)));
    const predX = ballPos.x + ballVel.x * timeToReach;

    let bestPlayer = activeTeamPlayers[0];
    let bestScore = Infinity;
    for (const p of activeTeamPlayers) {
      const dist = Math.abs(p.pos.x - predX) + (p.isHuman ? -0.25 : 0);
      if (dist < bestScore) {
        bestScore = dist;
        bestPlayer = p;
      }
    }
    return bestPlayer;
  }

  /**
   * Decides the AI's target coordinate, shot archetype, and paddle face angles
   */
  decideAIShot({ hitter, players, physics, rules }) {
    const params = this.getDifficultyParams();
    const oppTeam = 1 - hitter.team;
    const dirZ = hitter.team === 0 ? -1 : 1; // Target Z sign is oppTeam's side: Team 0 -> -Z, Team 1 -> +Z
    const targetZSign = oppTeam === 0 ? 1 : -1;

    // 1. If Pre-Serve -> Execute Legal Underhand Serve into Diagonal Service Box
    if (rules.rallyPhase === 'pre_serve') {
      const box = rules.getTargetServiceBoxBounds();
      const targetX = (box.minX + box.maxX) * 0.5 + (Math.random() - 0.5) * 0.9;
      const targetZ = (box.minZ + box.maxZ) * 0.5 + targetZSign * 0.65;
      return {
        shotType: 'serve',
        target: new THREE.Vector3(targetX, 0.0368, targetZ),
        power: 0.78,
        pitchOffset: 0,
        yawOffset: 0,
        brushOffset: 8,
      };
    }

    // 2. Training Mode Coach Behavior (tailored to active lesson!)
    if (rules.mode === 'training') {
      const lesson = rules.trainingIndex;
      if (lesson === 0) {
        // Lesson 1: Kitchen Crosscourt Dink Coach -> always dinks back into user's Kitchen!
        const tx = THREE.MathUtils.clamp(-hitter.pos.x * 0.75 + (Math.random() - 0.5) * 0.6, -2.2, 2.2);
        const tz = targetZSign * (1.25 + Math.random() * 0.65);
        return {
          shotType: 'dink',
          target: new THREE.Vector3(tx, 0.0368, tz),
          power: 0.68,
          pitchOffset: 4,
          yawOffset: 0,
          brushOffset: 0,
        };
      }
      if (lesson === 2 && rules.rallyPhase === 'serve_in_flight') {
        // Lesson 3: Double-Bounce & 3rd-Shot Drop Coach -> returns serve deep to user's baseline!
        const tx = (Math.random() - 0.5) * 1.8;
        const tz = targetZSign * 5.35;
        return {
          shotType: 'drive',
          target: new THREE.Vector3(tx, 0.0368, tz),
          power: 0.74,
          pitchOffset: 8,
          yawOffset: 0,
          brushOffset: 10,
        };
      }
      if (lesson === 4 && Math.random() < 0.45) {
        // Lesson 5: Physics Lab -> occasionally feeds a high lob so user can test Overhead Smash!
        return {
          shotType: 'lob',
          target: new THREE.Vector3((Math.random() - 0.5) * 2.0, 0.0368, targetZSign * 2.8),
          power: 0.75,
          pitchOffset: 10,
          yawOffset: 0,
          brushOffset: 0,
        };
      }
    }

    // 3. Tactical Rally Decision Tree (Return of Serve -> 3rd-Shot Drop/Drive -> Kitchen Dink / Volley / Smash)
    const distFromNet = Math.abs(hitter.pos.z);
    const ballHeight = physics.pos.y;
    const isVolley = physics.bounceCountOnCurrentSide === 0;

    // A) High ball near net -> Overhead Smash!
    if (ballHeight > 1.38 && distFromNet < 3.6 && (!isVolley || rules.bouncesInRally >= 2)) {
      const tx = (Math.random() - 0.5) * 4.2;
      const tz = targetZSign * (3.2 + Math.random() * 2.4);
      return {
        shotType: 'smash',
        target: new THREE.Vector3(tx, 0.0368, tz),
        power: params.powerBase + 0.12,
        pitchOffset: -4,
        yawOffset: 0,
        brushOffset: 12,
      };
    }

    // B) Return of Serve (Shot #2) -> Hit deep return to middle/back so AI can advance to Kitchen line
    if (rules.rallyPhase === 'serve_in_flight') {
      const tx = (Math.random() - 0.5) * 2.6;
      const tz = targetZSign * (4.8 + Math.random() * 1.1);
      return {
        shotType: Math.random() < 0.45 ? 'slice' : 'drive',
        target: new THREE.Vector3(tx, 0.0368, tz),
        power: params.powerBase,
        pitchOffset: 4,
        yawOffset: 0,
        brushOffset: Math.random() < 0.45 ? -14 : 16,
      };
    }

    // C) Third-Shot from Baseline (Shot #3) -> 70% Aggressive Third-Shot Drop into Kitchen, 30% Topspin Drive
    if (rules.rallyPhase === 'return_in_flight' || distFromNet > 3.8) {
      if (Math.random() < 0.72) {
        const tx = THREE.MathUtils.clamp(-hitter.pos.x * 0.7 + (Math.random() - 0.5) * 1.2, -2.5, 2.5);
        const tz = targetZSign * (1.35 + Math.random() * 0.65);
        return {
          shotType: 'drop',
          target: new THREE.Vector3(tx, 0.0368, tz),
          power: 0.72,
          pitchOffset: 4,
          yawOffset: 0,
          brushOffset: 10,
        };
      }
      const tx = (Math.random() - 0.5) * 3.8;
      const tz = targetZSign * (4.4 + Math.random() * 1.4);
      return {
        shotType: 'drive',
        target: new THREE.Vector3(tx, 0.0368, tz),
        power: params.powerBase + 0.05,
        pitchOffset: 0,
        yawOffset: 0,
        brushOffset: 18,
      };
    }

    // D) At the Non-Volley Zone (Kitchen) Line:
    if (isVolley && rules.bouncesInRally >= 2) {
      // Fast Kitchen Punch Volley at feet!
      const tx = (Math.random() - 0.5) * 3.6;
      const tz = targetZSign * (2.6 + Math.random() * 2.2);
      return {
        shotType: 'volley',
        target: new THREE.Vector3(tx, 0.0368, tz),
        power: params.powerBase,
        pitchOffset: 0,
        yawOffset: 0,
        brushOffset: -5,
      };
    }

    // Crosscourt Dink duel at the Kitchen line!
    const crossX = THREE.MathUtils.clamp(
      -Math.sign(hitter.pos.x || 1) * (1.1 + Math.random() * 1.35),
      -2.55,
      2.55
    );
    const dinkZ = targetZSign * (1.15 + Math.random() * 0.78);
    return {
      shotType: 'dink',
      target: new THREE.Vector3(crossX, 0.0368, dinkZ),
      power: 0.68,
      pitchOffset: 3,
      yawOffset: 0,
      brushOffset: 5,
    };
  }
}
