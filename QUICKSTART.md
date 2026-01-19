# Codenames Quickstart Guide

Get from zero to playing your first game in minutes. This guide covers three deployment options and walks you through a complete game.

## Choose Your Path

| Option | Time | Best For | Requirements |
|--------|------|----------|--------------|
| **A. Standalone** | 1 min | Quick demo, single-screen play | Browser only |
| **B. Docker** | 5 min | Local multiplayer, development | Docker Desktop |
| **C. Cloud** | 10 min | Permanent URL, play anywhere | Fly.io account |

---

## Option A: Standalone (1 Minute)

The simplest way to play - no server needed. Game state is encoded in the URL.

### Steps

1. **Open the game**
   ```
   Open index.html in your browser (double-click the file)
   ```

2. **Start a game**
   - Click **"New Game"**
   - Copy the URL from your browser's address bar

3. **Share with players**
   - Share your screen via Zoom/Meet
   - Send the game URL to all players via chat
   - Each player opens the URL in their own browser

That's it! Players select their roles and you're ready to play.

> **Tip:** If double-clicking doesn't work, serve the file locally:
> ```bash
> python -m http.server 8000
> # Then open http://localhost:8000
> ```

---

## Option B: Docker (5 Minutes)

Run a real-time multiplayer server locally. All players connect to the same server and see updates instantly - no URL sharing needed.

### Prerequisites

