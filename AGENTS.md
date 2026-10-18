# AGENTS.md — AI Agent & Multi-Agent Architecture Guide

This document defines the architecture, workflows, conventions, and verification steps for AI coding agents, Blender MCP asset-generation agents, and the in-game multi-agent pickleball simulation loop in **PPA Tour 3D Pickleball Simulator**.

---

## 1. Quick Commands for Agents

| Task | Command | Notes |
| :--- | :--- | :--- |
| **Install dependencies** | `npm install` | Installs `three` (`^0.184.0`) and `vite` (`^8.0.0`) |
| **Start dev server** | `npm run dev` | Serves on `http://localhost:5173/` with HMR |
| **Run verification suite** | `npm test` *(or `node tests/verify_simulation.mjs`)* | Validates all 5 Blender `.glb` assets, 9 animations, 4 emotion shape keys, 40-hole Magnus physics, USAPA rules, and AI positioning |
| **Production build** | `npm run build` | Outputs production bundle to `dist/` |

> **Mandatory Rule for Coding Agents**: Always run `node tests/verify_simulation.mjs && npm run build` after modifying any physics, rules, AI, UI, or Blender `.glb` assets to ensure zero regressions.

---

## 2. Codebase Architecture & Module Map

```text
pickleball/
├── index.html                      # Broadcast Scorebug, Live 3D Emotion PiP, On-Screen Keycaps & Rules Modal
├── public/assets/                  # Blender MCP procedurally generated & rigged 3D GLB assets
│   ├── court.glb                   # 20x44ft USAPA court, 7ft Kitchen, concrete apron & 34"/36" parabolic net
│   ├── paddle.glb                  # 16.5"x7.5" 16mm honeycomb core + T700 raw carbon-fiber paddle
│   ├── pickleball.glb              # 73.66mm USAPA outdoor ball with 40 circular aerodynamic holes
│   ├── player_male.glb             # Rigged male Indian athlete (Arjun) + 9 animations + 4 facial shape keys
│   └── player_female.glb           # Rigged female Indian athlete (Priya) + 9 animations + 4 facial shape keys
├── src/
│   ├── main.js                     # Three.js WebGL scene, outdoor stadium, dual-camera PiP & game loop
│   ├── style.css                   # ESPN/PPA Tour broadcast HUD styling & interactive keycap animations
│   ├── ai/PickleballAI.js          # Multi-agent tactical decision engine (Singles, Doubles partner/opponents, Coach)
│   ├── audio/SoundEngine.js        # Web Audio API spatial synthesis (paddle pop, shoe squeaks, crowd, referee)
│   ├── physics/PickleballPhysics.js# 240Hz sub-stepped 40-hole drag, Magnus spin lift & paddle angle solver
│   ├── rules/PickleballRules.js    # USAPA rule validator (Kitchen NVZ, Double-Bounce, 0-0-2 scoring, 5 lessons)
│   └── ui/CourtOverlays.js         # 3D holographic court overlays, trajectory arc & bounce rings
└── tests/
    └── verify_simulation.mjs       # Automated verification test suite
```

---

## 3. Blender MCP Agent Pipeline (`blender` MCP Server)

When using the connected **Blender MCP** server (`execute_blender_code`, `look`, `get_scene_info`) to modify or regenerate 3D assets in `public/assets/`, agents must adhere to the following contracts:

### 3.1 Coordinate & Scale Conventions
- **Units**: 1 Blender unit = 1 meter (`1 ft = 0.3048 m`).
- **Court Alignment**:
  - Net line is along the **X-axis** at `Z = 0` in Three.js (`Y = 0` in Blender before glTF `+Y Up` conversion).
  - Full court dimensions: **20 ft wide (`6.096 m`, `X ∈ [-3.048, +3.048]`)** × **44 ft long (`13.4112 m`, `Z ∈ [-6.7056, +6.7056]`)**.
  - **Non-Volley Zone ("The Kitchen")**: `7 ft (2.1336 m)` on each side of the net (`|Z| <= 2.1336 m`).
  - **Net Height**: `36 inches (0.9144 m)` at the sideline posts (`X = ±3.048 m`), sagging parabolically to **`34 inches (0.8636 m)`** at center (`X = 0`).

### 3.2 Human Athlete Rig, Animation & Emotion Contracts (`player_male.glb`, `player_female.glb`)
1. **Skeletal Bone Names** (required by `src/main.js` for paddle attachment & breathing):
   - Spine chain: `Root` → `Pelvis` → `Spine` → `Chest` → `Neck` → `Head`
   - Arms: `Shoulder.L/R` → `UpperArm.L/R` → `Forearm.L/R` → **`Hand.R`** *(3D paddle attaches directly to `Hand.R`)* and `Hand.L`
   - Legs: `Thigh.L/R` → `Shin.L/R` → `Foot.L/R`
