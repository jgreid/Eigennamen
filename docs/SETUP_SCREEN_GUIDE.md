# Setup Screen Quick Start Guide

A step-by-step walkthrough of the game's launch screen for new users.

---

## What You'll See

When you first open Eigennamen Online, you'll land on the **Setup Screen** — a 5×5 board-style grid with three action cards in the center:

```
┌─────────────────────────────────────────┐
│           Eigennamen Online             │
│                                         │
│   ┌───────┐  ┌───────┐  ┌───────┐     │
│   │ HOST  │  │ JOIN  │  │ LOCAL  │     │
│   │a Game │  │a Game │  │  ▶    │     │
│   └───────┘  └───────┘  └───────┘     │
│                                         │
└─────────────────────────────────────────┘
```

| Card | What it does |
|------|-------------|
| **Host a Game** | Create a new multiplayer room |
| **Join a Game** | Enter a room code to join someone else's game |
| **Play Local** | Start an offline standalone game instantly |

---

## Path 1: Host a Game

Use this when you want to create a new game room for others to join.

### Steps

1. Click the **"Host a Game"** card
2. Fill in the host form:

   | Field | Required? | Description |
   |-------|-----------|-------------|
   | **Nickname** | Yes | Your display name (2–30 characters) |
   | **Room ID** | No | Custom room code, or leave blank for auto-generated |
   | **Game Mode** | Yes | Classic, Duet, or Match (default: Match) |
   | **Turn Timer** | No | Toggle on to set a per-turn time limit (30–300 seconds) |
   | **Red Team Name** | No | Custom name for the red team (default: "Red") |
   | **Blue Team Name** | No | Custom name for the blue team (default: "Blue") |

3. Click **"Create Room"**
4. You'll be taken to the game lobby — share your room code with players

### Tips

- Your nickname is remembered for next time
- The game mode and timer are set at room creation and apply to all players
- You can change team names later from the game settings

---

## Path 2: Join a Game

Use this when someone has shared a room code with you.

### Steps

1. Click the **"Join a Game"** card
2. Fill in the join form:

   | Field | Required? | Description |
   |-------|-----------|-------------|
   | **Nickname** | Yes | Your display name (2–30 characters) |
   | **Room Code** | Yes | The code shared by the host |

3. Click **"Join Room"**
4. You'll enter the game lobby and can pick your team and role

### Tips

- Room codes are case-insensitive
- If the URL already contains a room code (e.g., from a shared link), it will be pre-filled
- Your nickname is remembered for next time

---

## Path 3: Play Local

Use this for a quick offline game — no server or room code needed.

### Steps

1. Click the **"Play Local"** card
2. A standalone game starts immediately with a random board
3. All game state is encoded in the URL — share it with others to play on the same board

### Tips

- Local mode works entirely offline (no internet required)
- Share the URL to let others see the same board
- Great for practice or single-screen play

---

## Returning to the Setup Screen

If you need to get back to the setup screen:

- **From the game board**: The setup screen appears automatically when you first load the page
- **After leaving a room**: You'll be returned to the setup screen
- **Direct URL**: Navigate to the root URL without any room code parameters

---

## Keyboard Navigation

The setup screen is fully keyboard-accessible:

| Key | Action |
|-----|--------|
| **Tab** | Move between cards and form fields |
| **Enter** | Activate the focused card or submit a form |
| **Escape** | Go back from a form to the main card view |

---

## Troubleshooting

| Issue | Solution |
|-------|---------|
| "Room not found" when joining | Double-check the room code. Rooms expire after 24 hours. |
| "Nickname is required" error | Enter a nickname between 2 and 30 characters. |
| Can't see the setup screen | Clear your browser cache or open in a private/incognito window. |
| Local mode doesn't start | Make sure JavaScript is enabled in your browser. |

---

## What Happens Next?

After hosting or joining, you'll be in the **game lobby** where you can:

1. **Pick a team** — Join Red or Blue
2. **Pick a role** — Spymaster, Clicker, or Spectator
3. **Wait for the host to start** — The host clicks "Start Game" when everyone is ready

See the [full Quickstart Guide](../QUICKSTART.md#playing-your-first-game) for gameplay instructions.
