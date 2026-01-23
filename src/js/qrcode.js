/**
 * QR Code Generator with Reed-Solomon Error Correction
 *
 * A complete QR code implementation supporting versions 1-10 with
 * proper error correction using Reed-Solomon encoding.
 *
 * @module qrcode
 */

// GF(256) arithmetic for Reed-Solomon
const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);

// Initialize Galois Field lookup tables
(function initGF() {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x = (x << 1) ^ (x >= 128 ? 0x11d : 0);
  }
  for (let i = 255; i < 512; i++) {
    EXP[i] = EXP[i - 255];
  }
})();

/**
 * Multiply two numbers in GF(256)
 * @param {number} a - First operand
 * @param {number} b - Second operand
 * @returns {number} Product in GF(256)
 */
function gfMul(a, b) {
  return a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]];
}

/**
 * Generate Reed-Solomon generator polynomial
 * @param {number} n - Number of error correction codewords
 * @returns {number[]} Generator polynomial coefficients
 */
function rsGenPoly(n) {
  let poly = [1];
  for (let i = 0; i < n; i++) {
    const newPoly = new Array(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j++) {
      newPoly[j] ^= gfMul(poly[j], EXP[i]);
      newPoly[j + 1] ^= poly[j];
    }
    poly = newPoly;
  }
  return poly;
}

/**
 * Encode data using Reed-Solomon
 * @param {Uint8Array} data - Data to encode
 * @param {number} eccLen - Number of error correction codewords
 * @returns {number[]} Error correction codewords
 */
function rsEncode(data, eccLen) {
  const gen = rsGenPoly(eccLen);
  const result = new Uint8Array(data.length + eccLen);
  result.set(data);
  for (let i = 0; i < data.length; i++) {
    const coef = result[i];
    if (coef !== 0) {
      for (let j = 0; j < gen.length; j++) {
        result[i + j] ^= gfMul(gen[j], coef);
      }
    }
  }
  return Array.from(result.slice(data.length));
}

// EC levels: L=0, M=1, Q=2, H=3 (standard order)
const EC_CODEWORDS = [
  [7, 10, 13, 17], [10, 16, 22, 28], [15, 26, 36, 44], [20, 36, 52, 64], [26, 48, 72, 88],
  [36, 64, 96, 112], [40, 72, 108, 130], [48, 88, 132, 156], [60, 110, 160, 192], [72, 130, 192, 224]
];

const DATA_CODEWORDS = [
  [19, 16, 13, 9], [34, 28, 22, 16], [55, 44, 34, 26], [80, 64, 48, 36], [108, 86, 62, 46],
  [136, 108, 76, 60], [156, 124, 88, 66], [194, 154, 110, 86], [232, 182, 132, 100], [274, 216, 154, 122]
];

const EC_BLOCKS = [
  [[1, 19], [1, 16], [1, 13], [1, 9]],
  [[1, 34], [1, 28], [1, 22], [1, 16]],
  [[1, 55], [1, 44], [2, 17], [2, 13]],
  [[1, 80], [2, 32], [2, 24], [4, 9]],
  [[1, 108], [2, 43], [2, 15, 2, 16], [2, 11, 2, 12]],
  [[2, 68], [4, 27], [4, 19], [4, 15]],
  [[2, 78], [4, 31], [2, 14, 4, 15], [4, 13, 1, 14]],
  [[2, 97], [2, 38, 2, 39], [4, 18, 2, 19], [4, 14, 2, 15]],
  [[2, 116], [3, 36, 2, 37], [4, 16, 4, 17], [4, 12, 4, 13]],
  [[2, 68, 2, 69], [4, 43, 1, 44], [6, 19, 2, 20], [6, 15, 2, 16]]
];

/**
 * Encode text to UTF-8 bytes
 * @param {string} text - Text to encode
 * @returns {number[]} UTF-8 encoded bytes
 */
function encodeUTF8(text) {
  const bytes = [];
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c < 0x80) {
      bytes.push(c);
    } else if (c < 0x800) {
      bytes.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
    } else if (c < 0x10000) {
      bytes.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
    } else {
      bytes.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 0x3f), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
    }
  }
  return bytes;
}

/**
 * Determine minimum QR version needed for data
 * @param {number} len - Data length in bytes
 * @param {number} ecl - Error correction level (0-3)
 * @returns {number} QR version (1-10, or 11 if too long)
 */
function getVersion(len, ecl) {
  for (let v = 1; v <= 10; v++) {
    const cap = DATA_CODEWORDS[v - 1][ecl];
    const overhead = v < 10 ? 2 : 3; // mode + length indicator
    if (len <= cap - overhead) return v;
  }
  return 11;
}

