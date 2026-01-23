/**
 * Unit tests for QR Code Generator module
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { generate, toCanvas, ErrorCorrectionLevel } from '../qrcode.js';

describe('QRCode', () => {
  describe('generate', () => {
    it('should generate a valid QR matrix for short text', () => {
      const matrix = generate('HELLO');

      expect(matrix).toBeDefined();
      expect(Array.isArray(matrix)).toBe(true);
      expect(matrix.length).toBeGreaterThan(0);

      // Matrix should be square
      expect(matrix.length).toBe(matrix[0].length);

      // All values should be 0 or 1
      for (const row of matrix) {
        for (const cell of row) {
          expect(cell === 0 || cell === 1).toBe(true);
        }
      }
    });

    it('should generate version 1 QR code for short text', () => {
      const matrix = generate('HI');

      // Version 1 is 21x21 modules
      expect(matrix.length).toBe(21);
    });

    it('should generate larger QR code for longer text', () => {
      const shortMatrix = generate('A');
      const longMatrix = generate('This is a much longer text that requires more data capacity');

      expect(longMatrix.length).toBeGreaterThan(shortMatrix.length);
    });

    it('should throw error for data too long', () => {
      // Create very long text that exceeds version 10 capacity
      const veryLongText = 'x'.repeat(500);

      expect(() => generate(veryLongText)).toThrow('Data too long for QR code');
    });

    it('should handle UTF-8 encoding', () => {
      // Should not throw for UTF-8 characters
      expect(() => generate('Hello 世界')).not.toThrow();
      expect(() => generate('émojis: 🎮🎯')).not.toThrow();
    });

    it('should use different error correction levels', () => {
      const textM = 'Test';

      // Different EC levels should all work
      const matrixL = generate(textM, ErrorCorrectionLevel.L);
      const matrixM = generate(textM, ErrorCorrectionLevel.M);
      const matrixQ = generate(textM, ErrorCorrectionLevel.Q);
      const matrixH = generate(textM, ErrorCorrectionLevel.H);

      // All should generate valid matrices
      expect(matrixL.length).toBeGreaterThan(0);
      expect(matrixM.length).toBeGreaterThan(0);
      expect(matrixQ.length).toBeGreaterThan(0);
      expect(matrixH.length).toBeGreaterThan(0);
    });

    it('should have finder patterns in corners', () => {
      const matrix = generate('TEST');

      // Top-left finder pattern should have characteristic pattern
      // (7x7 with black border, white inside border, black center 3x3)
      expect(matrix[0][0]).toBe(1);
      expect(matrix[0][6]).toBe(1);
      expect(matrix[6][0]).toBe(1);
      expect(matrix[6][6]).toBe(1);

      // White separator
      expect(matrix[0][7]).toBe(0);
      expect(matrix[7][0]).toBe(0);
    });

    it('should produce deterministic output', () => {
      const text = 'Deterministic test';
      const matrix1 = generate(text);
      const matrix2 = generate(text);

      expect(matrix1).toEqual(matrix2);
    });
  });

  describe('toCanvas', () => {
    let canvas;
    let mockContext;

    beforeEach(() => {
      mockContext = {
        fillStyle: '',
        fillRect: () => {},
      };

      canvas = {
        width: 0,
        height: 0,
        getContext: () => mockContext,
      };
    });

    it('should set canvas dimensions based on matrix size and scale', () => {
      const matrix = generate('A'); // Version 1: 21x21

      toCanvas(canvas, matrix, { scale: 4, margin: 2 });

      // Canvas size = (21 + 2*2) * 4 = 100
      expect(canvas.width).toBe(100);
      expect(canvas.height).toBe(100);
    });

    it('should use default options when none provided', () => {
      const matrix = generate('A'); // Version 1: 21x21

      toCanvas(canvas, matrix);

      // Default scale=4, margin=2: (21 + 4) * 4 = 100
      expect(canvas.width).toBe(100);
      expect(canvas.height).toBe(100);
    });

    it('should respect custom scale option', () => {
      const matrix = generate('A'); // 21x21

      toCanvas(canvas, matrix, { scale: 10, margin: 1 });

      // (21 + 2) * 10 = 230
      expect(canvas.width).toBe(230);
      expect(canvas.height).toBe(230);
    });

    it('should set fill colors correctly', () => {
      const matrix = generate('A');
      const fillStyles = [];

      mockContext.fillRect = () => {
        fillStyles.push(mockContext.fillStyle);
      };

      toCanvas(canvas, matrix, {
        dark: '#1a1a2e',
        light: '#ffffff',
      });

      // First fill should be light (background)
      expect(fillStyles[0]).toBe('#ffffff');

      // Subsequent fills for dark modules should be dark color
      const darkFills = fillStyles.filter(s => s === '#1a1a2e');
      expect(darkFills.length).toBeGreaterThan(0);
    });
  });

  describe('ErrorCorrectionLevel', () => {
    it('should have correct numeric values', () => {
      expect(ErrorCorrectionLevel.L).toBe(0);
      expect(ErrorCorrectionLevel.M).toBe(1);
      expect(ErrorCorrectionLevel.Q).toBe(2);
      expect(ErrorCorrectionLevel.H).toBe(3);
    });
  });

  describe('URL encoding', () => {
    it('should handle typical game URLs', () => {
      const gameUrl = 'https://codenames.example.com/game?seed=12345&teams=red,blue';

      const matrix = generate(gameUrl);

      expect(matrix).toBeDefined();
      expect(matrix.length).toBeGreaterThan(0);
    });

    it('should handle URLs with special characters', () => {
      const urlWithParams = 'https://example.com?name=Test%20Game&mode=classic';

      expect(() => generate(urlWithParams)).not.toThrow();
    });
  });
});
