# How to Set Up the Codenames Game Server on Your Windows Computer

This guide will walk you through every step to get the Codenames game running on your Windows computer so you can play with friends and family. No technical experience needed - just follow along!

**Time needed:** About 20-30 minutes (most of this is waiting for downloads)

**What you'll end up with:** A game server running on your computer that everyone can connect to and play Codenames together in real-time.

---

## What You'll Need

- A Windows 10 or Windows 11 computer
- An internet connection
- About 2 GB of free disk space

---

## Part 1: Download the Game Files

First, we need to get the game files onto your computer.

### Step 1: Open the Download Page

1. Open your web browser (Chrome, Edge, Firefox - any will work)
2. Go to: **https://github.com/jgreid/Eigennamen**

### Step 2: Download the Files

1. Look for a green button that says **"Code"** - it's near the top right of the page
2. Click on it
3. A small menu will appear - click **"Download ZIP"**
4. Your browser will download a file called something like `Eigennamen-main.zip`
5. Wait for the download to finish (you'll see it in the bottom of your browser or in your Downloads folder)

### Step 3: Extract (Unzip) the Files

1. Open **File Explorer** (the folder icon on your taskbar, or press the Windows key and type "File Explorer")
2. Go to your **Downloads** folder (look in the left sidebar)
3. Find the file called `Eigennamen-main.zip`
4. **Right-click** on it
5. Click **"Extract All..."**
6. A window will pop up asking where to extract - just click **"Extract"** (the default location is fine)
7. A new folder will appear called `Eigennamen-main`

**Keep this File Explorer window open - you'll need it later!**

---

## Part 2: Install Docker Desktop

Docker is a free program that will run the game server for you. It handles all the complicated technical stuff automatically.

### Step 1: Download Docker Desktop

1. Open your web browser
2. Go to: **https://www.docker.com/products/docker-desktop/**
3. Click the big blue button that says **"Download for Windows"**
4. Wait for the download to finish (the file is about 500 MB, so this may take a few minutes)

### Step 2: Install Docker Desktop

1. Go to your **Downloads** folder
2. Find the file called **"Docker Desktop Installer.exe"** and **double-click** it
3. If Windows asks "Do you want to allow this app to make changes?" click **"Yes"**
4. The installer will start - just follow the prompts:
   - Leave all the checkboxes at their default settings
   - Click **"Ok"** or **"Install"** when asked
5. When it says installation is complete, click **"Close and restart"**
6. **Your computer will restart** - this is normal!

### Step 3: Start Docker Desktop

After your computer restarts:

1. Docker Desktop might start automatically. If not:
   - Click the **Start** button (Windows icon in the bottom-left corner)
   - Type **"Docker Desktop"**
   - Click on **Docker Desktop** when it appears
2. The first time it runs, you'll see a welcome screen - you can skip or close any tutorials
3. **Wait for Docker to fully start** - look at the bottom-left of the Docker window. It should say "Docker Desktop is running" or show a green indicator
4. If it asks you to create an account, you can click **"Continue without signing in"** or just close that window

**Important:** Look at your system tray (the small icons near the clock in the bottom-right corner of your screen). You should see a whale icon (the Docker logo). If you hover over it, it should say "Docker Desktop is running."

---

## Part 3: Start the Game Server

Now we'll start the actual game server. You have two options: the easy way (recommended) or the manual way.

---

### Option A: The Easy Way (Recommended)

We've included a script that does everything for you automatically!

1. Go back to your **File Explorer** window where you extracted the game files
2. Open the folder `Eigennamen-main` by double-clicking it
3. Inside that folder, open the folder called `server` by double-clicking it
4. Find the file called **`start-server.bat`** and **double-click** it

**What happens next:**
- A black window will open and show progress messages
- It will check if Docker is running (and start it if needed)
- It will download and set up everything automatically
- The first time takes 2-5 minutes depending on your internet speed
- When done, it will show you the address to access the game

**That's it! Skip to Part 4 to play the game.**

---

### Option B: Manual Setup (Advanced)

If you prefer to run commands manually, follow these steps:

#### Step 1: Open Command Prompt

1. Click the **Start** button (Windows icon)
2. Type **"cmd"**
3. You'll see **"Command Prompt"** appear - click on it
4. A black window will open with white text - this is the Command Prompt

#### Step 2: Navigate to the Game Folder

Now you need to tell the computer where the game files are. Remember the folder you extracted earlier? We need to go there.

1. Go back to your **File Explorer** window where you extracted the game files
2. Open the folder `Eigennamen-main` by double-clicking it
3. Inside that folder, open the folder called `server` by double-clicking it
4. Now, **click once in the address bar** at the top of the File Explorer window (where it shows the folder path)
5. The address bar will highlight and show something like:
   `C:\Users\YourName\Downloads\Eigennamen-main\server`
6. Press **Ctrl+C** to copy this path

Now go back to the Command Prompt:

7. Type the letters **cd** followed by a space
8. Then **right-click** in the Command Prompt window - this will paste the path you copied
9. Press **Enter**

The command should look something like this:
```
cd C:\Users\YourName\Downloads\Eigennamen-main\server
```

If it worked, you'll see the path appear before the cursor, like:
```
C:\Users\YourName\Downloads\Eigennamen-main\server>
```

#### Step 3: Start the Server

Now type this command exactly as shown and press **Enter**:

```
docker compose up -d --build
```

**What happens next:**
- The first time you run this, Docker will download everything it needs
- You'll see a lot of text scrolling by - this is normal!
- It might take 2-5 minutes depending on your internet speed
- When it's done, you'll see something like "Container server-api-1 Started"

#### Step 4: Make Sure It's Working

Type this command and press **Enter**:

```
docker compose ps
```

You should see a table showing three services all with "running" in their status:
- `server-api-1` - running
- `server-redis-1` - running
- `server-db-1` - running

**Congratulations! Your game server is now running!**

---

## Part 4: Play the Game

### Open the Game in Your Browser

1. Open your web browser
2. Go to: **http://localhost:3000**
3. You should see the Codenames game board!

### Share with Friends on the Same Wi-Fi Network

If your friends are on the same Wi-Fi network (like in your house):

1. Go back to Command Prompt
2. Type **ipconfig** and press **Enter**
3. Look for a line that says **"IPv4 Address"** - it will show something like `192.168.1.105`
4. Tell your friends to open their browser and go to: **http://192.168.1.105:3000** (using your actual number)

---

## Part 5: Stopping and Starting the Server

### To Stop the Server

If you want to shut down the server (maybe you're done playing or want to turn off your computer):

**Easy way:** Double-click **`stop-server.bat`** in the server folder.

**Manual way:**
1. Open Command Prompt
2. Navigate to the server folder again (use the `cd` command from Part 3)
3. Type this and press **Enter**:
   ```
   docker compose down
   ```

### To Start the Server Again Later

**Easy way:** Double-click **`start-server.bat`** in the server folder.

**Manual way:**
1. Make sure Docker Desktop is running (check for the whale icon in your system tray)
2. Open Command Prompt
3. Navigate to the server folder
4. Type this and press **Enter**:
   ```
   docker compose up -d
   ```

### To Check Server Status

**Easy way:** Double-click **`check-status.bat`** in the server folder.

**Manual way:**
1. Open Command Prompt and navigate to the server folder
2. Type `docker compose ps` and press **Enter**

---

## Troubleshooting: What to Do If Something Goes Wrong

### "Docker is not running" error

**What it means:** Docker Desktop needs to be running before you can start the server.

**How to fix it:**
1. Look for the whale icon in your system tray (near the clock)
2. If you don't see it, click the Start button, type "Docker Desktop", and open it
3. Wait for it to fully start (the whale icon should be steady, not animating)
4. Try the command again

### "Cannot connect to the Docker daemon" error

**What it means:** Same as above - Docker isn't ready yet.

**How to fix it:** Wait another minute for Docker to fully start, then try again.

### The browser shows "This site can't be reached"

**What it means:** The server might not be running.

**How to fix it:**
1. Double-click `check-status.bat` in the server folder to see if services are running
2. If services aren't running, double-click `start-server.bat` to start them
3. Or manually: open Command Prompt, navigate to the server folder, and type `docker compose ps`
4. If you don't see three services with "running" status, type `docker compose up -d --build` to start them

### Nothing happens when I type commands

**What it means:** You might not be in the right folder.

**How to fix it:**
1. Make sure you used the `cd` command to go to the server folder first
2. The path before your cursor should end with `\server>`

### The download is taking forever

**What it means:** Docker is downloading a lot of files the first time.

**How to fix it:** This is normal! The first time can take 5-10 minutes. Subsequent starts will be much faster (just a few seconds).

---

## Quick Reference Card

Once you're comfortable with the setup, here's a quick reference:

| What you want to do | Easy Way (Double-click) | Manual Command |
|---------------------|-------------------------|----------------|
| Start the server | `start-server.bat` | `docker compose up -d --build` |
| Stop the server | `stop-server.bat` | `docker compose down` |
| Check if it's running | `check-status.bat` | `docker compose ps` |
| Find your IP address | (shown in start script) | `ipconfig` |

**Remember:** For manual commands, always navigate to the server folder first with the `cd` command!

---

## Need More Help?

If you're still having trouble, you can:
- Ask a family member who's good with computers to help
- Check the [main project page](https://github.com/jgreid/Eigennamen) for more information
- The game also works without a server! Just open the `index.html` file directly in your browser for a simpler version
