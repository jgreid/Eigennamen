// @ts-check

/**
 * E2E Test Helpers
 *
 * Shared selectors (data-testid based) and helper functions
 * for Eigennamen E2E tests.
 */

/** Stable selectors using data-testid attributes */
const sel = {
    // Setup Screen
    setupScreen: '[data-testid="setup-screen"]',
    setupBoard: '[data-testid="setup-board"]',
    setupHostBtn: '[data-testid="setup-host-btn"]',
    setupJoinBtn: '[data-testid="setup-join-btn"]',
    setupLocalBtn: '[data-testid="setup-local-btn"]',
    setupJoinForm: '[data-testid="setup-join-form"]',
    setupHostForm: '[data-testid="setup-host-form"]',
    setupJoinNickname: '#setup-join-nickname',
    setupJoinRoomId: '#setup-join-room-id',
    setupHostNickname: '#setup-host-nickname',
    setupHostRoomId: '#setup-host-room-id',
    setupRedName: '#setup-red-name',
    setupBlueName: '#setup-blue-name',
    setupBackBtn: '[data-action="setup-back"]',
    setupJoinSubmitBtn: '#setup-join-btn',
    setupHostSubmitBtn: '#setup-host-btn',

    // Board
    board: '[data-testid="game-board"]',
    boardCard: '[data-testid="board-card"]',
    boardCardUnrevealed: '[data-testid="board-card"]:not(.revealed)',

    // Scores & Turn
    turnIndicator: '[data-testid="turn-indicator"]',
    redRemaining: '[data-testid="red-remaining"]',
    blueRemaining: '[data-testid="blue-remaining"]',
    timerDisplay: '[data-testid="timer-display"]',
    roleBanner: '[data-testid="role-banner"]',

    // Action Buttons
    newGameBtn: '[data-testid="new-game-btn"]',
    settingsBtn: '[data-testid="settings-btn"]',
    multiplayerBtn: '[data-testid="multiplayer-btn"]',
    endTurnBtn: '[data-testid="end-turn-btn"]',
    spymasterBtn: '[data-testid="spymaster-btn"]',
    clickerBtn: '[data-testid="clicker-btn"]',
    // Spectator mode is now achieved by toggling team buttons (click team again to unassign)
    forfeitBtn: '[data-testid="forfeit-btn"]',
    historyBtn: '[data-testid="history-btn"]',

    // Team Buttons
    teamRedBtn: '[data-testid="team-red-btn"]',
    teamBlueBtn: '[data-testid="team-blue-btn"]',

    // Share
    shareLink: '[data-testid="share-link"]',

    // Modals
    settingsModal: '[data-testid="settings-modal"]',
    multiplayerModal: '[data-testid="multiplayer-modal"]',
    gameOverModal: '[data-testid="game-over-modal"]',
    winnerDisplay: '[data-testid="winner-display"]',
    helpModal: '#help-modal',
    confirmModal: '#confirm-modal',

    // Multiplayer Indicator
    mpIndicator: '[data-testid="mp-indicator"]',
    mpIndicatorActive: '[data-testid="mp-indicator"].active',
    roomCode: '[data-testid="room-code"]',
    playerCount: '[data-testid="player-count"]',
    playerCountBtn: '#mp-player-count-btn',
    playerList: '[data-testid="player-list"]',

    // Bot management (host only; lives inside the expandable player list)
    botsPanel: '[data-testid="bots-panel"]',
    botTeamSelect: '[data-testid="bot-team-select"]',
    botSeatSelect: '[data-testid="bot-seat-select"]',
    botStyleSelect: '[data-testid="bot-style-select"]',
    botSkillSelect: '[data-testid="bot-skill-select"]',
    addBotBtn: '[data-testid="add-bot-btn"]',

    // Clue display (visible to everyone once a spymaster/spymaster-bot clues)
    clueDisplay: '[data-testid="clue-display"]',
    suggestionBadge: '.suggestion-badge',

    // Multiplayer Modal Form
    modeJoinBtn: '[data-testid="mode-join-btn"]',
    modeCreateBtn: '[data-testid="mode-create-btn"]',
    joinNickname: '[data-testid="join-nickname"]',
    joinRoomId: '[data-testid="join-room-id"]',
    createNickname: '[data-testid="create-nickname"]',
    createRoomId: '[data-testid="create-room-id"]',
    mpActionBtn: '[data-testid="mp-action-btn"]',
    mpStatus: '[data-testid="mp-status"]',

    // Settings
    languageSelect: '[data-testid="language-select"]',
    colorblindToggle: '[data-testid="colorblind-toggle"]',

    // Selectors for elements without data-testid
    // Role buttons (standalone mode uses per-team IDs)
    spymasterRedBtn: '#btn-spymaster-red',
    spymasterBlueBtn: '#btn-spymaster-blue',
    clickerRedBtn: '#btn-clicker-red',
    clickerBlueBtn: '#btn-clicker-blue',

    // Start/new-game button. Room creation auto-starts a game immediately
    // (see multiplayer.ts), so this button is really only ever the
    // round/game *transition* control post-round — same element as
    // newGameBtn below (id="btn-new-game"; #btn-start-game does not exist).
    startGameBtn: '#btn-new-game',

    // Chat (may not exist in all views)
    chatInput: '#chat-input',
    chatMessages: '#chat-messages',
};

