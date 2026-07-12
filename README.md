# Eigennamen Online

A web-based implementation of the popular board game Eigennamen, optimized for remote play over video conferencing or direct online multiplayer.

**Version:** v5.11.0 | **License:** GPL v3.0

## Features

- **Standalone or multiplayer** — Works offline with URL-based state or with real-time server
- **Three game modes** — Classic, Duet (cooperative 2-player), Match (competitive multi-round scoring)
- **AI bot opponents** — Host-managed bots fill spymaster, clicker, and advisor seats across a five-rung difficulty ladder and six playstyle personae. The semantic spymaster/guesser runs on an offline association table or optional word embeddings (including a wide tier that understands rare "word-nerd" clues), speaks the clue-capitalization house rule, supports custom lists via prepared semantic maps, and can optionally consult Claude (`BOT_LLM_MODEL`) with deterministic safety verification
- **Real-time multiplayer** — Synchronized game state via Socket.io with reconnection support
- **URL-based game sharing** — All game state encoded in the URL for easy sharing
- **Custom word lists** — Use your own themed word lists (with optional database persistence)
- **Internationalization** — English, German, Spanish, French with localized word lists
- **Game history & replay** — Watch previous games with speed control (0.5x–4x)
- **Turn timer** — Configurable timer with pause, resume, and add-time
- **Spectator mode** — Watch games with join requests and team switching
- **Admin dashboard** — Room management, audit logs, metrics, broadcast messaging
- **Responsive design** — Works on desktop and mobile devices
- **Keyboard accessible** — Full keyboard navigation with shortcuts (n/e/s/m/h/?)
- **Color-blind friendly** — SVG patterns distinguish card types
- **QR code sharing** — Share room codes via QR code
- **PWA support** — Installable as a Progressive Web App

## Quick Start

**New to Eigennamen?** Check out the [Complete Quickstart Guide](QUICKSTART.md) for step-by-step instructions including your first game walkthrough.

### Option 1: Run the standalone app (no backend)

The standalone build lives in `server/public/` — `index.html` plus its JS/CSS/icons. Serve that directory and open it:

```bash
cd server/public

# Using Python 3
python -m http.server 8000

# ...or Node.js (npx serve), or PHP (php -S localhost:8000)
```

Then open `http://localhost:8000`. Game state is encoded entirely in the URL, so no backend or Redis is needed — share the URL to share the game.

> **Note:** opening `index.html` straight from the filesystem (`file://`) does **not** work. The page loads its assets by absolute path (`/js/...`, `/css/...`), which only resolve when `server/public/` is the web root.

### Option 2: Host online

Deploy the contents of `server/public/` to any static host (GitHub Pages, Netlify, your own server) so the absolute asset paths resolve from the site root.

### Option 3: Real-time multiplayer server

For true real-time synchronization without URL sharing, run the multiplayer server. All players connect to the same server and see updates instantly at `http://localhost:3000`.

#### Recommended: Docker (same on every OS, no Redis to install)

Docker brings its own Redis, so this is the most reliable path — especially on Windows. First create the `.env` Docker reads its secrets from, then start. From the **repository root**:

```bash
cp .env.example .env      # then edit .env: set REDIS_PASSWORD + JWT_SECRET (32+ chars)
docker compose up -d --build
```

> Without the `.env`, the build stops with `required variable REDIS_PASSWORD is missing a value`.
>
> **Windows:** just double-click `server/start-server.bat` — it auto-creates `.env` with random secrets, starts Docker, and launches the server. See the [Windows Setup Guide](docs/WINDOWS_SETUP.md).

#### Without Docker (Node.js 22+ and a Redis binary)

All `npm` commands run from `server/` — that's where `package.json` is. Running `npm install` from the repo root fails with `Could not read package.json`.

```bash
cd server
npm install
REDIS_URL=memory npm run dev      # macOS / Linux / Git Bash
```

