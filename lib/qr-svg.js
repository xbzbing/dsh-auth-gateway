/**
 * QR Code SVG generator — zero dependencies.
 *
 * Generates a valid QR code SVG data-URL from a text string.
 * Supports byte mode, automatic version selection, error correction level M,
 * and all 8 mask patterns with penalty evaluation.
 *
 * Based on ISO/IEC 18004. The tables and the module-layout algorithms
 * (format/version info placement, zigzag data placement, error-correction
 * block splitting) follow the widely-deployed `qrcode` reference
 * implementation so that the output is scannable by real decoders.
 */

// ── GF(256) arithmetic ──────────────────────────────────────────────
const EXP = new Uint8Array(512)
const LOG = new Uint8Array(256)
;(() => {
  let x = 1
  for (let i = 0; i < 255; i++) {
    EXP[i] = x
    LOG[x] = i
    x = (x << 1) ^ (x >= 128 ? 0x11d : 0)
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255]
})()

function gfMul(a, b) {
  if (a === 0 || b === 0) return 0
  return EXP[LOG[a] + LOG[b]]
}

// ── Reed-Solomon generator polynomial ───────────────────────────────
function rsGenPoly(nsym) {
  let g = [1]
  for (let i = 0; i < nsym; i++) {
    const ng = new Array(g.length + 1).fill(0)
    for (let j = 0; j < g.length; j++) {
      ng[j] ^= g[j]
      ng[j + 1] ^= gfMul(g[j], EXP[i])
    }
    g = ng
  }
  return g
}

// ── Reed-Solomon encode ─────────────────────────────────────────────
function rsEncode(data, nsym) {
  const gen = rsGenPoly(nsym)
  const res = new Uint8Array(data.length + nsym)
  res.set(data)
  for (let i = 0; i < data.length; i++) {
    const coef = res[i]
    if (coef !== 0) {
      for (let j = 1; j < gen.length; j++) {
        res[i + j] ^= gfMul(gen[j], coef)
      }
    }
  }
  return res.slice(data.length)
}

// ── QR tables (level M) ─────────────────────────────────────────────
// Total codewords (data + EC) per version 1-40.
const TOTAL_CW = [
  0,
  26, 44, 70, 100, 134, 172, 196, 242, 292, 346,
  404, 466, 532, 581, 655, 733, 815, 901, 991, 1085,
  1156, 1258, 1364, 1474, 1588, 1706, 1828, 1921, 2051, 2185,
  2323, 2465, 2611, 2761, 2876, 3034, 3196, 3362, 3532, 3706,
]

// Total error-correction codewords per version (level M).
const EC_TOTAL_M = [
  0,
  10, 16, 26, 36, 48, 64, 72, 88, 110, 130,
  150, 176, 198, 216, 240, 280, 308, 338, 364, 416,
  442, 476, 504, 560, 588, 644, 700, 728, 784, 812,
  868, 924, 980, 1036, 1064, 1120, 1204, 1260, 1316, 1372,
]

// Number of EC blocks per version (level M).
const EC_BLOCKS_M = [
  0,
  1, 1, 1, 2, 2, 4, 4, 4, 5, 5,
  5, 8, 9, 9, 10, 10, 11, 13, 14, 16,
  17, 17, 18, 20, 21, 23, 25, 26, 28, 29,
  31, 33, 35, 37, 38, 40, 43, 45, 47, 49,
]

/** Data codeword capacity for a version at level M. */
function dataCapacity(ver) {
  return TOTAL_CW[ver] - EC_TOTAL_M[ver]
}

function neededVersion(dataLen) {
  for (let v = 1; v <= 40; v++) {
    // Byte mode: 4-bit mode indicator + char count (8 bits for v1-9, 16 for v10+) + data
    const countBits = v <= 9 ? 8 : 16
    const bitsNeeded = 4 + countBits + dataLen * 8
    if (dataCapacity(v) * 8 >= bitsNeeded) return v
  }
  throw new Error('Data too long for QR code')
}

