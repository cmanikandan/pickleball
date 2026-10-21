import { COURT_SPECS } from '../physics/PickleballPhysics.js';

/**
 * Complete USAPA Pickleball Rules, Scoring (Singles & Doubles 0-0-2),
 * Double-Bounce Rule, Non-Volley Zone (Kitchen) Fault Detector,
 * and Interactive Training Tutorial Curriculum.
 */
export const TRAINING_MODULES = [
  {
    id: 'kitchen_dink',
    stepNumber: 1,
    title: '1. The Kitchen & Soft Net Dink',
    subtitle: 'Learn the 7-Foot No-Volley Zone right at the net',
    ruleSummary:
      'The light-blue 7-foot box on each side of the net is called "The Kitchen" (Non-Volley Zone). Rule: You CANNOT hit the ball out of the air while your feet touch the Blue Kitchen. You MUST let it bounce first — or stand behind the white Kitchen line!',
    proTip:
      'Tap the Laptop Trackpad (or press SPACE / Key K) to start! Wait for Coach Vikram’s ball to bounce, then gently tap it back into his light-blue Kitchen 3 times.',
    steps: [
      '1️⃣ Stand just behind the white Kitchen line (Coach placed you here!).',
      '2️⃣ 1-Tap Trackpad or press SPACE to start the soft net rally.',
      '3️⃣ Let Coach’s ball bounce, then tap Trackpad or [K] to land 3 soft Dinks in the Blue Kitchen!',
    ],
    recommendedKey: '1-Tap Trackpad or [2] / [K] (Soft Dink)',
    targetGoals: 3,
    showKitchenZone: true,
    showServeZone: false,
    showDoubleBounceGuide: false,
    showScoringDiagram: false,
  },
  {
    id: 'underhand_serve',
    stepNumber: 2,
    title: '2. Diagonal Underhand Serve',
    subtitle: 'Serve cross-court past the Blue Kitchen',
    ruleSummary:
      'Every point starts with an underhand serve from behind the baseline. To be legal, your serve MUST clear the opponent’s Blue Kitchen (including its line) and bounce inside the glowing Green Diagonal Box!',
    proTip:
      'Move your cursor on the Laptop Trackpad to aim inside the glowing Green Box, then 1-Tap Trackpad or press SPACE to serve 3 legal serves!',
    steps: [
      '1️⃣ Move your Trackpad cursor so the target ring sits inside the glowing Green Box.',
      '2️⃣ 1-Tap Trackpad or press SPACE to hit an underhand serve.',
      '3️⃣ Land 3 clean serves inside the diagonal Green Box (clearing the Blue Kitchen)!',
    ],
    recommendedKey: 'Aim in Green Box → 1-Tap Trackpad / [SPACE]',
    targetGoals: 3,
    showKitchenZone: true,
    showServeZone: true,
    showDoubleBounceGuide: false,
    showScoringDiagram: false,
  },
  {
    id: 'double_bounce',
    stepNumber: 3,
    title: '3. The Two-Bounce Rule & High Drop',
    subtitle: 'Why you must wait for 2 bounces at the start of a point',
    ruleSummary:
      'Pickleball’s golden rule: (1) Your serve MUST bounce once on the AI’s side, and (2) the AI’s return MUST bounce once on YOUR side before anyone can hit the ball out of the air! After Bounce #2, hit a soft High Drop/Lob to move up.',
    proTip:
      'Step A: Tap to Serve. Step B: WAIT for Coach’s return to bounce on your side! Step C: Press [L] / 2-Finger Tap (or 1-Tap with Auto-Shot ON) to float a 3rd-Shot Drop over the net!',
    steps: [
      '1️⃣ 1-Tap Trackpad or press SPACE to serve cross-court.',
      '2️⃣ WAIT! Let Coach Vikram’s return bounce once on your side (Bounce #2).',
      '3️⃣ Hit a High Lob/Drop ([L], 2-Finger Tap, or 1-Tap) over the net 2 times!',
    ],
    recommendedKey: 'Serve → Let Bounce → [L] or 2-Finger Tap (Drop/Lob)',
    targetGoals: 2,
    showKitchenZone: true,
    showServeZone: false,
    showDoubleBounceGuide: true,
    showScoringDiagram: false,
  },
  {
    id: 'sideout_scoring',
    stepNumber: 4,
    title: '4. How 0 - 0 - 2 Doubles Scoring Works',
    subtitle: 'Only the serving team can win a point!',
    ruleSummary:
      'The 3 numbers (like 0 - 0 - 2) mean: [Your Score] - [Opponent Score] - [Server #1 or #2]. Only the SERVING team scores points! When you win a point, you & Priya switch Left/Right sides. When both partners lose their serve, it’s a "Side-Out" to the other team.',
    proTip:
      'Play 3 live Doubles rallies with Priya (your AI partner)! Watch the Top Scoreboard explain every point, side-switch, and Server #1 / #2 change.',
    steps: [
      '1️⃣ Check the Top Scoreboard: "0 - 0 - 2" means 0 to 0, Server #2.',
      '2️⃣ Tap Trackpad or press SPACE to play a full Doubles point with Priya.',
      '3️⃣ Complete 3 live rallies and watch how points & Side-Outs work!',
    ],
    recommendedKey: '1-Tap Trackpad / [SPACE] to Play 3 Doubles Rallies',
    targetGoals: 3,
    showKitchenZone: true,
    showServeZone: true,
    showDoubleBounceGuide: true,
    showScoringDiagram: true,
  },
  {
    id: 'physics_lab',
    stepNumber: 5,
    title: '5. Spin, Lob & Power Smash Lab',
    subtitle: 'Master Trackpad Scroll Spin, Lobs & Overhead Winners',
    ruleSummary:
      'Now put it all together! Use 2-Finger Scroll Up on your trackpad (or [R]) for Topspin dip, 2-Finger Scroll Down (or [F]/[X]) for Backspin Slice, 2-Finger Tap (or [L]) for a High Lob, and [M] / [5] for an Overhead Smash!',
    proTip:
      'Coach Vikram will mix in high lobs! Try scrolling on your trackpad to add spin and hit 5 shaped shots (Topspin, Slice, Lob, or Smash).',
    steps: [
      '1️⃣ Scroll 2 Fingers Up/Down on Trackpad (or click ↑Top / ↓Spin) to dial in spin.',
      '2️⃣ Tap Trackpad / SPACE to serve & rally with Coach Vikram.',
      '3️⃣ Hit 5 shots trying Lob ([L]/2-Finger Tap), Slice ([X]), or Smash ([M])!',
    ],
    recommendedKey: '2-Finger Scroll = Spin • [L] = Lob • [M] = Smash',
    targetGoals: 5,
    showKitchenZone: true,
    showServeZone: false,
    showDoubleBounceGuide: false,
    showScoringDiagram: false,
  },
];

