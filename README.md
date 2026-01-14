# Codenames Online

A web-based implementation of the popular board game Codenames, optimized for remote play over Zoom or other video conferencing platforms.

## Features

- **No server required** - Runs entirely in the browser with no backend
- **URL-based game sharing** - All game state is encoded in the URL for easy sharing
- **Role system** - Support for Host, Spymaster, and Viewer roles
- **Custom word lists** - Use your own themed word lists
- **Responsive design** - Works on desktop and mobile devices
- **Keyboard accessible** - Full keyboard navigation support

## Quick Start

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

## How to Play

### Game Setup

1. **Host** opens the game and clicks "New Game"
2. **Host** shares their screen via Zoom/Meet/etc.
3. **Host** copies the game link and shares it with all players in chat
4. **Everyone** opens the link in their own browser

### Roles

| Role | What they do |
|------|--------------|
| **Host** | Shares screen, clicks cards as players guess. Only one person should be host. |
| **Red Spymaster** | Sees the key showing which words belong to which team. Gives clues to the Red team. Cannot click cards. |
| **Blue Spymaster** | Sees the key showing which words belong to which team. Gives clues to the Blue team. Cannot click cards. |
| **Viewers/Guessers** | Watch the host's shared screen and call out guesses verbally. |

### Gameplay

1. The team that goes first (shown in the turn indicator) has **9 words** to find; the other team has **8 words**
2. The **Spymaster** gives a one-word clue and a number (e.g., "Animals: 3")
3. The number indicates how many words on the board relate to the clue
4. **Guessers** discuss and call out their guesses to the **Host**
5. The **Host** clicks the guessed card to reveal it:
   - **Team's color** - Correct! Keep guessing (up to the number given + 1)
   - **Neutral (beige)** - Turn ends
   - **Opponent's color** - Turn ends, opponent gets a point
   - **Assassin (black)** - Game over! The team that picked it loses instantly
6. Click **"End Turn"** when your team is done guessing
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

### Using a wordlist.txt File

1. Create a file named `wordlist.txt` in the same folder as `index.html`
2. Add your words, one per line
3. Lines starting with `#` are treated as comments
4. Refresh the page - your word list will be loaded automatically

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

## Troubleshooting

| Problem | Solution |
|---------|----------|
| Cards don't respond to clicks | Make sure you've clicked "Become Host" first. Only the host can click cards. |
| Game link is very long | This happens with custom words. The words are encoded in the URL. Most browsers support URLs up to 2000+ characters. |
| Can't see spymaster view | Click "Red Spymaster" or "Blue Spymaster" button. You'll see colored dots on cards showing their true types. |
| Game state not syncing | Make sure everyone has the latest URL. The host should re-share the link after any changes. |

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
