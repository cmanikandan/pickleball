# AGENTS.md — AI Agent, Blender MCP & Multi-Agent Architecture Guide

This document defines the architecture, workflows, conventions, and verification steps for AI coding agents ([Google Antigravity](https://antigravity.google/) & [Google Gemini models](https://deepmind.google/technologies/gemini/)), [Blender MCP](https://github.com/ahujasid/blender-mcp) 3D asset-generation agents, and the in-game multi-agent pickleball simulation loop in **Bharat Pickleball League (BPL 2025) — Ultra-HD 3D Pickleball Simulator & Interactive Coach**.

---

## 1. Quick Commands for Agents

| Task | Command | Notes |
| :--- | :--- | :--- |
| **Install dependencies** | `npm install` | Installs `three` (`0.184.0`) and `vite` (`8.3.1`) |
| **Start dev server** | `npm run dev` | Serves on `http://localhost:5173/` with HMR |
| **Run verification suite** | `npm test` *(or `node tests/verify_simulation.mjs`)* | Validates all 5 Blender `.glb` assets, skeletal animations, 4 emotion shape keys, 40-hole Magnus physics, USAPA/AIPA rules, and AI positioning |
| **Production build** | `npm run build` | Outputs production bundle to `dist/` |

> **Mandatory Rule for Coding Agents**: Always run `node tests/verify_simulation.mjs && npm run build` after modifying any physics, rules, AI, UI, or Blender `.glb` assets to ensure zero regressions.

---

## 2. Codebase Architecture & Module Map

```text
pickleball/
├── AGENTS.md                       # AI Coding Agent, Blender MCP & Multi-Agent Architecture Guide
├── LICENSE                         # Permissive MIT License
├── README.md                       # Project documentation, controls, Nano Banana architecture & setup
├── index.html                      # Dual Live Scoreboards, Step-by-Step Coach HUD, Emotion PiP & Keycaps
├── public/assets/                  # Blender MCP procedurally generated & rigged 3D GLB assets
│   ├── court.glb                   # 20x44ft USAPA/BPL court, 7ft Kitchen, apron & 34"/36" parabolic net
│   ├── paddle.glb                  # 16.5"x7.5" 16mm honeycomb core + Vayu Aero T700 carbon-fiber paddle
│   ├── pickleball.glb              # 73.66mm USAPA outdoor ball with 40 circular aerodynamic holes
│   ├── player_male.glb             # Rigged male Indian athlete (Arjun) + 10 animations + 4 emotion morphs
│   └── player_female.glb           # Rigged female Indian athlete (Priya) + 10 animations + 4 emotion morphs
├── public/screenshots/             # Live 3200x1800 Ultra-HD renders & Nano Banana architecture diagram
│   ├── system_architecture.png     # End-to-end 3D simulation & AI system architecture diagram
│   ├── broadcast_view.png          # Ultra-HD broadcast center court view & scoreboards
│   ├── coaching_mode.png           # Interactive step-by-step Coaching Mode live drill
│   ├── doubles_match.png           # 2v2 championship doubles match in action
│   ├── athlete_closeup.png         # Close-up hero portrait of athlete & 3K carbon paddle
│   ├── kitchen_angle_lab.png       # Kitchen net cam & 40-hole paddle contact / spin lab
│   └── overhead_tactical.png       # Overhead tactical Hawkeye view
├── src/
│   ├── main.js                     # Three.js Ultra-HD WebGL2 (4x MSAA + 4K PBR + HDR Bloom), Trackpad & loop
│   ├── style.css                   # BPL TV broadcast HUD, Coach checklist & interactive keycap styling
│   ├── ai/PickleballAI.js          # Multi-agent tactical decision engine (Singles, Doubles partner/opponents, Coach)
│   ├── audio/SoundEngine.js        # Web Audio API spatial synthesis (paddle pop, shoe squeaks, crowd, referee)
│   ├── physics/PickleballPhysics.js# 240Hz sub-stepped 40-hole drag, Magnus spin lift & paddle angle solver
│   ├── rules/PickleballRules.js    # USAPA rule validator (Kitchen NVZ, Double-Bounce, 0-0-2 scoring, 5 lessons)
│   └── ui/CourtOverlays.js         # 3D holographic court overlays, trajectory arc & bounce rings
└── tests/
    └── verify_simulation.mjs       # Automated verification test suite
```

---

## 3. Branding & Copyright Guardrail (100% Original Indian Tour Identity)

- Maintain **zero third-party copyrighted trademarks or logos** across all 3D textures, canvas stencils, UI badges, and documentation.
- Use only the repository's original fictional Indian sports branding:
  - **League**: `BHARAT PICKLEBALL LEAGUE (BPL) • INDIA 2025` (Ashoka-Navy & Gold Diamond-Lotus crest)
  - **Equipment & Sponsors**: `BHARAT PRO`, `VAYU AERO`, `SURYA FIT INDIA`, `AGNI SPORT`, `GARUDA PRO INDIA`, `khel`, `DECCAN PRO`, `MUMBAI ARENA`, and `BHARATPICKLEBALL.IN`.

---

## 4. Blender MCP Agent Pipeline (`blender` MCP Server)

When using the connected **Blender MCP** server (`execute_blender_code`, `look`, `get_scene_info`) to modify or regenerate 3D assets in `public/assets/`, agents must adhere to the following contracts:

### 4.1 Coordinate & Scale Conventions
- **Units**: 1 Blender unit = 1 meter (`1 ft = 0.3048 m`).
- **Court Alignment**:
  - Net line is along the **X-axis** at `Z = 0` in Three.js (`Y = 0` in Blender before glTF `+Y Up` conversion).
  - Full court dimensions: **20 ft wide (`6.096 m`, `X ∈ [-3.048, +3.048]`)** × **44 ft long (`13.4112 m`, `Z ∈ [-6.7056, +6.7056]`)**.
  - **Non-Volley Zone ("The Kitchen")**: `7 ft (2.1336 m)` on each side of the net (`|Z| <= 2.1336 m`).
  - **Net Height**: `36 inches (0.9144 m)` at the sideline posts (`X = ±3.048 m`), sagging parabolically to **`34 inches (0.8636 m)`** at center (`X = 0`).

### 4.2 Human Athlete Rig, Animation & Emotion Contracts (`player_male.glb`, `player_female.glb`)
1. **Skeletal Bone Names** (required by `src/main.js` for paddle attachment, breathing & dynamic Face-Cam tracking):
   - Spine chain: `Root` → `Pelvis` → `Spine` → `Chest` → `Neck` → **`Head`** *(tracked dynamically in world space by `this.faceCamera`)*
   - Arms: `Shoulder.L/R` → `UpperArm.L/R` → `Forearm.L/R` → **`Hand.R`** *(3D `paddle.glb` attaches directly to `Hand.R` with origin `(0, 0, 0)` at the palm grip center)* and `Hand.L`
   - Legs: `Thigh.L/R` → `Shin.L/R` → `Foot.L/R`
2. **Required NLA Animation Tracks** (exported with `export_animation_mode='NLA_TRACKS'`):
   - `Idle_SplitStep` (looping wide-stance split-step ready bounce)
   - `Run_Footwork` (looping court footwork cycle)
   - `Serve_Underhand` (USAPA legal underhand pendulum serve below waist)
   - `Dink_Crosscourt` (deep knee bend + soft lifted kitchen dink)
   - `ThirdShot_Drop` (baseline-to-kitchen transition arc stroke)
   - `Volley_Kitchen` (compact punch volley at the NVZ line)
   - `Smash_Overhead` (leaping overhead put-away smash)
   - `Celebrate_FistPump` (full-body victory jump & double fist pump)
   - `Frustrated_Slump` (full-body head shake & hand-to-forehead slump on faults)
   - `Seated_Spectator` (seated VIP lounge spectator pose)
3. **Required Facial Emotion Shape Keys** (exported with `export_morph=True`):
   - `Basis`, `Celebration`, `Frustration`, `Effort`, `Surprise`
4. **Blender Namespace Note**:
   - Each call to `execute_blender_code` executes in an isolated Python dictionary namespace. Always define helper functions in the same script execution and export each character at origin `(0, 0, 0)` before translating them for viewport screenshots.

---

## 5. In-Game Multi-Agent AI & Step-by-Step Coach (`src/ai/PickleballAI.js` & `src/rules/PickleballRules.js`)

The simulation runs 4 autonomous/semi-autonomous court agents coordinated by `PickleballAI`:

| Agent ID | Athlete | Team | Role & Behavior |
| :--- | :--- | :--- | :--- |
| **`p0`** | **Arjun (You)** | Team 0 (Near, `+Z`) | Human-controlled player with **Trackpad Cursor Glide**, **480ms swing input buffer**, **Smart Auto-Shot**, and **Auto-Footwork Assist** respecting the Double-Bounce Rule and 7ft Kitchen line. |
| **`p1`** | **Priya (Partner)** | Team 0 (Near, `+Z`) | **Doubles Co-op AI Teammate**. Automatically serves when designated Server #1/#2, covers her half of the court, advances to the Kitchen line after Bounce #2, and executes third-shot drops or kitchen dinks. |
| **`p2`** | **Vikram (AI)** | Team 1 (Far, `-Z`) | Primary AI Opponent in **Singles (1v1)** and **Doubles (2v2)**, and interactive **Coach Vikram** in **Training Coach Mode**. |
| **`p3`** | **Ananya (AI)** | Team 1 (Far, `-Z`) | Doubles AI Opponent Partner in **Doubles (2v2)**. |

### Interactive 5-Lesson Coaching Contract (`PickleballRules.js`)
- Each lesson in `this.lessons` defines `id`, `title`, `subtitle`, `description`, `goalTarget`, `steps` (`1️⃣`, `2️⃣`, `3️⃣` plain-English live checklist), `recommendedShot`, and `recommendedKey`.
- Lesson 1 (`kitchen_dink`) positions `p0` and `p2` directly behind their respective 7-foot Kitchen lines (`|Z| = 2.28 m`) and allows 1-Tap Trackpad / `SPACE` / `#btn-coach-feed` to immediately launch a soft Kitchen Dink drill without requiring a baseline serve.

---

## 6. Ultra-HD Rendering, Physics & UI Guidelines

- **Ultra-HD 4K PBR & 4x MSAA Pipeline (`src/main.js`)**:
  - Super-sampled DPR (`up to 2.5x`, toggleable via `#btn-toggle-hd`), `HalfFloatType` 4x MSAA `EffectComposer` + HDR `UnrealBloomPass` (`threshold: 1.24`, `strength: 0.08`) + `OutputPass`, `4096×6144` acrylic clearcoat court + tangent silica-sand normal map, `2048×2048` skin subsurface sheen, and `3K` carbon-twill / pique jersey normal maps.
- **240Hz Sub-Stepped Aerodynamics (`src/physics/PickleballPhysics.js`)**:
  - Models a `26 g`, `73.66 mm` USAPA 40-hole hollow pickleball with drag coefficient $C_d = 0.44$ and Magnus lift coefficient $C_L = 0.21$.
  - Explicit paddle contact normal $\mathbf{n}$ is computed from `facePitchDeg` (`Q`/`E`), `faceYawDeg` (`Z`/`C` or 2-finger horizontal scroll), and `brushAngleDeg` (`R`/`F` or 2-finger vertical scroll) for topspin (`+RPM`) or backspin slice (`-RPM`).
- **UI & Dialog Standards**:
  - The USAPA Rules modal (`<dialog id="rules-modal" closedby="any">`) uses declarative light-dismiss with a feature-detected backdrop click fallback in `initModalFallback()`.