2. **Required NLA Animation Tracks** (exported with `export_animation_mode='NLA_TRACKS'`):
   - `Idle_SplitStep` (looping split-step ready bounce)
   - `Run_Footwork` (looping court footwork cycle)
   - `Serve_Underhand` (USAPA legal underhand pendulum serve below waist)
   - `Dink_Crosscourt` (deep knee bend + soft lifted kitchen dink)
   - `ThirdShot_Drop` (baseline-to-kitchen transition arc stroke)
   - `Volley_Kitchen` (compact punch volley at the NVZ line)
   - `Smash_Overhead` (leaping overhead put-away smash)
   - `Celebrate_FistPump` (full-body victory jump & double fist pump)
   - `Frustrated_Slump` (full-body head shake & hand-to-forehead slump on faults)
3. **Required Facial Emotion Shape Keys** (exported with `export_morph=True`):
   - `Basis`, `Celebration`, `Frustration`, `Effort`, `Surprise`
4. **Blender Namespace Note**:
   - Each call to `execute_blender_code` executes in an isolated Python dictionary namespace. Always define helper functions in the same script execution and export each character at origin `(0, 0, 0)` before translating them for viewport screenshots.

---

## 4. In-Game Multi-Agent AI Architecture (`src/ai/PickleballAI.js`)

The simulation runs 4 autonomous/semi-autonomous court agents coordinated by `PickleballAI`:

| Agent ID | Athlete | Team | Role & Behavior |
| :--- | :--- | :--- | :--- |
| **`p0`** | **Arjun (You)** | Team 0 (Near, `+Z`) | Human-controlled player with optional **Auto-Footwork Assist** that respects the Double-Bounce Rule and 7ft Kitchen line. |
| **`p1`** | **Priya (Partner)** | Team 0 (Near, `+Z`) | **Doubles Co-op AI Teammate**. Automatically serves when designated Server #1/#2, covers her half of the court, advances to the Kitchen line after Bounce #2, and executes third-shot drops or kitchen dinks. |
| **`p2`** | **Vikram (AI)** | Team 1 (Far, `-Z`) | Primary AI Opponent in **Training**, **Singles (1v1)**, and **Doubles (2v2)**. |
| **`p3`** | **Ananya (AI)** | Team 1 (Far, `-Z`) | Doubles AI Opponent Partner in **Doubles (2v2)**. |

### AI Tactical State Machine
1. **`pre_serve` Positioning**:
   - Server stands behind the baseline (`|Z| = 6.95 m`) in the active even (`Right`) or odd (`Left`) half.
   - Receiver stands behind the diagonally opposite baseline (`|Z| = 6.80 m`).
   - Non-receiving/non-serving Doubles partners start at the Kitchen line (`|Z| = 2.38 m`).
2. **Double-Bounce Enforcement (`bouncesInRally < 2`)**:
   - Receiving and serving teams automatically hold behind the incoming ball's predicted bounce point until the 2 mandatory bounces are completed.
3. **Shot Selection Heuristics (`decideAIShot`)**:
   - **Rally Shot #1 (Return of Serve)**: Deep topspin return toward the middle/baseline to keep the serving team back.
   - **Rally Shot #2 (Third Shot from Baseline)**: Selects an **Aggressive Third-Shot Drop (`drop`)** into the opponent's Kitchen so the serving team can advance to the NVZ line.
   - **High Ball (`y > 1.42 m`) near Net**: Executes an **Overhead Smash (`smash`)** angled toward the open sideline.
   - **Ball inside Kitchen (`|Z| <= 2.45 m`)**: Executes a soft **Crosscourt Dink (`dink`)** into the opposing Kitchen.
   - **Fast Ball in Air outside Kitchen (`bouncesInRally >= 2`)**: Executes a **Punch Volley (`volley`)**.

---

## 5. High-Precision Physics & UI Guidelines

- **240Hz Sub-Stepped Aerodynamics (`src/physics/PickleballPhysics.js`)**:
  - Models a `26 g`, `73.66 mm` USAPA 40-hole hollow pickleball with drag coefficient $C_d = 0.44$ and Magnus lift coefficient $C_L = 0.21$.
  - Explicit paddle contact normal $\mathbf{n}$ is computed from `facePitchDeg` (`Q`/`E`) and `faceYawDeg` (`Z`/`C`), while `brushAngleDeg` (`R`/`F`) controls tangential friction to generate topspin (`+RPM`, downward Magnus dip) or backspin slice (`-RPM`, upward Magnus float).
- **UI & Dialog Standards**:
  - The USAPA Rules modal (`<dialog id="rules-modal" closedby="any">`) uses declarative light-dismiss with a feature-detected backdrop click fallback in `initModalFallback()`.
  - The bottom HUD (`#live-key-prompt` and `.controls-and-shots-deck`) must always reflect real-time keyboard presses (`data-keycap`) and highlight the contextually recommended shot (`1–6`).