// ── Bit stream ──────────────────────────────────────────────────────
function encodeData(ver, data) {
  const cap = dataCapacity(ver) * 8
  const bits = []

  function push(val, len) {
    for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1)
  }

  // Byte mode indicator
  push(0x04, 4)
  // Character count
  push(data.length, ver <= 9 ? 8 : 16)
  // Data
  for (let i = 0; i < data.length; i++) push(data[i], 8)
  // Terminator
  const termLen = Math.min(4, cap - bits.length)
  for (let i = 0; i < termLen; i++) push(0, 1)
  // Byte-align
  while (bits.length % 8 !== 0) push(0, 1)
  // Padding bytes
  const PAD = [0xec, 0x11]
  let padIdx = 0
  while (bits.length < cap) {
    push(PAD[padIdx], 8)
    padIdx ^= 1
  }

  // Convert to bytes
  const bytes = new Uint8Array(bits.length / 8)
  for (let i = 0; i < bytes.length; i++) {
    for (let j = 0; j < 8; j++) bytes[i] |= bits[i * 8 + j] << (7 - j)
  }
  return bytes
}

// ── Split into blocks and compute EC ────────────────────────────────
// Mirrors the reference implementation: the block with an extra codeword
// is decided by (totalCW % numBlocks) and every block shares one EC size.
function addErrorCorrection(ver, dataBytes) {
  const totalCW = TOTAL_CW[ver]
  const numBlocks = EC_BLOCKS_M[ver]
  const dataTotal = totalCW - EC_TOTAL_M[ver]

  const blocksInGroup2 = totalCW % numBlocks // blocks that hold one extra codeword
  const blocksInGroup1 = numBlocks - blocksInGroup2
  const totalCWInGroup1 = Math.floor(totalCW / numBlocks)
  const dataCWInGroup1 = Math.floor(dataTotal / numBlocks)
  const dataCWInGroup2 = dataCWInGroup1 + 1
  const ecPerBlock = totalCWInGroup1 - dataCWInGroup1

  const dataBlocks = []
  const ecBlocks = []
  let offset = 0
  let maxDataSize = 0

  for (let b = 0; b < numBlocks; b++) {
    const dataSize = b < blocksInGroup1 ? dataCWInGroup1 : dataCWInGroup2
    const block = dataBytes.slice(offset, offset + dataSize)
    offset += dataSize
    dataBlocks.push(block)
    ecBlocks.push(rsEncode(block, ecPerBlock))
    maxDataSize = Math.max(maxDataSize, dataSize)
  }

  // Interleave data blocks column-wise, then EC blocks column-wise
  const result = []
  for (let i = 0; i < maxDataSize; i++) {
    for (let b = 0; b < numBlocks; b++) {
      if (i < dataBlocks[b].length) result.push(dataBlocks[b][i])
    }
  }
  for (let i = 0; i < ecPerBlock; i++) {
    for (let b = 0; b < numBlocks; b++) {
      result.push(ecBlocks[b][i])
    }
  }

  return new Uint8Array(result)
}

// ── Module placement ────────────────────────────────────────────────
function createMatrix(ver) {
  const size = ver * 4 + 17
  // null = unset, true = dark, false = light
  const mod = Array.from({ length: size }, () => Array(size).fill(null))
  const reserved = Array.from({ length: size }, () => Array(size).fill(false))
  return { size, mod, reserved }
}

function reserve(m, r, c, val) {
  m.mod[r][c] = val
  m.reserved[r][c] = true
}

function placeFinder(m, row, col) {
  for (let r = -1; r <= 7; r++) {
    for (let c = -1; c <= 7; c++) {
      const rr = row + r, cc = col + c
      if (rr < 0 || m.size <= rr || cc < 0 || m.size <= cc) continue
      const inPattern = r >= 0 && r <= 6 && c >= 0 && c <= 6
      const dark = inPattern ? (r === 0 || r === 6 || c === 0 || c === 6 || (r >= 2 && r <= 4 && c >= 2 && c <= 4)) : false
      reserve(m, rr, cc, dark)
    }
  }
}

function placeTiming(m) {
  for (let i = 8; i < m.size - 8; i++) {
    if (!m.reserved[6][i]) reserve(m, 6, i, i % 2 === 0)
    if (!m.reserved[i][6]) reserve(m, i, 6, i % 2 === 0)
  }
}

// Alignment-pattern center coordinates per version (standard formula).
function alignmentCoords(ver) {
  if (ver === 1) return []
  const posCount = Math.floor(ver / 7) + 2
  const size = ver * 4 + 17
  const intervals = size === 145 ? 26 : Math.ceil((size - 13) / (2 * posCount - 2)) * 2
  const positions = [size - 7]
  for (let i = 1; i < posCount - 1; i++) positions[i] = positions[i - 1] - intervals
  positions.push(6)
  return positions.reverse()
}

