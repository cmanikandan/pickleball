# PPA Tour 3D Pickleball Simulator & Interactive USAPA Rule Trainer

A realistic 3D WebGL Pickleball simulation game and interactive USAPA rule trainer built with **Three.js**, **Web Audio API**, and **Blender MCP** procedurally generated 3D assets.

## Features

- **Lifelike Rigged 3D Human Athletes & Emotions (`public/assets/player_male.glb`, `player_female.glb`)**:
  - Male (`Arjun`) and Female (`Priya`) Indian athletes modeled and rigged via Blender MCP with 9 skeletal animations (`Idle_SplitStep`, `Serve_Underhand`, `Dink_Crosscourt`, `ThirdShot_Drop`, `Volley_Kitchen`, `Smash_Overhead`, `Run_Footwork`, `Celebrate_FistPump`, `Frustrated_Slump`) and 4 facial emotion Shape Keys (`Celebration`, `Frustration`, `Effort`, `Surprise`).
  - **Live 3D Human Emotion Cam (PiP)**: Real-time portrait camera rendered in the top-right broadcast HUD showing live facial expressions and emotional reactions.
- **USAPA-Standard 3D Equipment & Outdoor Stadium (`court.glb`, `paddle.glb`, `pickleball.glb`)**:
  - 20x44 ft USAPA court with 7-foot Non-Volley Zone ("The Kitchen"), parabolic 34-inch center / 36-inch sideline net mesh, polypropylene honeycomb T700 carbon paddles, and a 40-hole outdoor pickleball inside a sunlit stadium with cheering 3D spectators.
- **Game Modes**:
  - **Training Coach Mode**: 5 interactive lessons covering the Non-Volley Zone (Kitchen), Legal Underhand Serve, the Double-Bounce Rule, `0-0-2` Side-Out Scoring, and the 40-Hole Spin & Angle Lab.
  - **Singles (1v1)** & **Doubles (2v2)** with state-driven AI partner and opponents.
- **240Hz Sub-Stepped 40-Hole Aerodynamics & Magnus Spin Physics (`src/physics/PickleballPhysics.js`)**:
  - Explicit paddle contact pitch, yaw, and brush angle solver for topspin drives, backspin slices, crosscourt dinks, and third-shot drops.
- **On-Screen Contextual Key Prompts & Interactive Keycap HUD**:
  - Dynamically displays what keys to hit at every stage of the rally with interactive visual keycaps (`WASD`, `1–6`, `SPACE`, `Q/E`, `R/F`).

## Quick Start

```bash
npm install
npm run dev
```

Run automated verification tests:

```bash
npm test
```
