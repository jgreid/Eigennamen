/**
 * Clue Validator - Pure clue validation logic
 *
 * Validates that spymaster clues don't match or contain board words.
 * Uses NFKC Unicode normalization and locale-safe string comparison.
 */

import type { ClueValidationResult } from '../../types';

import { toEnglishUpperCase, localeIncludes } from '../../utils/sanitize';
/**
 * Validate that a clue word is not on the board
 *
 * Rules:
 * - Exact matches are never allowed
 * - Partial matches (clue contains board word or vice versa) are blocked
 *   unless the contained word is 1 character (common articles like "A", "I")
 *
 * Uses NFKC normalization to prevent bypassing validation with
 * visually similar but technically different characters (e.g., ligatures).
 */
export function validateClueWord(clueWord: string, boardWords: string[]): ClueValidationResult {
    const normalizedClue = toEnglishUpperCase(String(clueWord).normalize('NFKC').trim());

    if (normalizedClue.length === 0) {
        return { valid: false, reason: 'Clue cannot be empty' };
    }

    for (const boardWord of boardWords) {
        const normalizedBoardWord = toEnglishUpperCase(String(boardWord).normalize('NFKC').trim());

        // Exact match — always invalid
        if (normalizedClue === normalizedBoardWord) {
            return { valid: false, reason: `"${clueWord}" is a word on the board` };
        }

        // Clue contains board word (e.g., clue "SNOWMAN" contains board word "SNOW")
        if (localeIncludes(normalizedClue, normalizedBoardWord, false)) {
            if (normalizedBoardWord.length > 1) {
                return { valid: false, reason: `"${clueWord}" contains board word "${boardWord}"` };
            }
        }

        // Board word contains clue (e.g., board word "SNOWMAN" contains clue "SNOW")
        if (localeIncludes(normalizedBoardWord, normalizedClue, false)) {
            if (normalizedClue.length > 1) {
                return { valid: false, reason: `Board word "${boardWord}" contains "${clueWord}"` };
            }
        }
    }

    return { valid: true };
}