/**
 * Dismiss the setup screen into the local game by clicking "Local".
 *
 * The setup screen translates its labels during app init (translatePage); a
 * click that lands in that brief window is occasionally dropped even though the
 * app is fully loaded, leaving the user on the setup screen. A second click
 * always works, so re-click until the board appears.
 * @param {import('@playwright/test').Page} page
 */
async function clickLocalUntilBoard(page) {
    const localBtn = page.locator(sel.setupLocalBtn);
    const board = page.locator(sel.board);
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
        // Already in the game (e.g. URL-encoded state, or a prior click landed).
        if (await board.isVisible({ timeout: 250 }).catch(() => false)) return;
        if (await localBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
            await localBtn.click({ timeout: 2000 }).catch(() => {});
        }
        if (await board.isVisible({ timeout: 1500 }).catch(() => false)) return;
    }
}

/**
 * Navigate to the home page and dismiss the setup screen to reach the game.
 * Clicks the Solo button on the setup screen to load standalone mode.
 * @param {import('@playwright/test').Page} page
 */
async function goToGame(page) {
    await page.goto('/');

    await clickLocalUntilBoard(page);

    // Wait for game board to be visible
    await page.locator(sel.board).waitFor({ state: 'visible', timeout: 5000 });
}

/**
 * Create a multiplayer room and return the room ID.
 * Uses the setup screen Host form when available, falls back to multiplayer modal.
 * @param {import('@playwright/test').Page} page
 * @param {string} nickname
 * @returns {Promise<string>} Room ID
 */
async function createRoom(page, nickname) {
    await page.goto('/');

    // Dismiss setup screen first, then use the multiplayer modal
    await clickLocalUntilBoard(page);

    await page.locator(sel.multiplayerBtn).click();
    await page.locator(sel.modeCreateBtn).click();

    await page.locator(sel.createNickname).fill(nickname);

    const roomId = `E2E${Date.now()}${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
    await page.locator(sel.createRoomId).fill(roomId);

    await page.locator(sel.mpActionBtn).click();

    // Wait for connection indicator to show active
    await page.waitForSelector(sel.mpIndicatorActive, { timeout: 15000 });

    return roomId;
}

/**
 * Join an existing multiplayer room.
 * @param {import('@playwright/test').Page} page
 * @param {string} roomId
 * @param {string} nickname
 */
async function joinRoom(page, roomId, nickname) {
    await page.goto('/');

    // Dismiss setup screen first, then use the multiplayer modal
    await clickLocalUntilBoard(page);

    await page.locator(sel.multiplayerBtn).click();

    // Join mode is default, but click it to be sure
    await page.locator(sel.modeJoinBtn).click();

    await page.locator(sel.joinNickname).fill(nickname);
    await page.locator(sel.joinRoomId).fill(roomId);

    await page.locator(sel.mpActionBtn).click();

    await page.waitForSelector(sel.mpIndicatorActive, { timeout: 15000 });
}

/**
 * Select a team for a player.
 * @param {import('@playwright/test').Page} page
 * @param {'red' | 'blue'} team
 */
async function selectTeam(page, team) {
    const btn = page.locator(team === 'red' ? sel.teamRedBtn : sel.teamBlueBtn);
    if (await btn.isVisible({ timeout: 3000 }).catch(() => false)) {
        await btn.click();
        // Wait for the player list to reflect the team change instead of arbitrary timeout
        await page
            .locator(`${sel.playerList} .${team}-team, ${sel.playerList} [class*="${team}"]`)
            .first()
            .waitFor({ state: 'attached', timeout: 5000 })
            .catch(() => {});
    }
}

/**
 * Become clicker for the team whose turn it is.
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<boolean>} true if red turn, false if blue turn
 */
async function becomeCurrentClicker(page) {
    const turnText = await page.locator(sel.turnIndicator).textContent();
    const isRedTurn = turnText?.includes('Red') || false;
    await page.locator(sel.clickerBtn).click();
    return isRedTurn;
}

/**
 * Add a bot to a team/seat via the host-only bots panel. Expands the player
 * list first (the panel lives inside it) if it isn't already open.
 * @param {import('@playwright/test').Page} page
 * @param {'red' | 'blue'} team
 * @param {'spymaster' | 'clicker' | 'advisor'} seat
 * @param {'smart' | 'cautious' | 'random'} [style]
 */
async function addBot(page, team, seat, style = 'smart') {
    const panel = page.locator(sel.botsPanel);
    if (!(await panel.isVisible({ timeout: 1000 }).catch(() => false))) {
        await page.locator(sel.playerCountBtn).click();
        await panel.waitFor({ state: 'visible', timeout: 5000 });
    }
    await page.locator(sel.botTeamSelect).selectOption(team);
    await page.locator(sel.botSeatSelect).selectOption(seat);
    await page.locator(sel.botStyleSelect).selectOption(style);
    await page.locator(sel.addBotBtn).click();
}

module.exports = {
    sel,
    goToGame,
    clickLocalUntilBoard,
    createRoom,
    joinRoom,
    selectTeam,
    becomeCurrentClicker,
    addBot,
};
