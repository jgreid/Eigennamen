/**
 * Frontend clueUI tests (jsdom): live clue chip + spymaster clue form.
 */
const mockShowToast = jest.fn();
jest.mock('../../frontend/ui', () => ({ showToast: mockShowToast }));
jest.mock('../../frontend/i18n', () => ({ t: jest.fn((k: string) => k) }));
jest.mock('../../frontend/clientAccessor', () => ({ isClientConnected: jest.fn(() => true) }));
jest.mock('../../frontend/state', () => ({
    state: {
        isMultiplayerMode: true,
        spymasterTeam: null,
        gameState: { gameOver: false, currentTurn: 'red', currentClue: null },
    },
}));

(global as any).EigennamenClient = { submitClue: jest.fn() };

import { updateClueUI, submitClueFromForm, initClueUI } from '../../frontend/clueUI';
import { state } from '../../frontend/state';

function setupDom(): void {
    document.body.innerHTML = `
        <div id="clue-display" hidden>
          <span id="clue-display-word"></span>
          <span id="clue-display-number"></span>
        </div>
        <form id="clue-controls" hidden>
          <input id="clue-word-input" />
          <input id="clue-number-input" type="number" value="1" />
          <button type="submit" id="btn-give-clue">Give</button>
        </form>`;
}

describe('updateClueUI', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        setupDom();
        (state as any).isMultiplayerMode = true;
        (state as any).spymasterTeam = null;
        (state as any).gameState = { gameOver: false, currentTurn: 'red', currentClue: null };
    });

    it('shows the clue chip with word/number/team when a clue exists', () => {
        (state as any).gameState.currentClue = { word: 'FRUIT', number: 3, team: 'red' };
        updateClueUI();
        const display = document.getElementById('clue-display') as HTMLElement;
        expect(display.hidden).toBe(false);
        expect(document.getElementById('clue-display-word')!.textContent).toBe('FRUIT');
        expect(document.getElementById('clue-display-number')!.textContent).toContain('3');
        expect(display.classList.contains('clue-red')).toBe(true);
    });

    it('hides the chip when there is no clue', () => {
        updateClueUI();
        expect((document.getElementById('clue-display') as HTMLElement).hidden).toBe(true);
    });

    it('shows the form to the current-turn spymaster with no clue yet', () => {
        (state as any).spymasterTeam = 'red';
        updateClueUI();
        expect((document.getElementById('clue-controls') as HTMLElement).hidden).toBe(false);
    });

    it('hides the form once a clue has been given', () => {
        (state as any).spymasterTeam = 'red';
        (state as any).gameState.currentClue = { word: 'X', number: 1, team: 'red' };
        updateClueUI();
        expect((document.getElementById('clue-controls') as HTMLElement).hidden).toBe(true);
    });

    it('hides the form for the spymaster of the team NOT on turn', () => {
        (state as any).spymasterTeam = 'blue';
        updateClueUI();
        expect((document.getElementById('clue-controls') as HTMLElement).hidden).toBe(true);
    });
});

describe('submitClueFromForm', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        setupDom();
    });

    it('emits game:clue with the word and number and clears the inputs', () => {
        (document.getElementById('clue-word-input') as HTMLInputElement).value = 'fruit';
        (document.getElementById('clue-number-input') as HTMLInputElement).value = '3';
        submitClueFromForm();
        expect(EigennamenClient.submitClue).toHaveBeenCalledWith('fruit', 3);
        expect((document.getElementById('clue-word-input') as HTMLInputElement).value).toBe('');
    });

    it('rejects an empty word', () => {
        (document.getElementById('clue-word-input') as HTMLInputElement).value = '   ';
        submitClueFromForm();
        expect(EigennamenClient.submitClue).not.toHaveBeenCalled();
        expect(mockShowToast).toHaveBeenCalled();
    });

    it('rejects a multi-word clue', () => {
        (document.getElementById('clue-word-input') as HTMLInputElement).value = 'ice cream';
        submitClueFromForm();
        expect(EigennamenClient.submitClue).not.toHaveBeenCalled();
    });

    it('submits on form submit after initClueUI', () => {
        initClueUI();
        (document.getElementById('clue-word-input') as HTMLInputElement).value = 'animal';
        (document.getElementById('clue-controls') as HTMLFormElement).dispatchEvent(
            new Event('submit', { cancelable: true })
        );
        expect(EigennamenClient.submitClue).toHaveBeenCalledWith('animal', 1);
    });
});
