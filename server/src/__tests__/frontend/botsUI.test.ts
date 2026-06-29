/**
 * Frontend botsUI tests (jsdom): host add-bot panel + remove-bot.
 */
const mockShowToast = jest.fn();
jest.mock('../../frontend/ui', () => ({ showToast: mockShowToast }));
jest.mock('../../frontend/i18n', () => ({ t: jest.fn((k: string) => k) }));
jest.mock('../../frontend/clientAccessor', () => ({ isClientConnected: jest.fn(() => true) }));

(global as any).EigennamenClient = {
    player: { isHost: true },
    addBot: jest.fn(),
    removeBot: jest.fn(),
};

import { strategyFor, addBotFromForm, removeBot, updateBotPanelVisibility } from '../../frontend/botsUI';

function setupDom(): void {
    document.body.innerHTML = `
        <div id="bots-panel" hidden>
          <select id="bot-team-select"><option value="red">Red</option><option value="blue">Blue</option></select>
          <select id="bot-seat-select"><option value="spymaster">Spy</option><option value="clicker">Clicker</option></select>
          <select id="bot-style-select"><option value="smart">Smart</option><option value="cautious">Cautious</option><option value="random">Random</option></select>
          <select id="bot-skill-select"><option value="expert">Expert</option></select>
        </div>`;
}

describe('strategyFor', () => {
    it('maps spymaster styles', () => {
        expect(strategyFor('spymaster', 'smart')).toBe('embeddingSpymaster');
        expect(strategyFor('spymaster', 'random')).toBe('randomSpymaster');
    });
    it('maps clicker styles', () => {
        expect(strategyFor('clicker', 'smart')).toBe('greedyClicker');
        expect(strategyFor('clicker', 'cautious')).toBe('cautiousClicker');
        expect(strategyFor('clicker', 'random')).toBe('randomClicker');
    });
});

describe('addBotFromForm', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        setupDom();
        (EigennamenClient as any).player = { isHost: true };
    });

    it('adds a smart spymaster bot from the form selections', () => {
        (document.getElementById('bot-team-select') as HTMLSelectElement).value = 'blue';
        (document.getElementById('bot-seat-select') as HTMLSelectElement).value = 'spymaster';
        (document.getElementById('bot-style-select') as HTMLSelectElement).value = 'smart';
        addBotFromForm();
        expect(EigennamenClient.addBot).toHaveBeenCalledWith('blue', 'spymaster', 'embeddingSpymaster', 'expert');
    });

    it('refuses when the local player is not the host', () => {
        (EigennamenClient as any).player = { isHost: false };
        addBotFromForm();
        expect(EigennamenClient.addBot).not.toHaveBeenCalled();
        expect(mockShowToast).toHaveBeenCalled();
    });
});

describe('removeBot', () => {
    beforeEach(() => jest.clearAllMocks());
    it('emits bot:remove for a session id', () => {
        removeBot('bot-1');
        expect(EigennamenClient.removeBot).toHaveBeenCalledWith('bot-1');
    });
    it('ignores an empty session id', () => {
        removeBot('');
        expect(EigennamenClient.removeBot).not.toHaveBeenCalled();
    });
});

describe('updateBotPanelVisibility', () => {
    beforeEach(() => setupDom());
    it('shows the panel to the host and hides it from non-hosts', () => {
        (EigennamenClient as any).player = { isHost: true };
        updateBotPanelVisibility();
        expect((document.getElementById('bots-panel') as HTMLElement).hidden).toBe(false);

        (EigennamenClient as any).player = { isHost: false };
        updateBotPanelVisibility();
        expect((document.getElementById('bots-panel') as HTMLElement).hidden).toBe(true);
    });
});