export class PickleballRules {
  constructor() {
    this.mode = 'training'; // 'training' | 'singles' | 'doubles'
    this.trainingIndex = 0;
    this.trainingProgress = 0;

    // Score state
    this.score = [0, 0]; // [Team 0 (Near/Player), Team 1 (Far/AI)]
    this.servingTeam = 0; // 0 or 1
    this.serverNumber = 2; // 1 or 2 in Doubles (starts at 2 for 0-0-2 rule!)
    this.winningScore = 11;

    // In Doubles, track which player index on each team is currently on the Right (Even) side:
    // Team 0 players: 'p0' (User), 'p1' (AI Partner)
    // Team 1 players: 'p2' (AI Opp 1), 'p3' (AI Opp 2)
    this.teamRightCourtPlayer = {
      0: 'p0',
      1: 'p2',
    };
    this.currentServerId = 'p0';
    this.currentReceiverId = 'p2';

    // Rally state machine
    // 'pre_serve' | 'serve_in_flight' | 'return_in_flight' | 'open_rally' | 'point_over'
    this.rallyPhase = 'pre_serve';
    this.rallyShotCount = 0;
    this.bouncesInRally = 0; // 0 = before serve bounce, 1 = serve bounced, >=2 = double-bounce satisfied!
    this.lastCallout = {
      title: 'Welcome to 3D Pro Pickleball',
      detail: 'Press SPACE or Left-Click to Serve Underhand',
      type: 'info', // 'info' | 'point' | 'fault' | 'sideout'
      timestamp: 0,
    };
  }

  setMode(mode, trainingIndex = 0) {
    this.mode = mode;
    this.trainingIndex = trainingIndex;
    this.trainingProgress = 0;
    this.score = [0, 0];
    this.servingTeam = 0;
    // Doubles starts at 0-0-2!
    this.serverNumber = mode === 'doubles' || (mode === 'training' && trainingIndex === 3) ? 2 : 1;
    this.teamRightCourtPlayer = { 0: 'p0', 1: 'p2' };
    this.updateServerAndReceiver();
    this.rallyPhase = 'pre_serve';
    this.rallyShotCount = 0;
    this.bouncesInRally = 0;
  }

