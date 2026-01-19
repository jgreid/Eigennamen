# Beta Test Guide - Codenames Online

This guide walks through deploying and testing the Codenames game on Fly.io.

## Pre-Flight Checklist

### 1. Verify Fly.io Setup

```bash
# Login to Fly.io
fly auth login

# Check app exists
fly status

# Verify secrets are configured
fly secrets list
```

**Required secrets:**
- `DATABASE_URL` - PostgreSQL connection string
- `REDIS_URL` - Redis connection string (should start with `rediss://` for TLS)

**Optional but recommended:**
- `DATABASE_DIRECT_URL` - Direct PostgreSQL URL (for migrations, bypasses connection pooler)

If missing secrets:
```bash
# Set database URL
fly secrets set DATABASE_URL="postgresql://..."

# Set Redis URL (from Upstash or fly redis create)
fly secrets set REDIS_URL="rediss://..."

# Set direct URL for migrations (same as DATABASE_URL if not using PgBouncer)
fly secrets set DATABASE_DIRECT_URL="postgresql://..."
```

### 2. Deploy

```bash
cd server
fly deploy
```

Watch for:
- Build completing successfully
- Release command (migrations) succeeding
- Health checks passing

### 3. Verify Deployment

```bash
# Check app is running
fly status

# Check health endpoint
curl https://risley-codenames.fly.dev/health/ready

# Expected response:
# {"status":"ok","checks":{"database":{"status":"ok"},"redis":{"status":"ok"},"socketio":{"status":"ok"}}}
```

---

## Beta Test Scenarios

### Test 1: Basic Room Creation & Joining

**Player 1 (Host):**
1. Open https://risley-codenames.fly.dev
2. Click "Create Room" or "Host Game"
3. Note the 6-character room code
4. Share code with Player 2

**Player 2:**
1. Open https://risley-codenames.fly.dev
2. Enter the room code
3. Click "Join"

**Verify:**
- [ ] Both players see the lobby
- [ ] Player list shows both players
- [ ] Host has host controls

### Test 2: Team & Role Assignment

**Both Players:**
1. Select teams (one Red, one Blue)
2. Assign roles (Spymaster vs Guesser)

**Verify:**
- [ ] Team changes reflect for both players instantly
- [ ] Role changes reflect for both players instantly

### Test 3: Game Start

**Host:**
1. Click "Start Game"

**Verify:**
- [ ] Both players see the 5x5 board with 25 words
- [ ] Spymasters see colored card types
- [ ] Guessers see only words (no colors until revealed)
- [ ] Score shows (e.g., Red: 0/9, Blue: 0/8)
- [ ] Current turn indicator shows which team goes first

### Test 4: Giving Clues

**Spymaster (whose turn it is):**
1. Type a one-word clue
2. Enter a number (how many cards relate to clue)
3. Submit clue

**Verify:**
- [ ] Clue appears for all players
- [ ] Number of guesses allowed shown
- [ ] Guessers can now click cards

### Test 5: Revealing Cards

**Host:**
1. Click on a card to reveal it

**Verify:**
- [ ] Card flips to show color
- [ ] Score updates correctly
- [ ] If wrong team's card: turn ends
- [ ] If neutral: turn ends
- [ ] If assassin: game ends immediately

### Test 6: Turn Timer (if enabled)

**Setup:**
1. Before starting, enable turn timer in settings (e.g., 60 seconds)

**Verify:**
- [ ] Timer displays countdown
- [ ] Turn automatically ends when timer expires
- [ ] New timer starts for next team

### Test 7: End Turn Manually

**Host:**
1. Click "End Turn" before using all guesses

**Verify:**
- [ ] Turn passes to other team
- [ ] Clue is cleared
- [ ] Timer resets (if enabled)

### Test 8: Winning the Game

**Play until one team finds all their cards**

**Verify:**
- [ ] Winner announcement appears
- [ ] All cards revealed (colors shown)
- [ ] Option to play again

### Test 9: Reconnection

**One Player:**
1. Refresh browser (F5)
2. Should auto-rejoin the room

**Verify:**
- [ ] Reconnects without re-entering code
- [ ] Game state preserved
- [ ] Still on same team/role

### Test 10: New Game in Same Room

**Host:**
1. After game ends, click "New Game"

**Verify:**
- [ ] New board generated
- [ ] Scores reset
- [ ] Teams/roles preserved

---

## Monitoring During Test

Keep a terminal open with logs:
```bash
fly logs -f
```

Watch for:
- Socket connections/disconnections
- Any error messages
- Timer events
- Game state changes

---

## Common Issues & Fixes

### "Room not found" after refresh
- Session may have expired (10 min disconnect grace period)
- Solution: Create new room

### Cards not revealing
- Check browser console for errors
- May be a WebSocket connection issue
- Try refreshing both players

### Timer not working
- Ensure timer was enabled before starting game
- Check logs for timer errors

### Slow initial load
- First request after idle wakes the machine (~5-10s)
- Subsequent requests are fast

### Health check failing
- Check `fly logs` for startup errors
- Verify DATABASE_URL and REDIS_URL are correct
- Try `fly apps restart`

---

## Rollback if Needed

If something goes wrong:
```bash
# See recent deployments
fly releases

# Rollback to previous version
fly deploy --image <previous-image>
```

---

## Post-Test Checklist

After testing, note any issues:

- [ ] Room creation working?
- [ ] Joining rooms working?
- [ ] Real-time updates working?
- [ ] Game mechanics correct?
- [ ] Timer working?
- [ ] Reconnection working?
- [ ] Any error messages seen?
- [ ] Performance acceptable?

---

## Quick Reference

| Action | Command |
|--------|---------|
| Deploy | `fly deploy` |
| View logs | `fly logs -f` |
| Check status | `fly status` |
| Check health | `curl https://risley-codenames.fly.dev/health/ready` |
| Restart app | `fly apps restart` |
| SSH into container | `fly ssh console` |
| View secrets | `fly secrets list` |

**App URL:** https://risley-codenames.fly.dev

Good luck with the beta test!