> ⚠️ **`REDIS_URL=memory` is not "no Redis."** It spawns a temporary, no-persistence Redis for you, which still needs a `redis-server` **binary on your PATH** (`brew install redis` on macOS, `sudo apt install redis-server` on Linux). **Windows has no native `redis-server`** — use Docker above, or run Redis via [Memurai](https://www.memurai.com/) / WSL2 and point `REDIS_URL` at it (e.g. `redis://127.0.0.1:6379`).

Setting the variable depends on your shell:

| Shell | Command |
|-------|---------|
| **PowerShell** (`PS C:\>`) | `$env:REDIS_URL="memory"; npm run dev` |
| **cmd.exe** (`C:\>`) | `set REDIS_URL=memory && npm run dev` |
| **Bash / zsh** (macOS, Linux, Git Bash, WSL) | `REDIS_URL=memory npm run dev` |

**Setup Guides:**
- [Server README](server/README.md) — Detailed setup instructions
- [Windows Setup Guide](docs/WINDOWS_SETUP.md) — Step-by-step guide for Windows users
- [Deployment Guide](docs/DEPLOYMENT.md) — Production deployment options

## How to Play

### Game Setup

When you first open the game, you'll see the **Setup Screen** with three options:

1. **Host a Game** — Create a new multiplayer room (enter nickname, choose game mode, click "Create Room")
2. **Join a Game** — Enter a room code and nickname to join an existing game
3. **Play Local** — Start an offline standalone game immediately

For multiplayer:
1. **Host** clicks "Host a Game" and creates a room
2. **Host** shares the room code with all players
3. **Players** click "Join a Game", enter the code, and join
4. **Each team** selects one Spymaster and one Clicker

### Teams and Roles

Players first join a team, then pick a role:

**Team Affiliation:**
- **Red Team** or **Blue Team** — Join a team to participate in discussions
- **Unaffiliated** — Watch the game without being on a team

**Roles (one per team):**

| Role | What they do |
|------|--------------|
| **Host** | Creates the game and manages game flow. One person per room. Can be on a team. |
| **Spymaster** | Sees the key showing which words belong to which team. Gives clues. Cannot click cards. One per team. |
| **Clicker** | Clicks cards to reveal guesses and can end their team's turn. One per team. |
| **Team Member** | Discusses guesses with their team. Can become spymaster or clicker. |
| **Spectator** | Watches without team affiliation. Default when joining. |

### Gameplay

1. The team that goes first (shown in the turn indicator) has **9 words** to find; the other team has **8 words**
2. The **Spymaster** gives a one-word clue and a number (e.g., "Animals: 3")
3. The number indicates how many words on the board relate to the clue
4. **Team members** discuss and agree on guesses
5. The **Clicker** clicks the guessed card to reveal it:
   - **Team's color** — Correct! Keep guessing (up to the number given + 1)
   - **Neutral (beige)** — Turn ends
   - **Opponent's color** — Turn ends, opponent gets a point
   - **Assassin (black)** — Game over! The team that picked it loses instantly
6. The **Clicker** clicks **"End Turn"** when their team is done guessing
7. First team to find all their words wins!

### Tips for Spymasters

- Your clue must be **one word only**
- You **cannot** give clues that are forms of the words on the board
- The number tells your team how many cards relate to the clue
- Say "unlimited" if you want them to keep guessing without a specific count

### Clue Capitalization (house rule)

The capitalization of your clue is preserved exactly as you type it, which
enables a popular house rule: **capitalize a clue to mean the specific proper
noun, lowercase it to mean the common sense**.

- `Alien` → the movie *Alien* (space, the ship, the crew…)
- `alien` → anything foreign or otherworldly
- `Cinderella` → glass slipper + princess + royal ball, all in one image

This makes clues far more specific and granular, especially for pop-culture
references — just remember a reference is only a good clue if your guessers
actually know it. The AI bots understand and play the convention: bot
spymasters will give capitalized reference clues (curated for widely-known
references — the cautious personae stick to household names, The Maverick
reaches deeper), and bot clickers/advisors read a capitalized clue as the
reference and a lowercase clue as the common sense. All-caps clues carry no
signal and are read both ways, so nothing changes if your group ignores the
rule.

## Custom Word Lists

### Using the Settings Menu

1. Click **Settings** in the game
2. Enter your custom words (one per line) in the text area
3. Click **Save & Apply**
4. Start a **New Game** — your custom words will be included in the game link

This works the same way in a hosted multiplayer room: whichever list is active
in the host's Settings menu when they start (or restart) the game is the list
everyone plays with.

### Using a wordlist.txt File

1. Create a file named `wordlist.txt` in the same folder as `index.html`
2. Add your words, one per line
3. Lines starting with `#` are treated as comments
4. Refresh the page — your word list will be loaded automatically

Example `wordlist.txt`:
```
# Movie Theme
HOBBIT
AVENGERS
BATMAN
FROZEN
# ... at least 25 words total
```

### Requirements

- Minimum **25 words** (the game needs exactly 25 for each board)
- Recommended **50+ words** for better variety between games
- Words are automatically converted to uppercase

### Playing with AI bots on a custom list

Out of the box, the AI bots only carry semantic knowledge for the default word
list — on a custom list their clues degrade to letter-pattern similarity. To
get full-strength bots, prepare the list in advance by building a **semantic
map** for it (an LLM curates concept groups and pop-culture references over
your exact words):

```bash
cd server
npm run bots:map -- --words path/to/my-list.txt
```

Drop-in and restart — see [docs/BOT_SEMANTIC_MAPS.md](docs/BOT_SEMANTIC_MAPS.md)
for details. Unprepared lists still work; the bots just play far below their
potential on them.

## Customizing Team Names

1. Click **Settings**
2. Enter custom team names (e.g., "Engineers" vs "Marketing")
3. Click **Save & Apply**
4. Team names are included in the game link, so all players see them

## Accessibility

### Color-Blind Mode

For players with color vision deficiency, the game offers a color-blind friendly mode that adds SVG patterns to cards:

| Color | Pattern |
|-------|---------|
| Red | Diagonal lines |
| Blue | Dot pattern |
| Neutral | No pattern |
| Assassin | Cross pattern |

To enable:
1. Click **Settings**
2. Check **"Color-blind friendly mode"**
3. Click **Save & Apply**

This setting is saved locally and persists across sessions.

### Keyboard Navigation

| Key | Action |
|-----|--------|
| **Tab** | Move between UI elements |
| **Arrow keys** | Navigate between cards on the board |
| **Enter/Space** | Reveal the focused card (clicker only) |
| **n** | New Game |
| **e** | End Turn |
| **s** | Settings |
| **m** | Multiplayer |
| **h** | Game History |
| **?** | Show keyboard shortcuts |
| **Escape** | Close modal |

## Troubleshooting

| Problem | Solution |
|---------|----------|
| Cards don't respond to clicks | Make sure you've clicked a "Clicker" button for your team. Only the current team's clicker can click cards. |
| Game link is very long | This happens with custom words. The words are encoded in the URL. Most browsers support URLs up to 2000+ characters. |
| Can't see spymaster view | Click "Red Spymaster" or "Blue Spymaster" button. You'll see colored outlines and dots on cards showing their true types. |
| Game state not syncing | Make sure everyone has the latest URL. The host should re-share the link after any changes. |

## Browser Support

Works in all modern browsers:
- Chrome / Edge (Chromium)
- Firefox
- Safari 15+
- Mobile browsers (iOS Safari, Chrome for Android)

## Documentation

| Document | Purpose |
|----------|---------|
| [QUICKSTART.md](QUICKSTART.md) | Getting started guide with first game walkthrough |
| [docs/SETUP_SCREEN_GUIDE.md](docs/SETUP_SCREEN_GUIDE.md) | Step-by-step guide for the launch screen |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Contributor guidelines, code standards, PR process |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | System architecture diagrams and decisions |
| [docs/SERVER_SPEC.md](docs/SERVER_SPEC.md) | API specification (REST + WebSocket) |
| [docs/TESTING_GUIDE.md](docs/TESTING_GUIDE.md) | Testing documentation and patterns |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | Deployment guide (Docker, Fly.io, Heroku, K8s) |
| [docs/BACKUP_AND_DR.md](docs/BACKUP_AND_DR.md) | Backup strategy and disaster recovery |
| [docs/INTELLIGENT_BOTS_SPEC.md](docs/INTELLIGENT_BOTS_SPEC.md) | AI bot design spec (engine, strategies, semantics) |
| [docs/BOT_EMBEDDINGS.md](docs/BOT_EMBEDDINGS.md) | Optional word-embedding backend for bots |
| [docs/BOT_SEMANTIC_MAPS.md](docs/BOT_SEMANTIC_MAPS.md) | Prepared semantic maps for full-strength bots on custom word lists |
| [docs/BOT_LLM.md](docs/BOT_LLM.md) | Opt-in LLM-backed bot advice (Claude proposes, machinery verifies) |
| [server/README.md](server/README.md) | Server setup and configuration |

## License

This project is licensed under the GNU General Public License v3.0. See the [LICENSE](LICENSE) file for details.

## Contributing

Contributions are welcome! See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines on code standards, testing requirements, and the pull request process.

---

*Eigennamen is a trademark of Czech Games Edition. This is an unofficial fan-made implementation for personal use.*
