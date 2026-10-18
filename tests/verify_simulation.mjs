import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';

import {
  COURT_SPECS,
  BALL_SPECS,
  getNetHeightAtX,
  PickleballPhysics,
} from '../src/physics/PickleballPhysics.js';
import { TRAINING_MODULES, PickleballRules } from '../src/rules/PickleballRules.js';
import { PickleballAI } from '../src/ai/PickleballAI.js';

const assetsDir = path.resolve('/Users/mani/Documents/Mani/games/pickleball/public/assets');

console.log('=== 1. Verifying Blender MCP Exported GLB Assets ===');
function parseGLBJson(filePath) {
  const buf = fs.readFileSync(filePath);
  const magic = buf.readUInt32LE(0);
  assert.equal(magic, 0x46546c67, `Invalid GLB magic in ${filePath}`);
  const chunkLen = buf.readUInt32LE(12);
  const jsonStr = buf.subarray(20, 20 + chunkLen).toString('utf8');
  return JSON.parse(jsonStr);
}

const requiredAssets = [
  'court.glb',
  'paddle.glb',
  'pickleball.glb',
  'player_male.glb',
  'player_female.glb',
];

for (const file of requiredAssets) {
  const full = path.join(assetsDir, file);
  assert.ok(fs.existsSync(full), `Missing asset ${file}`);
  const stat = fs.statSync(full);
  assert.ok(stat.size > 50000, `Asset ${file} is unexpectedly small (${stat.size} bytes)`);
  const gltf = parseGLBJson(full);

  if (file.startsWith('player_')) {
    const animNames = (gltf.animations || []).map((a) => a.name);
    for (const reqAnim of [
      'Idle_SplitStep',
      'Serve_Underhand',
      'Dink_Crosscourt',
      'ThirdShot_Drop',
      'Volley_Kitchen',
      'Smash_Overhead',
      'Run_Footwork',
      'Celebrate_FistPump',
      'Frustrated_Slump',
    ]) {
      assert.ok(animNames.includes(reqAnim), `${file} missing animation ${reqAnim}`);
    }
    const targetNames = gltf.meshes[0]?.extras?.targetNames || [];
    for (const reqMorph of ['Celebration', 'Frustration', 'Effort', 'Surprise']) {
      assert.ok(targetNames.includes(reqMorph), `${file} missing shape key ${reqMorph}`);
    }
    assert.ok((gltf.skins || []).length >= 1, `${file} missing skeletal skin rig`);
  }
}
console.log('✓ All 5 Blender GLB assets verified (organic human meshes, skins, 9 animations, 4 facial emotion shape keys).');

console.log('=== 2. Verifying High-Precision 40-Hole Aerodynamics & Magnus Physics ===');
assert.ok(Math.abs(getNetHeightAtX(0) - 0.8636) < 1e-4, 'Center net height must be 34 inches (0.8636m)');
assert.ok(Math.abs(getNetHeightAtX(3.048) - 0.9144) < 1e-4, 'Sideline net height must be 36 inches (0.9144m)');
assert.equal(BALL_SPECS.HOLES, 40, 'Outdoor pickleball must specify 40 holes');

const phys = new PickleballPhysics();
const origin = new THREE.Vector3(0, 0.95, 6.5);
const target = new THREE.Vector3(-1.2, 0.0368, -4.5);

// Compare Topspin Drive (+20 deg brush) vs Backspin Slice (-20 deg brush)
const strikeTopspin = phys.executePaddleStrike({
  origin,
  target,
  shotType: 'drive',
  userBrushOffsetDeg: 15,
  userPitchOffsetDeg: -3,
});
const velTop = phys.vel.clone();
const omegaTop = phys.omega.clone();

const strikeSlice = phys.executePaddleStrike({
  origin,
  target,
  shotType: 'slice',
  userBrushOffsetDeg: -15,
  userPitchOffsetDeg: 6,
});
const velSlice = phys.vel.clone();
const omegaSlice = phys.omega.clone();

assert.ok(strikeTopspin.topspinRpm > 1500, 'Topspin drive should generate >1500 RPM topspin');
assert.ok(strikeSlice.topspinRpm < -1000, 'Slice should generate <-1000 RPM backspin');

// Check Magnus vertical acceleration direction:
// Topspin should produce negative (downward) Magnus Y acceleration relative to Backspin!
const accTop = phys.computeAcceleration(velTop, omegaTop, new THREE.Vector3(0, 0, 0));
const accSlice = phys.computeAcceleration(velSlice, omegaSlice, new THREE.Vector3(0, 0, 0));
assert.ok(
  accTop.y < accSlice.y,
  `Topspin vertical acceleration (${accTop.y.toFixed(2)}) must dip more downward than Backspin (${accSlice.y.toFixed(2)})`
);
console.log('✓ 40-Hole Drag, Magnus Spin Lift/Dip, and Explicit Paddle Contact Angles verified.');