  isDoublesActive() {
    if (this.mode === 'doubles') return true;
    if (this.mode === 'training' && this.trainingIndex === 3) return true;
    return false;
  }

  /**
   * Determines which court box ('right_even' or 'left_odd') the current server serves from,
   * and which player ID is the active Server and Receiver.
   */
  getServeSideBox() {
    if (!this.isDoublesActive()) {
      // Singles: Server serves from Right (Even) court when their own score is even, Left (Odd) when odd
      const srvScore = this.score[this.servingTeam];
      return srvScore % 2 === 0 ? 'right_even' : 'left_odd';
    }
    // Doubles: Active server serves from whichever side they currently occupy
    const rightPlayer = this.teamRightCourtPlayer[this.servingTeam];
    return this.currentServerId === rightPlayer ? 'right_even' : 'left_odd';
  }

  updateServerAndReceiver() {
    if (!this.isDoublesActive()) {
      this.currentServerId = this.servingTeam === 0 ? 'p0' : 'p2';
      this.currentReceiverId = this.servingTeam === 0 ? 'p2' : 'p0';
      return;
    }
    // In Doubles, when a team starts serving (or at 0-0-2 start), the player in the Right (Even) box serves first
    const srvTeam = this.servingTeam;
    const rcvTeam = 1 - srvTeam;
    if (!this.currentServerId || (srvTeam === 0 && !['p0', 'p1'].includes(this.currentServerId)) || (srvTeam === 1 && !['p2', 'p3'].includes(this.currentServerId))) {
      this.currentServerId = this.teamRightCourtPlayer[srvTeam];
    }
    const serveBox = this.getServeSideBox();
    // Diagonal receiver sits in the same named box ('right_even' or 'left_odd') from their own perspective!
    const rcvRightPlayer = this.teamRightCourtPlayer[rcvTeam];
    const rcvLeftPlayer = rcvTeam === 0
      ? (rcvRightPlayer === 'p0' ? 'p1' : 'p0')
      : (rcvRightPlayer === 'p2' ? 'p3' : 'p2');

    this.currentReceiverId = serveBox === 'right_even' ? rcvRightPlayer : rcvLeftPlayer;
  }

  /**
   * Returns the formatted USAPA Score string (e.g. "0 - 0 - 2" in Doubles, "0 - 0" in Singles)
   */
  getFormattedScore() {
    const srvScore = this.score[this.servingTeam];
    const rcvScore = this.score[1 - this.servingTeam];
    if (this.isDoublesActive()) {
      return `${srvScore} - ${rcvScore} - ${this.serverNumber}`;
    }
    return `${srvScore} - ${rcvScore}`;
  }

  getSpokenScore() {
    const srvScore = this.score[this.servingTeam];
    const rcvScore = this.score[1 - this.servingTeam];
    if (this.isDoublesActive()) {
      return `${srvScore}, ${rcvScore}, ${this.serverNumber}`;
    }
    return `${srvScore}, ${rcvScore}`;
  }

  /**
   * Returns the bounding rectangle { minX, maxX, minZ, maxZ } of the legal diagonal service box
   */
  getTargetServiceBoxBounds() {
    const box = this.getServeSideBox();
    const srvTeam = this.servingTeam;
    // Near Team (0) at z > 0 looking toward -Z:
    //   Right (Even) court is x in [0, +3.048]; diagonal target on Far Court (z < 0) is x in [-3.048, 0]
    //   Left (Odd) court is x in [-3.048, 0]; diagonal target on Far Court (z < 0) is x in [0, +3.048]
    // Far Team (1) at z < 0 looking toward +Z:
    //   Right (Even) court from their view is x in [-3.048, 0]; diagonal target on Near Court (z > 0) is x in [0, +3.048]
    //   Left (Odd) court from their view is x in [0, +3.048]; diagonal target on Near Court (z > 0) is x in [-3.048, 0]
    if (srvTeam === 0) {
      const targetPositiveX = box === 'left_odd';
      return {
        minX: targetPositiveX ? 0 : -COURT_SPECS.HALF_WIDTH,
        maxX: targetPositiveX ? COURT_SPECS.HALF_WIDTH : 0,
        minZ: -COURT_SPECS.HALF_LENGTH,
        maxZ: -COURT_SPECS.NVZ_DEPTH, // Must clear NVZ line!
      };
    } else {
      const targetPositiveX = box === 'right_even';
      return {
        minX: targetPositiveX ? 0 : -COURT_SPECS.HALF_WIDTH,
        maxX: targetPositiveX ? COURT_SPECS.HALF_WIDTH : 0,
        minZ: COURT_SPECS.NVZ_DEPTH,
        maxZ: COURT_SPECS.HALF_LENGTH,
      };
    }
  }

