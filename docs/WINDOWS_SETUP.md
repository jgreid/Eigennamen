# Setting Up the Codenames Server on Windows

This guide walks you through setting up the Codenames multiplayer server on a Windows PC. We'll cover two methods: Docker (easiest) and Manual Setup.

## Quick Overview

The Codenames server needs three things to run:
1. **Node.js** - Runs the JavaScript server code
2. **Redis** - Stores game state in memory for fast access
3. **PostgreSQL** - Stores persistent data (game history, word lists)

---

## Step 0: Get the Code

Before you can run the server, you need to download the project files.

### Option A: Download as ZIP (Easiest)

1. Go to the GitHub repository in your browser
2. Click the green **"Code"** button
3. Select **"Download ZIP"**
4. Extract the ZIP file to a folder (e.g., `C:\Projects\Risley-Codenames`)

### Option B: Clone with Git

If you have Git installed:

1. Open Command Prompt or PowerShell
2. Navigate to where you want the project:
   ```cmd
   cd C:\Projects
   ```
3. Clone the repository:
   ```cmd
   git clone https://github.com/jgreid/Risley-Codenames.git
   ```
4. Enter the project folder:
   ```cmd
   cd Risley-Codenames
   ```

**Don't have Git?** Download it from: https://git-scm.com/download/win

---

## Method 1: Using Docker Desktop (Recommended)

Docker is the easiest way to get started because it packages everything together - you don't need to install Redis or PostgreSQL separately.

### Step 1: Install Docker Desktop

1. Download Docker Desktop from: https://www.docker.com/products/docker-desktop/
2. Run the installer and follow the prompts
3. Restart your computer when prompted
4. After restart, launch Docker Desktop from the Start menu
5. Wait for Docker to fully start (the whale icon in your system tray will stop animating)

### Step 2: Verify Docker Installation

Open **Command Prompt** or **PowerShell** and run:

```cmd
docker --version
docker-compose --version
```

You should see version numbers for both. If you get an error, make sure Docker Desktop is running.

### Step 3: Start the Server

1. Open Command Prompt or PowerShell
2. Navigate to the server folder:
   ```cmd
   cd path\to\Risley-Codenames\server
   ```
3. Start all services:
   ```cmd
   docker-compose up -d
   ```

The first time you run this, Docker will download the required images. This may take a few minutes.

### Step 4: Verify It's Running

Check that all containers are running:

```cmd
docker-compose ps
```

You should see three services: `api`, `redis`, and `postgres` - all with status "Up".

View the server logs:

```cmd
docker-compose logs -f api
```

Press `Ctrl+C` to stop watching logs.

### Step 5: Test the Server

Open your web browser and go to:
- http://localhost:3000/health

You should see: `{"status":"ok",...}`

The server is now running and ready for connections.

### Stopping the Server

To stop the server:

```cmd
docker-compose down
```

To stop and remove all data (fresh start):

```cmd
docker-compose down -v
```

---

## Method 2: Manual Setup

Use this method if you prefer not to use Docker or want more control over the setup.

### Step 1: Install Node.js

1. Download Node.js (LTS version) from: https://nodejs.org/
2. Run the installer
3. Accept the defaults (make sure "Add to PATH" is checked)
4. Open a **new** Command Prompt and verify:
   ```cmd
   node --version
   npm --version
   ```

### Step 2: Install Redis

Redis doesn't have an official Windows build, but there are several options:

**Option A: Use Windows Subsystem for Linux (WSL) - Recommended**

1. Open PowerShell as Administrator and run:
   ```powershell
   wsl --install
   ```
2. Restart your computer
3. Open the Ubuntu app from the Start menu
4. Install Redis in WSL:
   ```bash
   sudo apt update
   sudo apt install redis-server
   sudo service redis-server start
   ```
5. Test it:
   ```bash
   redis-cli ping
   ```
   Should respond: `PONG`

**Option B: Use Memurai (Redis-compatible for Windows)**

1. Download from: https://www.memurai.com/
2. Install and start the Memurai service
3. It runs on the same port as Redis (6379)

### Step 3: Install PostgreSQL

1. Download from: https://www.postgresql.org/download/windows/
2. Run the installer
3. During installation:
   - Set a password for the `postgres` user (remember this!)
   - Keep the default port (5432)
   - Complete the installation
4. The installer should start PostgreSQL automatically as a Windows service

### Step 4: Create the Database