function placeAlignment(m, ver) {
  const pos = alignmentCoords(ver)
  for (let i = 0; i < pos.length; i++) {
    for (let j = 0; j < pos.length; j++) {
      // Skip the three positions occupied by finder patterns
      if ((i === 0 && j === 0) || (i === 0 && j === pos.length - 1) || (i === pos.length - 1 && j === 0)) continue
      const row = pos[i], col = pos[j]
      for (let dr = -2; dr <= 2; dr++) {
        for (let dc = -2; dc <= 2; dc++) {
          const dark = Math.abs(dr) === 2 || Math.abs(dc) === 2 || (dr === 0 && dc === 0)
          reserve(m, row + dr, col + dc, dark)
        }
      }
    }
  }
}

function bchDigit(value) {
  let digit = 0
  while (value !== 0) {
    digit++
    value >>>= 1
  }
  return digit
}

// Version information (18 bits: 6-bit version + 12-bit BCH remainder),
// required for version 7 and above.
function placeVersionInfo(m, ver) {
  if (ver < 7) return
  let d = ver << 12
  while (bchDigit(d) - 13 >= 0) d ^= 0x1f25 << (bchDigit(d) - 13)
  const bits = (ver << 12) | d
  for (let i = 0; i < 18; i++) {
    const row = Math.floor(i / 3)
    const col = (i % 3) + m.size - 8 - 3
    const dark = ((bits >> i) & 1) === 1
    reserve(m, row, col, dark)
    reserve(m, col, row, dark)
  }
}

function placeFormatInfo(m, mask) {
  const size = m.size
  // EC level M = 0
  const data = (0 << 3) | mask
  let d = data << 10
  while (bchDigit(d) - 11 >= 0) d ^= 0x537 << (bchDigit(d) - 11)
  const bits = ((data << 10) | d) ^ 0x5412

  for (let i = 0; i < 15; i++) {
    const mod = ((bits >> i) & 1) === 1
    // Vertical (column 8)
    if (i < 6) reserve(m, i, 8, mod)
    else if (i < 8) reserve(m, i + 1, 8, mod)
    else reserve(m, size - 15 + i, 8, mod)
    // Horizontal (row 8)
    if (i < 8) reserve(m, 8, size - i - 1, mod)
    else if (i < 9) reserve(m, 8, 15 - i - 1 + 1, mod)
    else reserve(m, 8, 15 - i - 1, mod)
  }
  // Dark module
  reserve(m, size - 8, 8, true)
}

// Zigzag placement of codeword bits (continuous up/down sweep,
// skipping the timing column). Mirrors the reference implementation.
function placeDataBits(m, cw) {
  const size = m.size
  let inc = -1 // start going up
  let row = size - 1
  let bitIndex = 7
  let byteIndex = 0

  for (let col = size - 1; col > 0; col -= 2) {
    if (col === 6) col-- // skip timing column
    while (true) {
      for (let c = 0; c < 2; c++) {
        const cc = col - c
        if (!m.reserved[row][cc]) {
          m.mod[row][cc] = byteIndex < cw.length ? ((cw[byteIndex] >>> bitIndex) & 1) === 1 : false
          bitIndex--
          if (bitIndex === -1) {
            byteIndex++
            bitIndex = 7
          }
        }
      }
      row += inc
      if (row < 0 || size <= row) {
        row -= inc
        inc = -inc
        break
      }
    }
  }
}

function applyMask(m, mask) {
  const fn = [
    (r, c) => (r + c) % 2 === 0,
    (r, c) => r % 2 === 0,
    (r, c) => c % 3 === 0,
    (r, c) => (r + c) % 3 === 0,
    (r, c) => (~~(r / 2) + ~~(c / 3)) % 2 === 0,
    (r, c) => ((r * c) % 2 + (r * c) % 3) === 0,
    (r, c) => ((r * c) % 2 + (r * c) % 3) % 2 === 0,
    (r, c) => ((r + c) % 2 + (r * c) % 3) % 2 === 0,
  ][mask]
  for (let r = 0; r < m.size; r++) {
    for (let c = 0; c < m.size; c++) {
      if (!m.reserved[r][c] && fn(r, c)) m.mod[r][c] = !m.mod[r][c]
    }
  }
}