  /**
   * Validates whether a paddle strike violates USAPA rules (Double-Bounce or Non-Volley Zone)
   */
  validateStrike({
    hitterTeam,
    hitterPos,
    wasVolley, // true if ball had 0 bounces on hitter's side before contact
  }) {
    if (this.rallyPhase === 'pre_serve') {
      // Serving strike
      this.rallyPhase = 'serve_in_flight';
      this.rallyShotCount = 1;
      this.bouncesInRally = 0;
      return { legal: true };
    }

    this.rallyShotCount += 1;

    // 1. Check Double-Bounce Rule!
    if (wasVolley && this.bouncesInRally < 2) {
      const faultDetail =
        this.bouncesInRally === 0
          ? 'Double-Bounce Fault! Receiver must let the serve bounce once before hitting.'
          : 'Double-Bounce Fault! Serving team must let the return of serve bounce once before volleying.';
      return {
        legal: false,
        faultType: 'DOUBLE_BOUNCE_FAULT',
        reason: faultDetail,
      };
    }

    // 2. Check Non-Volley Zone ("The Kitchen") Foot Fault on Volleys!
    // NVZ extends to |z| <= 2.1336m (7 feet from net, including the 2-inch NVZ line)
    const touchingKitchen = Math.abs(hitterPos.z) <= COURT_SPECS.NVZ_DEPTH + 0.04;
    if (wasVolley && touchingKitchen) {
      return {
        legal: false,
        faultType: 'NVZ_KITCHEN_FAULT',
        reason:
          'Non-Volley Zone ("Kitchen") Fault! You cannot volley the ball out of the air while touching the 7ft Kitchen or its line.',
      };
    }

    if (this.rallyPhase === 'serve_in_flight') {
      this.rallyPhase = 'return_in_flight';
    } else if (this.rallyPhase === 'return_in_flight') {
      this.rallyPhase = 'open_rally';
    }

    return { legal: true };
  }

  /**
   * Evaluates a ball bounce event against USAPA rules (Serve box bounds, Kitchen short serve, Out of bounds, Double bounce)
   */
  evaluateBounce(bounceEvent) {
    const { pos, side, bounceNumberOnSide, hitterTeam, inBounds, inKitchen } = bounceEvent;

    // Case A: Ball bounced a 2nd time on the same side -> Point ends, hitterTeam wins rally!
    if (bounceNumberOnSide >= 2) {
      const winnerTeam = 1 - side;
      return {
        rallyEnded: true,
        winnerTeam,
        reason: 'Double Bounce! Ball bounced twice before being returned.',
        code: 'WINNER_DOUBLE_BOUNCE',
      };
    }

    // Case B: First bounce on hitter's OWN side of the net -> Fault on hitterTeam!
    if (side === hitterTeam) {
      return {
        rallyEnded: true,
        winnerTeam: 1 - hitterTeam,
        reason: 'Fault! Ball bounced on hitter’s own side of the net.',
        code: 'FAULT_OWN_SIDE',
      };
    }

    // Case C: First bounce on opponent's side — check if Serve or Rally shot
    if (this.rallyPhase === 'serve_in_flight') {
      const box = this.getTargetServiceBoxBounds();
      const tol = 0.06; // 2-inch line tolerance
      if (inKitchen || Math.abs(pos.z) <= COURT_SPECS.NVZ_DEPTH + 0.02) {
        return {
          rallyEnded: true,
          winnerTeam: 1 - hitterTeam,
          reason: 'Service Fault! Serve landed inside or touched the Non-Volley Zone (Kitchen) line.',
          code: 'SERVE_FAULT_KITCHEN',
        };
      }
      const inServiceBox =
        pos.x >= box.minX - tol &&
        pos.x <= box.maxX + tol &&
        pos.z >= box.minZ - tol &&
        pos.z <= box.maxZ + tol;

      if (!inServiceBox) {
        return {
          rallyEnded: true,
          winnerTeam: 1 - hitterTeam,
          reason: 'Service Fault! Serve landed outside the diagonal crosscourt service box.',
          code: 'SERVE_FAULT_OUT',
        };
      }

      // Valid serve bounce (#1 of Double-Bounce Rule)!
      this.bouncesInRally = 1;
      return {
        rallyEnded: false,
        bounceCountInRally: 1,
        note: 'Bounce #1 (Serve in)! Receiver may now return.',
      };
    }

    // Normal rally shot first bounce
    if (!inBounds) {
      return {
        rallyEnded: true,
        winnerTeam: 1 - hitterTeam,
        reason: 'Out of Bounds! Ball landed outside the 20x44ft court lines.',
        code: 'FAULT_OUT_OF_BOUNDS',
      };
    }

    this.bouncesInRally += 1;
    return {
      rallyEnded: false,
      bounceCountInRally: this.bouncesInRally,
      inKitchen,
      note:
        this.bouncesInRally === 2
          ? 'Bounce #2 complete! Double-Bounce Rule satisfied — both teams may now volley!'
          : 'Ball in bounds!',
    };
  }