1. Open **pgAdmin** (installed with PostgreSQL) or use the command line
2. Using pgAdmin:
   - Right-click on "Databases" → "Create" → "Database"
   - Name it: `codenames`
   - Click "Save"

3. Or using Command Prompt (run as Administrator):
   ```cmd
   "C:\Program Files\PostgreSQL\15\bin\psql.exe" -U postgres
   ```
   Enter your password, then:
   ```sql
   CREATE DATABASE codenames;
   \q
   ```

### Step 5: Install Server Dependencies

1. Open Command Prompt
2. Navigate to the server folder:
   ```cmd
   cd path\to\Risley-Codenames\server
   ```
3. Install dependencies:
   ```cmd
   npm install
   ```

### Step 6: Configure Environment Variables

1. Copy the example configuration:
   ```cmd
   copy .env.example .env
   ```

2. Open `.env` in a text editor (like Notepad or VS Code) and update these values:

   ```env
   # Server port
   PORT=3000

   # PostgreSQL connection (update with your password)
   DATABASE_URL=postgresql://postgres:YOUR_PASSWORD@localhost:5432/codenames

   # Redis connection
   REDIS_URL=redis://localhost:6379

   # Generate a random secret for JWT (use any long random string)
   JWT_SECRET=your-super-secret-key-change-this

   # Allow connections from anywhere (for development)
   CORS_ORIGIN=*
   ```

### Step 7: Run Database Migrations

This creates the necessary database tables:

```cmd
npx prisma migrate dev
```

If prompted for a migration name, enter something like "initial".

### Step 8: Start the Server

**For development** (auto-restarts when files change):

```cmd
npm run dev
```

**For production:**

```cmd
npm start
```

You should see output like:

```
[INFO] Server listening on port 3000
[INFO] Redis connected
[INFO] Database connected
```

### Step 9: Test the Server

Open your browser and go to:
- http://localhost:3000/health

You should see: `{"status":"ok",...}`

---

## Connecting the Client

Once the server is running:

1. Open the `index.html` file from the project root in your browser
2. The client will connect to `ws://localhost:3000` by default
3. Create a room and share the code with friends!

---

## Troubleshooting

| Problem | Solution |
|---------|----------|
| **"Docker is not running"** | Open Docker Desktop and wait for it to fully start |
| **"Port 3000 already in use"** | Change the `PORT` in `.env` or close the other application using port 3000 |
| **"Redis connection refused"** | Make sure Redis is running (check Windows Services or WSL) |
| **"Database connection failed"** | Check your password in `.env` and verify PostgreSQL is running |
| **"ECONNREFUSED" errors** | Ensure all services (Redis, PostgreSQL) are started |
| **"npx prisma" command not found** | Run `npm install` again in the server folder |
| **WSL not installing** | Enable "Windows Subsystem for Linux" in Windows Features |

### Checking if Services are Running

**PostgreSQL:**
1. Press `Win + R`, type `services.msc`, press Enter
2. Look for "postgresql" in the list
3. Status should be "Running"

**Redis (WSL):**
```bash
wsl -e redis-cli ping
```
Should respond: `PONG`

**Redis (Memurai):**
1. Check Windows Services for "Memurai" - should be "Running"

---

## Running as a Background Service

If you want the server to run automatically when Windows starts:

### Using Docker Desktop
Docker Desktop can be configured to start with Windows and containers can be set to restart automatically.

### Using PM2 (Process Manager)

1. Install PM2 globally:
   ```cmd
   npm install -g pm2
   npm install -g pm2-windows-startup
   pm2-startup install
   ```

2. Start the server with PM2:
   ```cmd
   cd path\to\Risley-Codenames\server
   pm2 start npm --name "codenames" -- start
   pm2 save
   ```

3. The server will now start automatically with Windows.

---

## Network Access

To allow other devices on your network to connect:

1. Find your computer's IP address:
   ```cmd
   ipconfig
   ```
   Look for "IPv4 Address" (usually starts with 192.168.x.x)

2. Open Windows Firewall:
   - Search for "Windows Defender Firewall" in the Start menu
   - Click "Advanced settings"
   - Click "Inbound Rules" → "New Rule"
   - Select "Port" → "TCP" → "3000"
   - Allow the connection
   - Give it a name like "Codenames Server"

3. Other devices can now connect using your IP:
   - `http://192.168.x.x:3000`

---

## Need Help?

- Check the [main README](../README.md) for general information
- See [SERVER_SPEC.md](./SERVER_SPEC.md) for technical details
- Report issues at the project's GitHub repository