// ── Penalty scoring ─────────────────────────────────────────────────
function penalty(m) {
  const size = m.size
  let score = 0
  // Rule 1: runs of the same color
  for (let r = 0; r < size; r++) {
    let run = 1
    for (let c = 1; c < size; c++) {
      if (m.mod[r][c] === m.mod[r][c - 1]) { run++; if (run === 5) score += 3; else if (run > 5) score++ }
      else run = 1
    }
  }
  for (let c = 0; c < size; c++) {
    let run = 1
    for (let r = 1; r < size; r++) {
      if (m.mod[r][c] === m.mod[r - 1][c]) { run++; if (run === 5) score += 3; else if (run > 5) score++ }
      else run = 1
    }
  }
  // Rule 2: 2×2 blocks
  for (let r = 0; r < size - 1; r++) {
    for (let c = 0; c < size - 1; c++) {
      const v = m.mod[r][c]
      if (v === m.mod[r][c + 1] && v === m.mod[r + 1][c] && v === m.mod[r + 1][c + 1]) score += 3
    }
  }
  // Rule 3: 1:1:3:1:1 finder-like patterns (0x5D0 / 0x05D over 11 bits)
  for (let row = 0; row < size; row++) {
    let bitsCol = 0, bitsRow = 0
    for (let col = 0; col < size; col++) {
      bitsCol = ((bitsCol << 1) & 0x7ff) | (m.mod[row][col] ? 1 : 0)
      if (col >= 10 && (bitsCol === 0x5d0 || bitsCol === 0x05d)) score += 40
      bitsRow = ((bitsRow << 1) & 0x7ff) | (m.mod[col][row] ? 1 : 0)
      if (col >= 10 && (bitsRow === 0x5d0 || bitsRow === 0x05d)) score += 40
    }
  }
  // Rule 4: dark ratio
  let dark = 0
  for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) if (m.mod[r][c]) dark++
  const pct = dark / (size * size)
  const prev5 = Math.abs(Math.floor(pct * 20) * 5 - 50)
  const next5 = Math.abs(Math.floor(pct * 20 + 1) * 5 - 50)
  score += Math.min(prev5, next5) * 10
  return score
}

// ── Main entry ──────────────────────────────────────────────────────
export function generateQRSvg(text, size = 256) {
  // Encode to UTF-8 bytes
  const data = new TextEncoder().encode(text)
  const ver = neededVersion(data.length)
  const dataBytes = encodeData(ver, data)
  const cw = addErrorCorrection(ver, dataBytes)

  const m = createMatrix(ver)

  // Fixed patterns
  placeFinder(m, 0, 0)
  placeFinder(m, 0, m.size - 7)
  placeFinder(m, m.size - 7, 0)
  placeTiming(m)
  placeAlignment(m, ver)
  placeVersionInfo(m, ver)

  // Find best mask
  let bestMask = 0, bestScore = Infinity
  for (let mask = 0; mask < 8; mask++) {
    const test = createMatrix(ver)
    placeFinder(test, 0, 0)
    placeFinder(test, 0, test.size - 7)
    placeFinder(test, test.size - 7, 0)
    placeTiming(test)
    placeAlignment(test, ver)
    placeVersionInfo(test, ver)
    placeFormatInfo(test, mask)
    placeDataBits(test, cw)
    applyMask(test, mask)
    const s = penalty(test)
    if (s < bestScore) { bestScore = s; bestMask = mask }
  }

  // Final matrix
  placeFormatInfo(m, bestMask)
  placeDataBits(m, cw)
  applyMask(m, bestMask)

  // Render SVG — quiet zone ≥ 4 modules per spec, use 8 for safety
  const pad = 8
  const total = m.size + pad * 2
  const svgSize = total * 2  // each module = 2px, clean integer math

  let paths = ''
  for (let r = 0; r < m.size; r++) {
    for (let c = 0; c < m.size; c++) {
      if (m.mod[r][c]) {
        const x = (c + pad) * 2
        const y = (r + pad) * 2
        paths += `M${x},${y}h2v2h-2z`
      }
    }
  }

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${svgSize} ${svgSize}" shape-rendering="crispEdges">
<rect width="${svgSize}" height="${svgSize}" fill="#fff"/>
<path d="${paths}" fill="#000"/>
</svg>`

  return 'data:image/svg+xml,' + encodeURIComponent(svg)
}