- [Docker Desktop](https://www.docker.com/products/docker-desktop/) installed and running

### Steps

1. **Clone the repository** (if you haven't already)
   ```bash
   git clone https://github.com/jgreid/Risley-Codenames.git
   cd Risley-Codenames
   ```

2. **Start the server**
   ```bash
   cd server
   docker compose up -d --build
   ```

   **Windows users:** Just double-click `server/start-server.bat`

3. **Wait for startup** (~30 seconds first time)
   ```bash
   docker compose logs -f api
   ```
   Look for: `Server listening on port 3000`

   Press `Ctrl+C` to stop watching logs.

4. **Open the game**
   ```
   http://localhost:3000
   ```

5. **Share with local players**
   - Find your computer's local IP address:
     - **Windows:** `ipconfig` (look for IPv4 Address)
     - **Mac/Linux:** `ifconfig` or `ip addr`
   - Share: `http://YOUR_IP:3000` (e.g., `http://192.168.1.100:3000`)
   - Players on the same network can connect directly

### Stopping the Server

```bash
docker compose down
```

Or double-click `server/stop-server.bat` on Windows.

---

## Option C: Cloud Deployment (10 Minutes)

Deploy to Fly.io for a permanent URL accessible from anywhere. Free for typical usage.

### Prerequisites

- Credit card (for Fly.io verification - you won't be charged)

### Steps

1. **Install Fly CLI**

   **Windows (PowerShell as Admin):**
   ```powershell
   powershell -Command "iwr https://fly.io/install.ps1 -useb | iex"
   ```

   **Mac/Linux:**
   ```bash
   curl -L https://fly.io/install.sh | sh
   ```

   Close and reopen your terminal, then verify:
   ```bash
   fly version
   ```

2. **Create account and login**
   ```bash
   fly auth signup
   ```
   This opens a browser. Create your account and add a payment method.

3. **Deploy the app**
   ```bash
   cd server
   fly launch
   ```

   **Answer the prompts:**
   | Prompt | Answer |
   |--------|--------|
   | Copy configuration? | **Yes** |
   | App name | Press Enter (or choose your own) |
   | Region | Press Enter (default is fine) |
   | Set up PostgreSQL? | **Yes** → Select **Development** |
   | Set up Redis? | **Yes** → Select **Free** |

4. **Configure database connection**
   ```bash
   fly secrets set DATABASE_DIRECT_URL="$(fly postgres config show -a YOUR-APP-NAME-db --format=json | jq -r '.direct_url')"
   ```
   Replace `YOUR-APP-NAME-db` with your actual database app name (shown during launch).

5. **Deploy**
   ```bash
   fly deploy
   ```
   Wait 2-3 minutes for the build to complete.

6. **Open your game**
   ```bash
   fly open
   ```

Your game is now live at `https://YOUR-APP-NAME.fly.dev` - share this link with anyone to play!

### Costs

Everything runs on free tiers:
- **App:** Free (includes $5/month credit)
- **PostgreSQL:** Free (Development tier)
- **Redis:** Free (Upstash free tier)

**Total: $0/month** for typical usage

---

## Playing Your First Game

Now that your server is running, here's how to play a complete game.

### Step 1: Create a Room

1. Open the game in your browser
2. Enter a nickname and click **"Create Room"**
3. You'll get a 6-character room code (e.g., `ABC123`)

### Step 2: Invite Players

Share the room code with your friends. They can:
- Go to the same URL and click **"Join Room"**
- Enter the room code

You need at least 4 players for a proper game:
- 2 Spymasters (one per team)
- 2+ Guessers (at least one per team)

### Step 3: Assign Teams and Roles

Each player should:

1. **Pick a team:** Click **"Red Team"** or **"Blue Team"**
2. **Pick a role:**
   - **Spymaster:** Sees the key (which words belong to which team). Gives clues.
   - **Guesser:** Tries to guess words based on clues. Can't see the key.
   - **Spectator:** Just watches.

**Important:** Each team needs exactly one Spymaster!

### Step 4: Start the Game

Once everyone has joined and picked roles:
- The **Host** (room creator) clicks **"Start Game"**
- A 5x5 grid of word cards appears

### Step 5: Understand the Board

| Card Color | Meaning | Count |
|------------|---------|-------|
| **Red** | Red team's words | 8 or 9 |
| **Blue** | Blue team's words | 8 or 9 |
| **Beige** | Neutral (no points) | 7 |
| **Black** | Assassin (instant loss!) | 1 |

The team going first has 9 words to find; the other team has 8.

### Step 6: Play!

**Spymaster's Turn:**
1. Look at the key to see which words belong to your team
2. Think of a one-word clue that connects multiple words
3. Say your clue and how many words it relates to
   - Example: *"Ocean: 3"* (three words relate to "ocean")

**Guessers' Turn:**
1. Discuss which words might match the clue
2. Click a card to reveal it:
   - **Your color:** Correct! You can keep guessing (up to clue number + 1)
   - **Neutral (beige):** Turn ends
   - **Opponent's color:** Turn ends, they get a point
   - **Assassin (black):** Game over - you lose!
3. Click **"End Turn"** when done guessing

### Step 7: Win!

First team to find all their words wins!

Or if a team clicks the Assassin, they instantly lose.

---

## Tips for New Players

### For Spymasters

- Your clue must be **one word only**
- Don't use forms of words on the board (if "WATER" is on the board, don't say "watery")
- The number tells your team how many cards relate to your clue
- Say "unlimited" if you want them to guess as many as they like

### For Guessers

- Discuss with your team before guessing
- You can always make one more guess than the number given
- Be careful near the Assassin - if you're unsure, end your turn
- Pay attention to previous clues - they might still be relevant!

### General Tips

- The first team has 9 words; the second team has 8
- Neutral cards end your turn but don't help the opponent
- It's often better to end your turn early than risk hitting the Assassin

---

## Troubleshooting

| Problem | Solution |
|---------|----------|
| Can't connect to server | Make sure Docker is running: `docker compose ps` |
| "Room not found" | Room codes expire after 24 hours. Create a new room. |
| Cards don't respond to clicks | Only the Host can click cards. |
| Can't see spymaster view | Make sure you selected Spymaster role before the game started. |
| Players can't join remotely (Docker) | They need to be on the same network, or use Fly.io for internet access. |

---

## Next Steps

- **Custom Word Lists:** Create themed games with your own words. See [README.md](README.md#custom-word-lists)
- **Color-Blind Mode:** Enable shapes for accessibility. See [README.md](README.md#color-blind-mode)
- **Advanced Configuration:** See [server/README.md](server/README.md) for all options
- **API Documentation:** See [docs/SERVER_SPEC.md](docs/SERVER_SPEC.md) for WebSocket events

---

## Quick Reference

### Docker Commands

```bash
docker compose up -d --build   # Start server
docker compose down            # Stop server
docker compose logs -f api     # View logs
docker compose ps              # Check status
```

### Fly.io Commands

```bash
fly open                       # Open your game
fly logs                       # View server logs
fly status                     # Check app status
fly deploy                     # Deploy updates
fly apps restart               # Restart server
```

---

Happy playing! If you run into issues, check the [Troubleshooting](#troubleshooting) section or open an issue on GitHub.