  /**
   * Resolves the end of a rally according to USAPA Side-Out Scoring Rules
   */
  resolveRallyWinner(winnerTeam, reason) {
    this.rallyPhase = 'point_over';

    // In Training Mode (except Module 4 which teaches Side-Out Scoring), keep player serving for rapid drill flow
    if (this.mode === 'training' && this.trainingIndex !== 3) {
      const won = winnerTeam === 0;
      this.lastCallout = {
        title: won ? 'Great Shot!' : 'Coach Tip / Fault',
        detail: reason,
        type: won ? 'point' : 'fault',
        timestamp: performance.now(),
      };
      return {
        outcomeType: won ? 'TRAINING_SUCCESS' : 'TRAINING_RETRY',
        scoreText: this.getFormattedScore(),
        callout: this.lastCallout,
      };
    }

    // Official USAPA Side-Out Scoring (Singles & Doubles)
    if (winnerTeam === this.servingTeam) {
      // Serving team wins the rally -> Scores 1 point!
      this.score[this.servingTeam] += 1;

      if (this.isDoublesActive()) {
        // Serving team partners switch Left <-> Right courts!
        const curRight = this.teamRightCourtPlayer[this.servingTeam];
        if (this.servingTeam === 0) {
          this.teamRightCourtPlayer[0] = curRight === 'p0' ? 'p1' : 'p0';
        } else {
          this.teamRightCourtPlayer[1] = curRight === 'p2' ? 'p3' : 'p2';
        }
      }
      this.updateServerAndReceiver();

      const srvScore = this.score[this.servingTeam];
      const rcvScore = this.score[1 - this.servingTeam];
      const matchWon = srvScore >= this.winningScore && srvScore - rcvScore >= 2;

      this.lastCallout = {
        title: matchWon
          ? `${this.servingTeam === 0 ? 'PLAYER TEAM' : 'OPPONENT'} WINS MATCH!`
          : `POINT! (${this.getFormattedScore()})`,
        detail: reason,
        type: 'point',
        timestamp: performance.now(),
      };

      if (this.mode === 'training' && this.trainingIndex === 3) {
        this.trainingProgress += 1;
      }

      return {
        outcomeType: matchWon ? 'MATCH_OVER' : 'POINT_SCORED',
        scoreText: this.getFormattedScore(),
        callout: this.lastCallout,
      };
    } else {
      // Receiving team wins the rally -> No point scored; Second Server or Side Out!
      if (this.isDoublesActive() && this.serverNumber === 1) {
        // Move from Server #1 to Server #2 on the same team (no court switch!)
        this.serverNumber = 2;
        if (this.servingTeam === 0) {
          this.currentServerId = this.currentServerId === 'p0' ? 'p1' : 'p0';
        } else {
          this.currentServerId = this.currentServerId === 'p2' ? 'p3' : 'p2';
        }
        this.updateServerAndReceiver();

        this.lastCallout = {
          title: `SECOND SERVER! (${this.getFormattedScore()})`,
          detail: `${reason} — Service passes to partner (Server #2).`,
          type: 'sideout',
          timestamp: performance.now(),
        };
      } else {
        // Side Out! Service passes to opposing team's Right (Even) court player as Server #1
        this.servingTeam = 1 - this.servingTeam;
        this.serverNumber = 1;
        this.currentServerId = this.teamRightCourtPlayer[this.servingTeam];
        this.updateServerAndReceiver();

        this.lastCallout = {
          title: `SIDE OUT! (${this.getFormattedScore()})`,
          detail: `${reason} — Service turns over to ${this.servingTeam === 0 ? 'Your Team' : 'Opponents'}.`,
          type: 'sideout',
          timestamp: performance.now(),
        };
      }

      if (this.mode === 'training' && this.trainingIndex === 3) {
        this.trainingProgress += 1;
      }

      return {
        outcomeType: 'SIDE_OUT',
        scoreText: this.getFormattedScore(),
        callout: this.lastCallout,
      };
    }
  }
}
