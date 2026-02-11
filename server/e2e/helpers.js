// @ts-check

/**
 * E2E Test Helpers
 *
 * Shared selectors (data-testid based) and helper functions
 * for Codenames E2E tests.
 */

/** Stable selectors using data-testid attributes */
const sel = {
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
    spectatorBtn: '[data-testid="spectator-btn"]',
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
    playerList: '[data-testid="player-list"]',

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

    // Legacy selectors for elements without data-testid
    // Role buttons (standalone mode uses per-team IDs)
    spymasterRedBtn: '#btn-spymaster-red',
    spymasterBlueBtn: '#btn-spymaster-blue',
    clickerRedBtn: '#btn-clicker-red',
    clickerBlueBtn: '#btn-clicker-blue',

    // Start game button (dynamically generated in multiplayer)
    startGameBtn: '#btn-start-game',

    // Chat (may not exist in all views)
    chatInput: '#chat-input',
    chatMessages: '#chat-messages',
};

/**
 * Create a multiplayer room and return the room ID.
 * @param {import('@playwright/test').Page} page
 * @param {string} nickname
 * @returns {Promise<string>} Room ID
 */
async function createRoom(page, nickname) {
    await page.goto('/');

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
        await page.waitForTimeout(500);
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

module.exports = { sel, createRoom, joinRoom, selectTeam, becomeCurrentClicker };
