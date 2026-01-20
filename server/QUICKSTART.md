# Risley Codenames - Quick Start Guide

Deploy your own Codenames game server in 5 minutes.

## Prerequisites

- Windows PC (or Mac/Linux)
- Credit card (for Fly.io verification - you won't be charged)

---

## Step 1: Install Fly CLI

**Windows (PowerShell as Admin):**
```powershell
powershell -Command "iwr https://fly.io/install.ps1 -useb | iex"
```

**Mac/Linux:**
```bash
curl -L https://fly.io/install.sh | sh
```

Close and reopen your terminal, then verify:
```
fly version
```

---

## Step 2: Create Account & Login

```
fly auth signup
```

This opens a browser. Create your account and add a payment method.

---

## Step 3: Deploy

From the repository root, launch:

```
fly launch
```

**Answer the prompts:**

| Prompt | Answer |
|--------|--------|
| Copy configuration? | **Yes** |
| App name | Press Enter (uses `risley-codenames`) |
| Region | Press Enter (default is fine) |
| Set up PostgreSQL? | **Yes** → Select **Development** |
| Set up Redis? | **Yes** → Select **Free** |

---

## Step 4: Configure Database

Fly.io uses a connection pooler that needs special configuration. Run:

```
fly secrets set DATABASE_DIRECT_URL="$(fly postgres config show -a risley-codenames-db --format=json | jq -r '.direct_url')"
```

**If that doesn't work**, get your database URL manually:
```
fly postgres config show -a risley-codenames-db
```

Then set it (replace the URL with yours, changing port 5432 to 5433):
```
fly secrets set DATABASE_DIRECT_URL="postgres://user:pass@host:5433/dbname"
```

---

## Step 5: Deploy

```
fly deploy
```

Wait 2-3 minutes for the build to complete.

---

## Step 6: Play!

```
fly open
```

Your game is live at: **https://risley-codenames.fly.dev**

Share this link with friends to play together!

---

## Common Commands

| Command | Description |
|---------|-------------|
| `fly open` | Open your game in browser |
| `fly logs` | View server logs |
| `fly status` | Check if app is running |
| `fly deploy` | Deploy updates |
| `fly apps restart` | Restart the server |

---

## Updating the Game

After making code changes:

```
git pull                # Get latest changes
fly deploy              # Deploy to Fly.io
```

---

## Costs

Everything runs on the free tier:
- **App**: Free ($5/month credit)
- **PostgreSQL**: Free (Development tier)
- **Redis**: Free (Upstash free tier)

**Total: $0/month** for typical usage

---

## Troubleshooting

### "Release command failed"
Run `fly logs` to see the error. Usually a database connection issue.

### "Health check failing"
```
fly status
fly logs
```

### Need to start fresh?
```
fly apps destroy risley-codenames
fly launch
```

---

## Local Development

To run locally without Fly.io:

```
docker-compose up -d    # From repo root - starts PostgreSQL and Redis
cd server
npm install
npm run dev             # Starts the server
```

Open http://localhost:3000