/**
 * Encode data bytes into QR codewords with error correction
 * @param {number[]} bytes - Data bytes
 * @param {number} version - QR version
 * @param {number} ecl - Error correction level
 * @returns {number[]} Interleaved data and error correction codewords
 */
function encodeData(bytes, version, ecl) {
  const totalData = DATA_CODEWORDS[version - 1][ecl];
  const bits = [];

  // Byte mode indicator
  bits.push(0, 1, 0, 0);

  // Length
  const lenBits = version < 10 ? 8 : 16;
  for (let i = lenBits - 1; i >= 0; i--) {
    bits.push((bytes.length >> i) & 1);
  }

  // Data
  for (const b of bytes) {
    for (let i = 7; i >= 0; i--) {
      bits.push((b >> i) & 1);
    }
  }

  // Terminator
  for (let i = 0; i < 4 && bits.length < totalData * 8; i++) {
    bits.push(0);
  }

  // Pad to byte
  while (bits.length % 8 !== 0) {
    bits.push(0);
  }

  // Convert to bytes
  const dataBytes = [];
  for (let i = 0; i < bits.length; i += 8) {
    let b = 0;
    for (let j = 0; j < 8; j++) {
      b = (b << 1) | (bits[i + j] || 0);
    }
    dataBytes.push(b);
  }

  // Pad bytes
  while (dataBytes.length < totalData) {
    dataBytes.push(dataBytes.length % 2 === 0 ? 0xec : 0x11);
  }

  // Apply Reed-Solomon
  const blocks = EC_BLOCKS[version - 1][ecl];
  const blockInfo = blocks.length === 2
    ? [[blocks[0], blocks[1]]]
    : [[blocks[0], blocks[1]], [blocks[2], blocks[3]]];
  const totalBlocks = blockInfo.reduce((sum, [count]) => sum + count, 0);
  const eccPerBlock = Math.floor(EC_CODEWORDS[version - 1][ecl] / totalBlocks);
  const dataBlocks = [];
  const eccBlocks = [];
  let offset = 0;

  for (const [count, size] of blockInfo) {
    for (let i = 0; i < count; i++) {
      const block = dataBytes.slice(offset, offset + size);
      dataBlocks.push(block);
      eccBlocks.push(rsEncode(new Uint8Array(block), eccPerBlock));
      offset += size;
    }
  }

  // Interleave
  const result = [];
  const maxDataLen = Math.max(...dataBlocks.map(b => b.length));
  for (let i = 0; i < maxDataLen; i++) {
    for (const block of dataBlocks) {
      if (i < block.length) result.push(block[i]);
    }
  }
  for (let i = 0; i < eccPerBlock; i++) {
    for (const block of eccBlocks) {
      result.push(block[i]);
    }
  }
  return result;
}

/**
 * Place finder patterns, timing patterns, and alignment patterns
 * @param {number[][]} matrix - QR matrix
 * @param {boolean[][]} isFunc - Function pattern mask
 * @param {number} version - QR version
 */
function placePatterns(matrix, isFunc, version) {
  const size = matrix.length;

  // Finder patterns
  for (const [ox, oy] of [[0, 0], [size - 7, 0], [0, size - 7]]) {
    for (let y = -1; y <= 7; y++) {
      for (let x = -1; x <= 7; x++) {
        const px = ox + x;
        const py = oy + y;
        if (px >= 0 && px < size && py >= 0 && py < size) {
          const val = (x >= 0 && x <= 6 && y >= 0 && y <= 6) &&
            (x === 0 || x === 6 || y === 0 || y === 6 ||
              (x >= 2 && x <= 4 && y >= 2 && y <= 4));
          matrix[py][px] = val ? 1 : 0;
          isFunc[py][px] = true;
        }
      }
    }
  }

  // Timing patterns
  for (let i = 8; i < size - 8; i++) {
    const val = i % 2 === 0 ? 1 : 0;
    matrix[6][i] = val;
    isFunc[6][i] = true;
    matrix[i][6] = val;
    isFunc[i][6] = true;
  }

  // Alignment pattern for version >= 2
  if (version >= 2) {
    const pos = [6, version * 4 + 10];
    for (const ay of pos) {
      for (const ax of pos) {
        if (isFunc[ay][ax]) continue;
        for (let dy = -2; dy <= 2; dy++) {
          for (let dx = -2; dx <= 2; dx++) {
            const val = Math.abs(dx) === 2 || Math.abs(dy) === 2 ||
              (dx === 0 && dy === 0) ? 1 : 0;
            matrix[ay + dy][ax + dx] = val;
            isFunc[ay + dy][ax + dx] = true;
          }
        }
      }
    }
  }

  // Dark module
  matrix[size - 8][8] = 1;
  isFunc[size - 8][8] = true;

  // Reserve format areas
  for (let i = 0; i < 9; i++) {
    if (!isFunc[8][i]) {
      matrix[8][i] = 0;
      isFunc[8][i] = true;
    }
    if (!isFunc[i][8]) {
      matrix[i][8] = 0;
      isFunc[i][8] = true;
    }
  }
  for (let i = 0; i < 8; i++) {
    if (!isFunc[8][size - 8 + i]) {
      matrix[8][size - 8 + i] = 0;
      isFunc[8][size - 8 + i] = true;
    }
    if (!isFunc[size - 8 + i][8]) {
      matrix[size - 8 + i][8] = 0;
      isFunc[size - 8 + i][8] = true;
    }
  }
}

