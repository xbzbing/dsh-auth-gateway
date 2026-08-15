/**
 * QR Code SVG generator — zero dependencies.
 *
 * Generates a valid QR code SVG data-URL from a text string.
 * Supports byte mode, automatic version selection, error correction level M,
 * and all 8 mask patterns with penalty evaluation.
 *
 * Based on ISO/IEC 18004.
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

// ── QR tables ───────────────────────────────────────────────────────
const ALIGN_POS = [
  [],
  [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34],
  [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50], [6, 30, 54],
  [6, 32, 58], [6, 34, 62], [6, 26, 46, 66], [6, 26, 48, 70],
  [6, 26, 50, 74], [6, 30, 54, 78], [6, 30, 56, 82], [6, 30, 58, 86],
  [6, 34, 62, 90],
]

// Total data codewords per version (without EC)
const TOTAL_DATA_CW = [
  0, 19, 34, 55, 80, 108, 136, 156, 194, 232, 274,
  324, 370, 428, 461, 523, 589, 647, 721, 795, 861, 932, 1006, 1094, 1174, 1276, 1370, 1468, 1531, 1631, 1735, 1843, 1955, 2071, 2191, 2306, 2434, 2566, 2702, 2812, 2956,
]

// EC codewords per block per version (level M)
const EC_CW_PER_BLOCK = [
  0, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26,
  30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28,
]

// Number of EC blocks per version (level M)
const NUM_EC_BLOCKS = [
  0, 1, 1, 1, 2, 2, 4, 4, 4, 4, 4,
  5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 29, 31, 33, 35, 37, 40, 43, 45, 48, 51, 54,
]

// Total codewords per version
const TOTAL_CW = [
  0, 26, 44, 70, 100, 134, 172, 196, 242, 292, 346,
]

function dataCapacity(ver) {
  return TOTAL_DATA_CW[ver]
}

function neededVersion(dataLen) {
  // Byte mode: 4-bit mode + char count indicator (8 bits for v1-9, 16 for v10-40) + data
  const bitsNeeded = 4 + 8 + dataLen * 8
  for (let v = 1; v <= 40; v++) {
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
function addErrorCorrection(ver, dataBytes) {
  const totalCW = TOTAL_CW[ver]
  const numBlocks = NUM_EC_BLOCKS[ver]
  const ecPerBlock = EC_CW_PER_BLOCK[ver]
  const dataPerBlock = Math.floor(dataBytes.length / numBlocks)
  const shortBlocks = totalCW / numBlocks - dataPerBlock // blocks that are 1 byte shorter

  const longBlockCount = numBlocks - shortBlocks
  const longBlockData = dataPerBlock + 1
  const shortBlockData = dataPerBlock

  const dataBlocks = []
  const ecBlocks = []
  let offset = 0

  for (let i = 0; i < numBlocks; i++) {
    const blockLen = i < longBlockCount ? longBlockData : shortBlockData
    const block = dataBytes.slice(offset, offset + blockLen)
    offset += blockLen
    dataBlocks.push(block)
    ecBlocks.push(rsEncode(block, ecPerBlock))
  }

  // Interleave data blocks
  const result = []
  const maxDataLen = longBlockData
  for (let i = 0; i < maxDataLen; i++) {
    for (let b = 0; b < numBlocks; b++) {
      if (i < dataBlocks[b].length) result.push(dataBlocks[b][i])
    }
  }
  // Interleave EC blocks
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

function placeAlignment(m, ver) {
  const positions = ALIGN_POS[ver] || []
  for (const r of positions) {
    for (const c of positions) {
      if (m.reserved[r][c]) continue // overlaps finder
      for (let dr = -2; dr <= 2; dr++) {
        for (let dc = -2; dc <= 2; dc++) {
          const dark = Math.abs(dr) === 2 || Math.abs(dc) === 2 || (dr === 0 && dc === 0)
          reserve(m, r + dr, c + dc, dark)
        }
      }
    }
  }
}

function placeFormatInfo(m, mask) {
  // EC level M = 0
  const fmt = (0 << 3) | mask
  let rem = fmt
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537)
  const bits = ((fmt << 10) | rem) ^ 0x5412

  // Around top-left finder
  const pos1 = [[8,0],[8,1],[8,2],[8,3],[8,4],[8,5],[8,7],[8,8],[7,8],[5,8],[4,8],[3,8],[2,8],[1,8],[0,8]]
  for (let i = 0; i < 15; i++) {
    const [r, c] = pos1[i]
    if (!m.reserved[r][c]) reserve(m, r, c, ((bits >> i) & 1) === 1)
  }
  // Bottom-left and top-right
  const pos2 = []
  for (let i = 0; i <= 6; i++) pos2.push([m.size - 1 - i, 8])
  for (let i = 0; i <= 7; i++) pos2.push([8, m.size - 8 + i])
  for (let i = 0; i < 15; i++) {
    const [r, c] = pos2[i]
    if (!m.reserved[r][c]) reserve(m, r, c, ((bits >> i) & 1) === 1)
  }
  // Dark module
  reserve(m, m.size - 8, 8, true)
}

function placeDataBits(m, cw) {
  let bitIdx = 0
  const totalBits = cw.length * 8
  // Build bit array
  const bits = []
  for (const b of cw) for (let i = 7; i >= 0; i--) bits.push((b >> i) & 1)

  let col = m.size - 1
  while (col >= 0) {
    if (col === 6) col-- // skip timing column
    const upward = ((col + 1) & 2) === 0
    for (let i = 0; i < m.size; i++) {
      const row = upward ? m.size - 1 - i : i
      for (let dc = 0; dc < 2; dc++) {
        const c = col - dc
        if (c < 0 || m.reserved[row][c]) continue
        m.mod[row][c] = bitIdx < totalBits ? bits[bitIdx] === 1 : false
        bitIdx++
      }
    }
    col -= 2
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
  let score = 0
  // Rule 1: runs
  for (let r = 0; r < m.size; r++) {
    let run = 1
    for (let c = 1; c < m.size; c++) {
      if (m.mod[r][c] === m.mod[r][c - 1]) { run++; if (run === 5) score += 3; else if (run > 5) score++ }
      else run = 1
    }
  }
  for (let c = 0; c < m.size; c++) {
    let run = 1
    for (let r = 1; r < m.size; r++) {
      if (m.mod[r][c] === m.mod[r - 1][c]) { run++; if (run === 5) score += 3; else if (run > 5) score++ }
      else run = 1
    }
  }
  // Rule 2: 2×2 blocks
  for (let r = 0; r < m.size - 1; r++) {
    for (let c = 0; c < m.size - 1; c++) {
      const v = m.mod[r][c]
      if (v === m.mod[r][c + 1] && v === m.mod[r + 1][c] && v === m.mod[r + 1][c + 1]) score += 3
    }
  }
  // Rule 4: dark ratio
  let dark = 0
  for (let r = 0; r < m.size; r++) for (let c = 0; c < m.size; c++) if (m.mod[r][c]) dark++
  const pct = dark / (m.size * m.size)
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

  // Find best mask
  let bestMask = 0, bestScore = Infinity
  for (let mask = 0; mask < 8; mask++) {
    const test = createMatrix(ver)
    placeFinder(test, 0, 0)
    placeFinder(test, 0, test.size - 7)
    placeFinder(test, test.size - 7, 0)
    placeTiming(test)
    placeAlignment(test, ver)
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
