# Die Eigennamen — Codenames Online

A web-based implementation of the popular board game Codenames, optimized for remote play over video conferencing or direct online multiplayer.

**Version:** v2.2.0 | **License:** GPL v3.0 | **Tests:** 2,664+

## Features

- **Standalone or multiplayer** — Works offline with URL-based state or with real-time server
- **Three game modes** — Classic, Blitz (30s turns), Duet (cooperative 2-player)
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

**New to Codenames?** Check out the [Complete Quickstart Guide](QUICKSTART.md) for step-by-step instructions including your first game walkthrough.

### Option 1: Open directly

1. Download `index.html` to your computer
2. Double-click to open in any modern web browser
3. Share your screen and the game link with friends!

### Option 2: Serve locally

If opening directly doesn't work (some browsers restrict local file access), use a simple HTTP server:

```bash
# Using Python 3
python -m http.server 8000

# Using Node.js (npx)
npx serve

# Using PHP
php -S localhost:8000
```

Then open `http://localhost:8000` in your browser.

### Option 3: Host online

Upload `index.html` (and optionally `wordlist.txt`) to any web hosting service like GitHub Pages, Netlify, or your own server.

### Option 4: Real-time multiplayer server

For true real-time synchronization without URL sharing, use the multiplayer server:

```bash
# With Docker (recommended)
docker compose up -d --build

# Without Docker (uses in-memory storage)
cd server && npm install && REDIS_URL=memory npm run dev
```

Then open `http://localhost:3000` in your browser. All players connect to the same server and see updates instantly.

**Setup Guides:**
- [Server README](server/README.md) — Detailed setup instructions
- [Windows Setup Guide](docs/WINDOWS_SETUP.md) — Step-by-step guide for Windows users
- [Deployment Guide](docs/DEPLOYMENT.md) — Production deployment options

## How to Play

### Game Setup

1. **Host** opens the game and clicks "New Game"
2. **Host** copies the game link and shares it with all players
3. **Everyone** opens the link in their own browser
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

## Custom Word Lists

### Using the Settings Menu

1. Click **Settings** in the game
2. Enter your custom words (one per line) in the text area
3. Click **Save & Apply**
4. Start a **New Game** — your custom words will be included in the game link

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
| [ROADMAP.md](ROADMAP.md) | Development roadmap, remaining work, test metrics |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Contributor guidelines, code standards, PR process |
| [CODEBASE_REVIEW.md](CODEBASE_REVIEW.md) | Comprehensive code review with development plan |
| [FUTURE_PLAN.md](FUTURE_PLAN.md) | Future development phases and feature plans |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | System architecture diagrams and decisions |
| [docs/SERVER_SPEC.md](docs/SERVER_SPEC.md) | API specification (REST + WebSocket) |
| [docs/TESTING_GUIDE.md](docs/TESTING_GUIDE.md) | Testing documentation and patterns |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | Deployment guide (Docker, Fly.io, Heroku, K8s) |
| [server/README.md](server/README.md) | Server setup and configuration |

## License

This project is licensed under the GNU General Public License v3.0. See the [LICENSE](LICENSE) file for details.

## Contributing

Contributions are welcome! See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines on code standards, testing requirements, and the pull request process.

---

*Codenames is a trademark of Czech Games Edition. This is an unofficial fan-made implementation for personal use.*