/**
 * Place data codewords in the matrix
 * @param {number[][]} matrix - QR matrix
 * @param {boolean[][]} isFunc - Function pattern mask
 * @param {number[]} codewords - Data codewords
 */
function placeData(matrix, isFunc, codewords) {
  const size = matrix.length;
  let i = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? size - 1 - vert : vert;
        if (!isFunc[y][x] && i < codewords.length * 8) {
          matrix[y][x] = (codewords[Math.floor(i / 8)] >> (7 - (i % 8))) & 1;
          i++;
        }
      }
    }
  }
}

/**
 * Apply mask pattern to matrix
 * @param {number[][]} matrix - QR matrix
 * @param {boolean[][]} isFunc - Function pattern mask
 * @param {number} mask - Mask pattern (0-7)
 */
function applyMask(matrix, isFunc, mask) {
  const size = matrix.length;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (isFunc[y][x]) continue;
      let invert = false;
      switch (mask) {
        case 0: invert = (x + y) % 2 === 0; break;
        case 1: invert = y % 2 === 0; break;
        case 2: invert = x % 3 === 0; break;
        case 3: invert = (x + y) % 3 === 0; break;
        case 4: invert = (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0; break;
        case 5: invert = (x * y) % 2 + (x * y) % 3 === 0; break;
        case 6: invert = ((x * y) % 2 + (x * y) % 3) % 2 === 0; break;
        case 7: invert = ((x + y) % 2 + (x * y) % 3) % 2 === 0; break;
      }
      if (invert) matrix[y][x] ^= 1;
    }
  }
}

/**
 * Place format information in matrix
 * @param {number[][]} matrix - QR matrix
 * @param {number} ecl - Error correction level
 * @param {number} mask - Mask pattern
 */
function placeFormat(matrix, ecl, mask) {
  const size = matrix.length;
  const eccBits = [1, 0, 3, 2][ecl]; // L, M, Q, H
  let data = (eccBits << 3) | mask;
  let rem = data;
  for (let i = 0; i < 10; i++) {
    rem = (rem << 1) ^ ((rem >> 9) * 0x537);
  }
  const bits = ((data << 10) | rem) ^ 0x5412;
  for (let i = 0; i < 6; i++) matrix[8][i] = (bits >> i) & 1;
  matrix[8][7] = (bits >> 6) & 1;
  matrix[8][8] = (bits >> 7) & 1;
  matrix[7][8] = (bits >> 8) & 1;
  for (let i = 9; i < 15; i++) matrix[14 - i][8] = (bits >> i) & 1;
  for (let i = 0; i < 8; i++) matrix[8][size - 1 - i] = (bits >> i) & 1;
  for (let i = 8; i < 15; i++) matrix[size - 15 + i][8] = (bits >> i) & 1;
}

/**
 * Place version information in matrix (for version >= 7)
 * @param {number[][]} matrix - QR matrix
 * @param {number} version - QR version
 */
function placeVersion(matrix, version) {
  if (version < 7) return;
  const size = matrix.length;
  let rem = version;
  for (let i = 0; i < 12; i++) {
    rem = (rem << 1) ^ ((rem >> 11) * 0x1f25);
  }
  const bits = (version << 12) | rem;
  for (let i = 0; i < 18; i++) {
    const bit = (bits >> i) & 1;
    const x = Math.floor(i / 3);
    const y = i % 3 + size - 11;
    matrix[x][y] = bit;
    matrix[y][x] = bit;
  }
}

/**
 * Calculate penalty score for mask selection
 * @param {number[][]} matrix - QR matrix
 * @returns {number} Penalty score
 */
