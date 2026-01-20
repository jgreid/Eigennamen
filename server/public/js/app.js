/**
 * Main Application Module for Codenames
 *
 * Coordinates all modules and initializes the application.
 * Entry point for the modular frontend architecture.
 */

(function() {
    'use strict';

    // Default word list
    const DEFAULT_WORDS = [
        "AFRICA", "AGENT", "AIR", "ALIEN", "ALPS", "AMAZON", "AMBULANCE", "AMERICA",
        "ANGEL", "ANTARCTICA", "APPLE", "ARM", "ATLANTIS", "AUSTRALIA", "AZTEC",
        "BACK", "BALL", "BAND", "BANK", "BAR", "BARK", "BAT", "BATTERY", "BEACH",
        "BEAR", "BEAT", "BED", "BEIJING", "BELL", "BELT", "BERLIN", "BERMUDA",
        "BERRY", "BILL", "BLOCK", "BOARD", "BOLT", "BOMB", "BOND", "BOOM", "BOOT",
        "BOTTLE", "BOW", "BOX", "BRIDGE", "BRUSH", "BUCK", "BUFFALO", "BUG",
        "BUGLE", "BUTTON", "CALF", "CANADA", "CAP", "CAPITAL", "CAR", "CARD",
        "CARROT", "CASINO", "CAST", "CAT", "CELL", "CENTAUR", "CENTER", "CHAIR",
        "CHANGE", "CHARGE", "CHECK", "CHEST", "CHICK", "CHINA", "CHOCOLATE",
        "CHURCH", "CIRCLE", "CLIFF", "CLOAK", "CLUB", "CODE", "COLD", "COMIC",
        "COMPOUND", "CONCERT", "CONDUCTOR", "CONTRACT", "COOK", "COPPER", "COTTON",
        "COURT", "COVER", "CRANE", "CRASH", "CRICKET", "CROSS", "CROWN", "CYCLE",
        "CZECH", "DANCE", "DATE", "DAY", "DEATH", "DECK", "DEGREE", "DIAMOND",
        "DICE", "DINOSAUR", "DISEASE", "DOCTOR", "DOG", "DRAFT", "DRAGON", "DRESS",
        "DRILL", "DROP", "DUCK", "DWARF", "EAGLE", "EGYPT", "EMBASSY", "ENGINE",
        "ENGLAND", "EUROPE", "EYE", "FACE", "FAIR", "FALL", "FAN", "FENCE", "FIELD",
        "FIGHTER", "FIGURE", "FILE", "FILM", "FIRE", "FISH", "FLUTE", "FLY",
        "FOOT", "FORCE", "FOREST", "FORK", "FRANCE", "GAME", "GAS", "GENIUS",
        "GERMANY", "GHOST", "GIANT", "GLASS", "GLOVE", "GOLD", "GRACE", "GRASS",
        "GREECE", "GREEN", "GROUND", "HAM", "HAND", "HAWK", "HEAD", "HEART",
        "HELICOPTER", "HIMALAYAS", "HOLE", "HOLLYWOOD", "HONEY", "HOOD", "HOOK",
        "HORN", "HORSE", "HOSPITAL", "HOTEL", "ICE", "ICE CREAM", "INDIA", "IRON",
        "IVORY", "JACK", "JAM", "JET", "JUPITER", "KANGAROO", "KETCHUP", "KEY",
        "KID", "KING", "KIWI", "KNIFE", "KNIGHT", "LAB", "LAP", "LASER", "LAWYER",
        "LEAD", "LEMON", "LEPRECHAUN", "LIFE", "LIGHT", "LIMOUSINE", "LINE", "LINK",
        "LION", "LITTER", "LOCH NESS", "LOCK", "LOG", "LONDON", "LUCK", "MAIL",
        "MAMMOTH", "MAPLE", "MARBLE", "MARCH", "MASS", "MATCH", "MERCURY", "MEXICO",
        "MICROSCOPE", "MILLIONAIRE", "MINE", "MINT", "MISSILE", "MODEL", "MOLE",
        "MOON", "MOSCOW", "MOUNT", "MOUSE", "MOUTH", "MUG", "NAIL", "NEEDLE",
        "NET", "NEW YORK", "NIGHT", "NINJA", "NOTE", "NOVEL", "NURSE", "NUT",
        "OCTOPUS", "OIL", "OLIVE", "OLYMPUS", "OPERA", "ORANGE", "ORGAN", "PALM",
        "PAN", "PANDA", "PAPER", "PARACHUTE", "PARK", "PART", "PASS", "PASTE",
        "PENGUIN", "PHOENIX", "PIANO", "PIE", "PILOT", "PIN", "PIPE", "PIRATE",
        "PISTOL", "PIT", "PITCH", "PLANE", "PLASTIC", "PLATE", "PLATYPUS",
        "PLAY", "PLOT", "POINT", "POISON", "POLE", "POLICE", "POOL", "PORT",
        "POST", "POUND", "PRESS", "PRINCESS", "PUMPKIN", "PUPIL", "PYRAMID",
        "QUEEN", "RABBIT", "RACKET", "RAY", "REVOLUTION", "RING", "ROBIN", "ROBOT",
        "ROCK", "ROME", "ROOT", "ROSE", "ROULETTE", "ROUND", "ROW", "RULER",
        "SATELLITE", "SATURN", "SCALE", "SCHOOL", "SCIENTIST", "SCORPION", "SCREEN",
        "SCUBA DIVER", "SEAL", "SERVER", "SHADOW", "SHAKESPEARE", "SHARK", "SHIP",
        "SHOE", "SHOP", "SHOT", "SHOULDER", "SILK", "SINK", "SKYSCRAPER", "SLIP",
        "SLUG", "SMUGGLER", "SNOW", "SNOWMAN", "SOCK", "SOLDIER", "SOUL", "SOUND",
        "SPACE", "SPELL", "SPIDER", "SPIKE", "SPINE", "SPOT", "SPRING", "SPY",
        "SQUARE", "STADIUM", "STAFF", "STAR", "STATE", "STICK", "STOCK", "STRAW",
        "STREAM", "STRIKE", "STRING", "SUB", "SUIT", "SUPERHERO", "SWING", "SWITCH",
        "TABLE", "TABLET", "TAG", "TAIL", "TAP", "TEACHER", "TELESCOPE", "TEMPLE",
        "THIEF", "THUMB", "TICK", "TIE", "TIME", "TOKYO", "TOOTH", "TORCH", "TOWER",
        "TRACK", "TRAIN", "TRIANGLE", "TRIP", "TRUNK", "TUBE", "TURKEY", "UNDERTAKER",
        "UNICORN", "VACUUM", "VAN", "VET", "VOLCANO", "WALL", "WAR", "WASHER",
        "WASHINGTON", "WATCH", "WATER", "WAVE", "WEB", "WELL", "WHALE", "WHIP",
        "WIND", "WITCH", "WORM", "YARD"
    ];

    /**
     * Main Application Class
     * Coordinates state, UI, and game logic
     */
    class CodenamesApp {
        constructor() {
            // Initialize modules
            this.state = new window.CodenamesState.AppState();
            this.cache = new window.CodenamesUI.ElementCache();
            this.announcer = new window.CodenamesUI.ScreenReaderAnnouncer(this.cache);
            this.toast = new window.CodenamesUI.ToastManager(this.cache);
            this.modal = new window.CodenamesUI.ModalManager();
            this.board = new window.CodenamesUI.BoardRenderer(this.cache, this.announcer);

            // Settings
            this.activeWords = [...DEFAULT_WORDS];
            this.wordSource = 'default';
            this.newGameDebounce = false;
            this.pendingUIUpdate = false;

            // Bind methods
            this.handleCardClick = this.handleCardClick.bind(this);
            this.updateUI = this.updateUI.bind(this);
        }

        /**
         * Initialize the application
         */
        init() {
            // Initialize DOM cache
            this.cache.init();

            // Initialize board event delegation
            this.board.init(this.handleCardClick);

            // Register modal close handlers
            this.modal.registerCloseHandler('settings-modal', () => this.closeSettings());
            this.modal.registerCloseHandler('confirm-modal', () => this.closeConfirm());
            this.modal.registerCloseHandler('game-over-modal', () => this.closeGameOver());
            this.modal.registerCloseHandler('help-modal', () => this.closeHelp());
            this.modal.registerCloseHandler('error-modal', () => this.closeError());

            // Subscribe to state changes for UI updates
            this.state.onUIUpdate(this.updateUI);

            // Load settings
            this.loadLocalSettings();

            // Load game from URL or start new
            this.loadGameFromURL();

            // Expose methods to window for HTML onclick handlers
            this.exposeGlobalMethods();
        }

        /**
         * Expose methods for HTML onclick handlers (backward compatibility)
         */
        exposeGlobalMethods() {
            window.newGame = () => this.newGame();
            window.confirmNewGame = () => this.confirmNewGame();
            window.setTeam = (team) => this.setTeam(team);
            window.setSpymaster = (team) => this.setSpymaster(team);
            window.setClicker = (team) => this.setClicker(team);
            window.endTurn = () => this.endTurn();
            window.copyLink = () => this.copyLink();
            window.openSettings = () => this.openSettings();
            window.closeSettings = () => this.closeSettings();
            window.saveSettings = () => this.saveSettings();
            window.closeConfirm = () => this.closeConfirm();
            window.closeGameOver = () => this.closeGameOver();
            window.openHelp = () => this.openHelp();
            window.closeHelp = () => this.closeHelp();
            window.closeError = () => this.closeError();
            window.showToast = (msg, type, dur) => this.toast.show(msg, type, dur);
            window.updateCharCounter = (inputId, counterId, maxLen) =>
                this.updateCharCounter(inputId, counterId, maxLen);
            window.updateWordCount = () => this.updateWordCount();
        }

        /**
         * Handle card click
         */
        handleCardClick(index) {
            if (!this.state.canClickCards()) {
                this.toast.show("It's not your turn or you're not the clicker", 'warning');
                return;
            }

            const gameState = this.state.getGameState();
            if (gameState.revealed[index]) return;

            try {
                const result = window.CodenamesGame.revealCard(gameState, index);
                this.state.game.set(result.newState);

                // Update URL
                this.updateURL();

                // Batch UI updates
                this.scheduleUIUpdate(() => {
                    this.board.updateSingleCard(result.newState, index);
                    this.updateScoreboard();
                    this.updateTurnIndicator();
                    this.updateRoleBanner();
                    this.updateControls();
                });

                // Announce to screen reader
                const cardWord = gameState.words[index];
                this.announcer.announce(`${cardWord} revealed as ${result.cardType}`);

                // Handle game over
                if (result.newState.gameOver) {
                    this.showGameOverModal();
                }
            } catch (error) {
                this.toast.show(error.message, 'error');
            }
        }

        /**
         * Schedule UI update using requestAnimationFrame
         */
        scheduleUIUpdate(callback) {
            if (!this.pendingUIUpdate) {
                this.pendingUIUpdate = true;
                requestAnimationFrame(() => {
                    callback();
                    this.pendingUIUpdate = false;
                });
            }
        }

        /**
         * Update all UI components
         */
        updateUI() {
            const gameState = this.state.getGameState();
            const playerState = this.state.getPlayerState();

            this.board.render(gameState, playerState);
            this.updateScoreboard();
            this.updateTurnIndicator();
            this.updateRoleBanner();
            this.updateControls();
        }

        /**
         * Start a new game
         */
        newGame() {
            if (this.newGameDebounce) return;
            this.newGameDebounce = true;
            setTimeout(() => { this.newGameDebounce = false; }, 500);

            try {
                const seed = window.CodenamesGame.generateGameSeed();
                const gameState = window.CodenamesGame.initGame(seed, this.activeWords, DEFAULT_WORDS);

                this.state.game.reset(gameState);
                this.state.player.set({
                    isHost: true,
                    spymasterTeam: null,
                    clickerTeam: null
                });

                this.updateURL();
                this.updateUI();
                this.updateSpymasterWarning();
            } catch (error) {
                this.toast.show(error.message, 'error');
            }
        }

        /**
         * Confirm new game (check if cards revealed)
         */
        confirmNewGame() {
            const gameState = this.state.getGameState();
            const cardsRevealed = gameState.revealed.filter(r => r).length;

            if (cardsRevealed === 0) {
                this.newGame();
            } else {
                this.modal.open('confirm-modal');
            }
        }

        /**
         * End current turn
         */
        endTurn() {
            if (!this.state.canClickCards()) return;

            const gameState = this.state.getGameState();
            const newState = window.CodenamesGame.endTurn(gameState);
            this.state.game.set(newState);

            this.updateURL();
            this.updateUI();

            const teamName = this.state.getTeamName(newState.currentTurn);
            this.announcer.announceTurnChange(`${teamName}'s turn`);
        }

        /**
         * Set team membership
         */
        setTeam(team) {
            const playerState = this.state.getPlayerState();
            const hadRole = playerState.spymasterTeam || playerState.clickerTeam;

            if (playerState.playerTeam !== team) {
                this.state.player.set({
                    playerTeam: team,
                    spymasterTeam: null,
                    clickerTeam: null
                });
            } else {
                this.state.player.set({ playerTeam: team });
            }

            this.board.render(this.state.getGameState(), this.state.getPlayerState());

            if (hadRole) {
                const teamName = team ? this.state.getTeamName(team) : 'Spectator';
                this.announcer.announce(`Now on ${teamName} team`);
            }
        }

        /**
         * Set spymaster role
         */
        setSpymaster(team) {
            const playerState = this.state.getPlayerState();

            if (playerState.spymasterTeam === team) {
                this.state.player.set({ spymasterTeam: null });
            } else {
                this.state.player.set({
                    spymasterTeam: team,
                    playerTeam: team,
                    clickerTeam: null,
                    isHost: false
                });
            }

            this.updateSpymasterWarning();
            this.board.render(this.state.getGameState(), this.state.getPlayerState(), true);
        }

        /**
         * Set clicker role
         */
        setClicker(team) {
            const playerState = this.state.getPlayerState();

            if (playerState.clickerTeam === team) {
                this.state.player.set({ clickerTeam: null });
            } else {
                this.state.player.set({
                    clickerTeam: team,
                    playerTeam: team,
                    spymasterTeam: null,
                    isHost: false
                });
            }

            this.updateSpymasterWarning();
            this.board.render(this.state.getGameState(), this.state.getPlayerState());
        }

        /**
         * Load game from URL
         */
        loadGameFromURL() {
            const params = new URLSearchParams(window.location.search);
            const { seed, revealed, turn, encodedWords } = this.state.fromURLParams(params);

            if (seed) {
                let gameState;

                if (encodedWords) {
                    const boardWords = window.CodenamesState.decodeWordsFromURL(encodedWords);
                    if (boardWords && boardWords.length === 25) {
                        gameState = window.CodenamesGame.initGameWithWords(seed, boardWords);
                    }
                }

                if (!gameState) {
                    gameState = window.CodenamesGame.initGame(seed, DEFAULT_WORDS, DEFAULT_WORDS);
                }

                gameState = window.CodenamesGame.restoreGameState(gameState, revealed, turn);
                this.state.game.reset(gameState);

                this.state.player.set({
                    isHost: false,
                    spymasterTeam: null,
                    clickerTeam: null,
                    playerTeam: null
                });

                this.updateUI();

                if (gameState.gameOver) {
                    this.showGameOverModal();
                }
            } else {
                this.newGame();
            }
        }

        /**
         * Update URL with current game state
         */
        updateURL() {
            const gameState = this.state.getGameState();
            const { teamNames } = this.state.settings.state;

            const revealed = gameState.revealed.map(r => r ? '1' : '0').join('');
            const turn = gameState.currentTurn === 'blue' ? 'b' : 'r';

            let url = `${window.location.origin}${window.location.pathname}?game=${gameState.seed}&r=${revealed}&t=${turn}`;

            if (gameState.customWords && gameState.words.length === 25) {
                url += `&w=${window.CodenamesState.encodeWordsForURL(gameState.words)}`;
            }

            if (teamNames.red !== 'Red') {
                url += `&rn=${encodeURIComponent(teamNames.red)}`;
            }
            if (teamNames.blue !== 'Blue') {
                url += `&bn=${encodeURIComponent(teamNames.blue)}`;
            }

            window.history.replaceState({}, '', url);

            const shareLink = this.cache.get('shareLink');
            if (shareLink) shareLink.value = url;
        }

        // UI Update methods
        updateScoreboard() {
            const gameState = this.state.getGameState();
            const { teamNames } = this.state.settings.state;

            const redRemaining = this.cache.get('redRemaining');
            const blueRemaining = this.cache.get('blueRemaining');
            const redTeamName = this.cache.get('redTeamName');
            const blueTeamName = this.cache.get('blueTeamName');

            if (redRemaining) redRemaining.textContent = gameState.redTotal - gameState.redScore;
            if (blueRemaining) blueRemaining.textContent = gameState.blueTotal - gameState.blueScore;
            if (redTeamName) redTeamName.textContent = teamNames.red;
            if (blueTeamName) blueTeamName.textContent = teamNames.blue;
        }

        updateTurnIndicator() {
            const indicator = this.cache.get('turnIndicator');
            if (!indicator) return;

            const gameState = this.state.getGameState();
            const { teamNames } = this.state.settings.state;
            const playerState = this.state.getPlayerState();

            const teamName = teamNames[gameState.currentTurn];

            if (gameState.gameOver) {
                const winnerName = teamNames[gameState.winner];
                indicator.textContent = `${winnerName} WINS!`;
                indicator.className = 'turn-indicator glass-panel-subtle game-over';
            } else {
                indicator.textContent = `${teamName}'s Turn`;
                indicator.className = `turn-indicator glass-panel-subtle ${gameState.currentTurn}-turn`;

                // Add pulse animation if it's the current player's team's turn
                const isYourTurn = (playerState.clickerTeam === gameState.currentTurn) ||
                    (playerState.spymasterTeam === gameState.currentTurn);
                indicator.classList.toggle('your-turn', isYourTurn);
            }
        }

        updateRoleBanner() {
            const banner = this.cache.get('roleBanner');
            if (!banner) return;

            const gameState = this.state.getGameState();
            const playerState = this.state.getPlayerState();
            const { teamNames } = this.state.settings.state;

            const escapeHTML = window.CodenamesUI.escapeHTML;

            if (playerState.spymasterTeam === 'red') {
                banner.className = 'role-banner spymaster-red';
                const hint = gameState.currentTurn === 'red' && !gameState.gameOver
                    ? "Give your team a clue!"
                    : "Wait for your turn to give a clue";
                banner.innerHTML = `You are the <strong>${escapeHTML(teamNames.red)}</strong> SPYMASTER<small>${hint}</small>`;
            } else if (playerState.spymasterTeam === 'blue') {
                banner.className = 'role-banner spymaster-blue';
                const hint = gameState.currentTurn === 'blue' && !gameState.gameOver
                    ? "Give your team a clue!"
                    : "Wait for your turn to give a clue";
                banner.innerHTML = `You are the <strong>${escapeHTML(teamNames.blue)}</strong> SPYMASTER<small>${hint}</small>`;
            } else if (playerState.clickerTeam === 'red') {
                banner.className = 'role-banner clicker-red';
                const hint = gameState.currentTurn === 'red' && !gameState.gameOver
                    ? "Click cards to reveal guesses"
                    : `Waiting for ${escapeHTML(teamNames.blue)}'s turn`;
                banner.innerHTML = `You are the <strong>${escapeHTML(teamNames.red)}</strong> CLICKER<small>${hint}</small>`;
            } else if (playerState.clickerTeam === 'blue') {
                banner.className = 'role-banner clicker-blue';
                const hint = gameState.currentTurn === 'blue' && !gameState.gameOver
                    ? "Click cards to reveal guesses"
                    : `Waiting for ${escapeHTML(teamNames.red)}'s turn`;
                banner.innerHTML = `You are the <strong>${escapeHTML(teamNames.blue)}</strong> CLICKER<small>${hint}</small>`;
            } else if (playerState.isHost) {
                banner.className = 'role-banner host';
                banner.innerHTML = 'You are the HOST<small>Start new games. Join a team to play!</small>';
            } else if (playerState.playerTeam) {
                banner.className = `role-banner spectator-${playerState.playerTeam}`;
                banner.innerHTML = `You are on the <strong>${escapeHTML(teamNames[playerState.playerTeam])}</strong> team<small>Discuss guesses with your team!</small>`;
            } else {
                banner.className = 'role-banner viewer';
                banner.innerHTML = 'You are a SPECTATOR<small>Join a team to participate!</small>';
            }
        }

        updateControls() {
            const playerState = this.state.getPlayerState();
            const gameState = this.state.getGameState();

            const endTurnBtn = this.cache.get('endTurnBtn');
            const canAct = playerState.clickerTeam &&
                playerState.clickerTeam === gameState.currentTurn &&
                !gameState.gameOver;

            if (endTurnBtn) {
                endTurnBtn.disabled = !canAct;
                endTurnBtn.classList.toggle('can-act', canAct);
            }

            // Update role button states
            const buttons = [
                { id: 'redSpyBtn', active: playerState.spymasterTeam === 'red' },
                { id: 'blueSpyBtn', active: playerState.spymasterTeam === 'blue' },
                { id: 'redClickerBtn', active: playerState.clickerTeam === 'red' },
                { id: 'blueClickerBtn', active: playerState.clickerTeam === 'blue' },
                { id: 'redTeamBtn', active: playerState.playerTeam === 'red' && !playerState.spymasterTeam && !playerState.clickerTeam },
                { id: 'blueTeamBtn', active: playerState.playerTeam === 'blue' && !playerState.spymasterTeam && !playerState.clickerTeam },
                { id: 'spectateBtn', active: !playerState.playerTeam && !playerState.spymasterTeam && !playerState.clickerTeam }
            ];

            buttons.forEach(({ id, active }) => {
                const btn = this.cache.get(id);
                if (btn) {
                    btn.classList.toggle('active', active);
                    btn.setAttribute('aria-pressed', active.toString());
                }
            });
        }

        updateSpymasterWarning() {
            const warning = this.cache.get('spymasterWarning');
            if (warning) {
                warning.classList.toggle('visible', !!this.state.player.get('spymasterTeam'));
            }
        }

        // Modal methods
        showGameOverModal() {
            const gameState = this.state.getGameState();
            const { teamNames } = this.state.settings.state;
            const winnerName = teamNames[gameState.winner];

            const winnerDisplay = document.getElementById('winner-display');
            if (winnerDisplay) {
                winnerDisplay.innerHTML = `${window.CodenamesUI.escapeHTML(winnerName)} WINS!`;
                winnerDisplay.className = `winner-display ${gameState.winner}`;
            }

            this.modal.open('game-over-modal');
        }

        closeGameOver() { this.modal.close('game-over-modal'); }
        closeConfirm() { this.modal.close('confirm-modal'); }
        openHelp() { this.modal.open('help-modal'); }
        closeHelp() { this.modal.close('help-modal'); }
        closeError() { this.modal.close('error-modal'); }

        openSettings() {
            // Load current settings into form
            const { teamNames } = this.state.settings.state;
            const redNameInput = document.getElementById('red-team-name-input');
            const blueNameInput = document.getElementById('blue-team-name-input');

            if (redNameInput) redNameInput.value = teamNames.red;
            if (blueNameInput) blueNameInput.value = teamNames.blue;

            this.modal.open('settings-modal');
        }

        closeSettings() { this.modal.close('settings-modal'); }

        saveSettings() {
            const redNameInput = document.getElementById('red-team-name-input');
            const blueNameInput = document.getElementById('blue-team-name-input');

            const newTeamNames = {
                red: (redNameInput?.value || 'Red').slice(0, 20) || 'Red',
                blue: (blueNameInput?.value || 'Blue').slice(0, 20) || 'Blue'
            };

            this.state.settings.set({ teamNames: newTeamNames });
            this.updateURL();
            this.updateUI();
            this.closeSettings();
            this.toast.show('Settings saved!', 'success', 2000);
        }

        copyLink() {
            const shareLink = this.cache.get('shareLink');
            if (!shareLink) return;

            shareLink.select();
            shareLink.setSelectionRange(0, 99999);

            navigator.clipboard.writeText(shareLink.value)
                .then(() => this.toast.show('Link copied!', 'success', 2000))
                .catch(() => this.toast.show('Failed to copy link', 'error'));
        }

        updateCharCounter(inputId, counterId, maxLength) {
            const input = document.getElementById(inputId);
            const counter = document.getElementById(counterId);
            if (!input || !counter) return;

            const length = input.value.length;
            counter.textContent = `${length}/${maxLength}`;

            counter.classList.remove('warning', 'limit');
            if (length >= maxLength) {
                counter.classList.add('limit');
            } else if (length >= maxLength * 0.8) {
                counter.classList.add('warning');
            }
        }

        updateWordCount() {
            // Implementation for custom word count
        }

        loadLocalSettings() {
            try {
                const colorblind = localStorage.getItem('codenames-colorblind');
                if (colorblind === 'true') {
                    this.state.ui.set({ colorblindMode: true });
                    document.body.classList.add('colorblind-mode');
                }
            } catch (e) {
                // localStorage not available
            }
        }
    }

    // Initialize application when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            window.codenamesApp = new CodenamesApp();
            window.codenamesApp.init();
        });
    } else {
        window.codenamesApp = new CodenamesApp();
        window.codenamesApp.init();
    }

})();