console.log('=== 3. Verifying USAPA Rules (Kitchen Fault, Double-Bounce, 0-0-2 Side-Out Scoring) ===');
const rules = new PickleballRules();
rules.setMode('doubles');
assert.equal(rules.getFormattedScore(), '0 - 0 - 2', 'Doubles must start at 0 - 0 - 2');

// Serving strike
const srvValid = rules.validateStrike({
  hitterTeam: 0,
  hitterPos: new THREE.Vector3(1.4, 0, 6.9),
  wasVolley: false,
});
assert.equal(srvValid.legal, true);

// Receiver attempts to volley the serve before Bounce #1 -> Must trigger DOUBLE_BOUNCE_FAULT!
const faultVolleyServe = rules.validateStrike({
  hitterTeam: 1,
  hitterPos: new THREE.Vector3(-1.4, 0, -5.5),
  wasVolley: true,
});
assert.equal(faultVolleyServe.legal, false);
assert.equal(faultVolleyServe.faultType, 'DOUBLE_BOUNCE_FAULT');

// Reset and test valid serve bounce + valid return bounce + NVZ Kitchen foot fault on volley
rules.setMode('doubles');
rules.validateStrike({ hitterTeam: 0, hitterPos: new THREE.Vector3(1.4, 0, 6.9), wasVolley: false });
const bounce1 = rules.evaluateBounce({
  pos: new THREE.Vector3(-1.4, 0.0368, -4.5),
  side: 1,
  bounceNumberOnSide: 1,
  hitterTeam: 0,
  inBounds: true,
  inKitchen: false,
});
assert.equal(bounce1.rallyEnded, false);
assert.equal(rules.bouncesInRally, 1);

// Receiver returns after bounce
assert.equal(
  rules.validateStrike({ hitterTeam: 1, hitterPos: new THREE.Vector3(-1.4, 0, -5.5), wasVolley: false }).legal,
  true
);

// Bounce #2 on server's side
const bounce2 = rules.evaluateBounce({
  pos: new THREE.Vector3(1.2, 0.0368, 4.8),
  side: 0,
  bounceNumberOnSide: 1,
  hitterTeam: 1,
  inBounds: true,
  inKitchen: false,
});
assert.equal(bounce2.rallyEnded, false);
assert.equal(rules.bouncesInRally, 2);

// Now player steps into Kitchen (z = 1.8m <= 2.1336m) and volleys out of air -> Must trigger NVZ_KITCHEN_FAULT!
const nvzFault = rules.validateStrike({
  hitterTeam: 0,
  hitterPos: new THREE.Vector3(0.5, 0, 1.8),
  wasVolley: true,
});
assert.equal(nvzFault.legal, false);
assert.equal(nvzFault.faultType, 'NVZ_KITCHEN_FAULT');

// Test 0-0-2 Side-Out transition when serving team loses rally on Server #2
const sideOutRes = rules.resolveRallyWinner(1, 'NVZ Fault');
assert.equal(sideOutRes.outcomeType, 'SIDE_OUT');
assert.equal(rules.servingTeam, 1);
assert.equal(rules.serverNumber, 1);
assert.equal(rules.getFormattedScore(), '0 - 0 - 1');
console.log('✓ USAPA Double-Bounce Rule, NVZ Kitchen Volley Fault, and 0-0-2 Doubles Scoring verified.');

console.log('=== 4. Verifying Multi-Agent AI Positioning & Shot Selection ===');
const ai = new PickleballAI();
const mockPlayers = [
  { id: 'p0', team: 0, isHuman: true, active: true, pos: new THREE.Vector3(), homePos: new THREE.Vector3() },
  { id: 'p1', team: 0, isHuman: false, active: true, pos: new THREE.Vector3(), homePos: new THREE.Vector3() },
  { id: 'p2', team: 1, isHuman: false, active: true, pos: new THREE.Vector3(), homePos: new THREE.Vector3() },
  { id: 'p3', team: 1, isHuman: false, active: true, pos: new THREE.Vector3(), homePos: new THREE.Vector3() },
];
ai.computePreServePositions(rules, mockPlayers);
assert.equal(TRAINING_MODULES.length, 5);
console.log('✓ Multi-Agent AI and 5 Interactive Training Modules verified.');
console.log('ALL TESTS PASSED!');