function calcPenalty(matrix) {
  const size = matrix.length;
  let penalty = 0;

  // Rule 1: consecutive same-color modules
  for (let y = 0; y < size; y++) {
    let run = 1;
    for (let x = 1; x < size; x++) {
      if (matrix[y][x] === matrix[y][x - 1]) {
        run++;
      } else {
        if (run >= 5) penalty += run - 2;
        run = 1;
      }
    }
    if (run >= 5) penalty += run - 2;
  }
  for (let x = 0; x < size; x++) {
    let run = 1;
    for (let y = 1; y < size; y++) {
      if (matrix[y][x] === matrix[y - 1][x]) {
        run++;
      } else {
        if (run >= 5) penalty += run - 2;
        run = 1;
      }
    }
    if (run >= 5) penalty += run - 2;
  }

  // Rule 2: 2x2 blocks
  for (let y = 0; y < size - 1; y++) {
    for (let x = 0; x < size - 1; x++) {
      const c = matrix[y][x];
      if (c === matrix[y][x + 1] && c === matrix[y + 1][x] && c === matrix[y + 1][x + 1]) {
        penalty += 3;
      }
    }
  }

  return penalty;
}

/**
 * Find best mask pattern and apply it
 * @param {number[][]} matrix - QR matrix
 * @param {boolean[][]} isFunc - Function pattern mask
 * @param {number} version - QR version
 * @param {number} ecl - Error correction level
 * @returns {number} Best mask pattern
 */
function applyBestMask(matrix, isFunc, version, ecl) {
  let bestMask = 0;
  let bestPenalty = Infinity;
  for (let mask = 0; mask < 8; mask++) {
    const testMatrix = matrix.map(row => [...row]);
    applyMask(testMatrix, isFunc, mask);
    placeFormat(testMatrix, ecl, mask);
    const penalty = calcPenalty(testMatrix);
    if (penalty < bestPenalty) {
      bestPenalty = penalty;
      bestMask = mask;
    }
  }
  applyMask(matrix, isFunc, bestMask);
  return bestMask;
}

/**
 * Error correction levels
 */
export const ErrorCorrectionLevel = {
  L: 0, // ~7% recovery
  M: 1, // ~15% recovery
  Q: 2, // ~25% recovery
  H: 3, // ~30% recovery
};

/**
 * Generate QR code matrix from text
 * @param {string} text - Text to encode
 * @param {number} [ecl=1] - Error correction level (0-3)
 * @returns {number[][]} QR code matrix (1 = dark, 0 = light)
 * @throws {Error} If data is too long for QR code
 */
export function generate(text, ecl = ErrorCorrectionLevel.M) {
  const bytes = encodeUTF8(text);
  const version = getVersion(bytes.length, ecl);
  if (version > 10) {
    throw new Error('Data too long for QR code');
  }

  const size = version * 4 + 17;
  const matrix = Array.from({ length: size }, () => Array(size).fill(null));
  const isFunc = Array.from({ length: size }, () => Array(size).fill(false));

  placePatterns(matrix, isFunc, version);
  const codewords = encodeData(bytes, version, ecl);
  placeData(matrix, isFunc, codewords);
  const bestMask = applyBestMask(matrix, isFunc, version, ecl);
  placeFormat(matrix, ecl, bestMask);
  if (version >= 7) placeVersion(matrix, version);

  return matrix;
}

/**
 * Render QR code matrix to canvas
 * @param {HTMLCanvasElement} canvas - Target canvas element
 * @param {number[][]} matrix - QR code matrix
 * @param {Object} [opts={}] - Rendering options
 * @param {number} [opts.scale=4] - Pixels per module
 * @param {number} [opts.margin=2] - Quiet zone in modules
 * @param {string} [opts.dark='#000000'] - Dark module color
 * @param {string} [opts.light='#ffffff'] - Light module color
 */
export function toCanvas(canvas, matrix, opts = {}) {
  const scale = opts.scale || 4;
  const margin = opts.margin || 2;
  const size = matrix.length;
  const canvasSize = (size + margin * 2) * scale;

  canvas.width = canvasSize;
  canvas.height = canvasSize;

  const ctx = canvas.getContext('2d');
  ctx.fillStyle = opts.light || '#ffffff';
  ctx.fillRect(0, 0, canvasSize, canvasSize);
  ctx.fillStyle = opts.dark || '#000000';

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (matrix[y][x]) {
        ctx.fillRect((x + margin) * scale, (y + margin) * scale, scale, scale);
      }
    }
  }
}

// Default export for convenience
export default {
  generate,
  toCanvas,
  ErrorCorrectionLevel,
};
