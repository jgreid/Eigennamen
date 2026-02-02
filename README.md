# Codenames Online

A web-based implementation of the popular board game Codenames, optimized for remote play over Zoom or other video conferencing platforms.

## Features

- **Real-time multiplayer** - Server provides synchronized game state across all players via WebSockets
- **Role system** - Support for Host, Spymaster, Clicker, and Spectator roles
- **Custom word lists** - Use your own themed word lists
- **Responsive design** - Works on desktop and mobile devices
- **Keyboard accessible** - Full keyboard navigation support
- **Color-blind friendly** - Optional mode adds shapes to distinguish card types

## Quick Start

**New to Codenames?** Check out the [Complete Quickstart Guide](QUICKSTART.md) for step-by-step instructions including your first game walkthrough.

### Option 1: Docker (Recommended)

```bash
cd server
docker compose up -d --build
```

Then open `http://localhost:3000` in your browser. All players connect to the same server and see updates instantly.

### Option 2: Without Docker

```bash
cd server
npm install
REDIS_URL=memory npm run dev
```

Then open `http://localhost:3000` in your browser.

### Option 3: Cloud Deployment

Deploy to Fly.io for a permanent URL. See [Deployment Guide](docs/DEPLOYMENT.md).

**Setup Guides:**
- [Server README](server/README.md) - Detailed setup instructions
- [Windows Setup Guide](docs/WINDOWS_SETUP.md) - Step-by-step guide for Windows users

## How to Play

### Game Setup

1. **Host** creates a room and shares the room code with all players
2. **Everyone** joins the room using the code
3. **Each team** selects one Spymaster and one Clicker
4. **Host** clicks "Start Game"

### Teams and Roles

Players first join a team, then pick a role:

**Team Affiliation:**
- **Red Team** or **Blue Team** - Join a team to participate in discussions
- **Unaffiliated** - Watch the game without being on a team

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
   - **Team's color** - Correct! Keep guessing (up to the number given + 1)
   - **Neutral (beige)** - Turn ends
   - **Opponent's color** - Turn ends, opponent gets a point
   - **Assassin (black)** - Game over! The team that picked it loses instantly
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
4. Start a **New Game** - your custom words will be included in the game link

### Requirements

- Minimum **25 words** (the game needs exactly 25 for each board)
- Recommended **50+ words** for better variety between games
- Words are automatically converted to uppercase

## Customizing Team Names

1. Click **Settings**
2. Enter custom team names (e.g., "Engineers" vs "Marketing")
3. Click **Save & Apply**
4. Team names are synced to all players in the room

## Accessibility

### Color-Blind Mode

For players with color vision deficiency, the game offers a color-blind friendly mode that adds shapes to cards:

| Color | Shape |
|-------|-------|
| Red | ■ Square |
| Blue | ● Circle |
| Neutral | ─ Line |
| Assassin | ✕ X |

To enable:
1. Click **Settings**
2. Check **"Color-blind friendly mode"**
3. Click **Save & Apply**

This setting is saved locally and persists across sessions.

### Keyboard Navigation

All cards can be navigated and selected using the keyboard:
- **Tab** - Move between cards
- **Enter** or **Space** - Reveal the focused card (clicker only, during their team's turn)

## Troubleshooting

| Problem | Solution |
|---------|----------|
| Cards don't respond to clicks | Make sure you've clicked a "Clicker" button for your team. Only the current team's clicker can click cards. |
| Can't connect to server | Make sure the server is running. Check `http://localhost:3000/health` for status. |
| Can't see spymaster view | Click "Red Spymaster" or "Blue Spymaster" button. You'll see colored outlines and dots on cards showing their true types. |
| Game state not syncing | Check server connection. Players should see a green connection indicator. Try refreshing the page. |

## Browser Support

Works in all modern browsers:
- Chrome / Edge (Chromium)
- Firefox
- Safari
- Mobile browsers (iOS Safari, Chrome for Android)

## License

This project is licensed under the GNU General Public License v3.0. See the [LICENSE](LICENSE) file for details.

## Contributing

Contributions are welcome! Please feel free to submit issues or pull requests.

---

*Codenames is a trademark of Czech Games Edition. This is an unofficial fan-made implementation for personal use.*
