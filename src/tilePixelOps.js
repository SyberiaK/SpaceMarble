/** Pure pixel loops used while drawing template tiles.
 * No DOM access: the same functions run on the main thread (fallback) and inside Web Workers,
 * where they are inserted into the worker script with Function.prototype.toString().
 * Because of that, scanTemplateColors and countChunkPixels must stay self-contained:
 * no references to anything outside their own parameters and locals.
 * @since 1.0.1
 */

/** Packs an "r,g,b" color key into one integer, or -1 if the key is malformed.
 * Comparing integers is far cheaper than building an "r,g,b" string for every pixel.
 * @param {string} key - Color key in the form "r,g,b"
 * @returns {number} Packed color (r << 16 | g << 8 | b), or -1
 */
export function packColorKey(key) {
    const parts = String(key).split(',').map(Number);
    if (parts.length !== 3 || !parts.every((n) => Number.isInteger(n) && n >= 0 && n <= 255)) {
        return -1;
    }
    return (parts[0] << 16) | (parts[1] << 8) | parts[2];
}

/** Applies color filtering to the center pixels of a template chunk and marks enhanced ones.
 * Pure function (no DOM access).
 * @param {Uint8ClampedArray} data - Template RGBA data. Pixels of disabled colors get alpha 0
 * @param {Uint8ClampedArray} originalData - Copy of the RGBA data from before filtering (or null)
 * @param {number} width - Chunk width in pixels
 * @param {number} height - Chunk height in pixels
 * @param {number} mult - Enlarged pixel size (3)
 * @param {Set<number>} disabledInts - Packed disabled colors
 * @param {Set<number>} enhancedInts - Packed enhanced colors
 * @param {Uint8Array|null} enhancedMask - Receives 1 for every enhanced center pixel (index y * width + x)
 * @param {boolean} hasDisabledColors - Whether disabled colors should be filtered
 * @param {boolean} hasEnhancedColors - Whether enhanced pixels should be tracked
 * @returns {number} Number of enhanced pixels found
 */
export function scanTemplateColors(
    data,
    originalData,
    width,
    height,
    mult,
    disabledInts,
    enhancedInts,
    enhancedMask,
    hasDisabledColors,
    hasEnhancedColors,
) {
    let enhancedCount = 0;

    // Only the center pixel of each 3x3 block is a template pixel (x, y = 1, 4, 7, ...)
    for (let y = 1; y < height; y += mult) {
        for (let x = 1; x < width; x += mult) {
            const i = (y * width + x) * 4;

            if (hasDisabledColors) {
                if (data[i + 3] === 0) continue;
                const packed = (data[i] << 16) | (data[i + 1] << 8) | data[i + 2];
                if (disabledInts.has(packed)) {
                    data[i + 3] = 0; // Hide disabled colors by making them transparent
                } else if (hasEnhancedColors && enhancedInts.has(packed)) {
                    enhancedMask[y * width + x] = 1;
                    enhancedCount++;
                }
            } else if (hasEnhancedColors) {
                if (originalData[i + 3] === 0) continue;
                const packed = (originalData[i] << 16) | (originalData[i + 1] << 8) | originalData[i + 2];
                if (enhancedInts.has(packed)) {
                    enhancedMask[y * width + x] = 1;
                    enhancedCount++;
                }
            }
        }
    }

    return enhancedCount;
}

/** Counts required/painted/wrong/missing pixels of one template chunk against the server tile.
 * Pure function (no DOM access).
 * @param {Uint8ClampedArray} tData - Template chunk RGBA data
 * @param {number} tempW - Chunk width
 * @param {number} tempH - Chunk height
 * @param {number} offsetX - Chunk x offset inside the enlarged tile
 * @param {number} offsetY - Chunk y offset inside the enlarged tile
 * @param {Uint8ClampedArray} tilePixels - Server tile RGBA data at native resolution
 * @param {number} tileStride - Server tile width in pixels
 * @param {number} drawSize - Enlarged tile size in pixels
 * @param {number} mult - Enlarged pixel size (3)
 * @param {Map<number, Object>} colorStats - Per-color stats keyed by packed color (mutated)
 * @param {{required: number, painted: number, wrong: number}} totals - Running totals (mutated)
 */
export function countChunkPixels(tData, tempW, tempH, offsetX, offsetY, tilePixels, tileStride, drawSize, mult, colorStats, totals) {
    let lastKey = -1;
    let lastEntry = null;

    // Visit only the center pixel of each 3x3 block (x, y = 1, 4, 7, ...)
    for (let y = 1; y < tempH; y += mult) {
        const gy = y + offsetY;
        if (gy < 0 || gy >= drawSize) continue;
        const pixelY = (gy / mult) | 0; // gy >= 0 here; no `Math` lookup in the hot path
        const tileRow = pixelY * tileStride;

        for (let x = 1; x < tempW; x += mult) {
            const gx = x + offsetX;
            if (gx < 0 || gx >= drawSize) continue;

            const tIdx = (y * tempW + x) * 4;

            // Ignore transparent and semi-transparent (deface uses alpha 32)
            if (tData[tIdx + 3] < 64) continue;

            const tr = tData[tIdx];
            const tg = tData[tIdx + 1];
            const tb = tData[tIdx + 2];

            // Ignore #deface explicitly
            if (tr === 222 && tg === 250 && tb === 206) continue;

            const key = (tr << 16) | (tg << 8) | tb;
            let entry;
            if (key === lastKey) {
                entry = lastEntry;
            } else {
                entry = colorStats.get(key);
                if (!entry) {
                    entry = {
                        painted: 0,
                        required: 0,
                        wrong: 0,
                        missing: 0,
                        firstWrongPixel: null,
                        firstMissingPixel: null,
                    };
                    colorStats.set(key, entry);
                }
                lastKey = key;
                lastEntry = entry;
            }
            entry.required++;
            totals.required++;

            const pixelX = (gx / mult) | 0;
            const tileIdx = (tileRow + pixelX) * 4;
            const pa = tilePixels[tileIdx + 3];

            if (pa < 64) {
                entry.missing++;
                if (!entry.firstMissingPixel) entry.firstMissingPixel = [pixelX, pixelY];
            } else if (tilePixels[tileIdx] === tr && tilePixels[tileIdx + 1] === tg && tilePixels[tileIdx + 2] === tb) {
                totals.painted++;
                entry.painted++;
            } else {
                totals.wrong++;
                entry.wrong++;
                if (!entry.firstWrongPixel) entry.firstWrongPixel = [pixelX, pixelY];
            }
        }
    }
}

/** Converts packed-color stats into the "r,g,b"-keyed object the rest of the script expects.
 * @param {Map<number, Object>} colorStats - Per-color stats keyed by packed color
 * @returns {Object} Stats keyed by "r,g,b"
 */
export function buildColorBreakdown(colorStats) {
    const colorBreakdown = {};
    for (const [key, entry] of colorStats) {
        colorBreakdown[`${key >> 16},${(key >> 8) & 255},${key & 255}`] = entry;
    }
    return colorBreakdown;
}

/** Merges the stats of one template chunk into the running per-tile stats.
 * Chunks must be merged in template order so "first wrong/missing pixel" stays the first one found.
 * @param {Map<number, Object>} colorStats - Running per-color stats keyed by packed color (mutated)
 * @param {{required: number, painted: number, wrong: number}} totals - Running totals (mutated)
 * @param {Array<[number, Object]>} entries - Per-color stats of the chunk, as [packedColor, stats] pairs
 * @param {{required: number, painted: number, wrong: number}} chunkTotals - Totals of the chunk
 */
export function mergeChunkStats(colorStats, totals, entries, chunkTotals) {
    totals.required += chunkTotals.required;
    totals.painted += chunkTotals.painted;
    totals.wrong += chunkTotals.wrong;

    for (const [key, incoming] of entries) {
        const existing = colorStats.get(key);
        if (!existing) {
            colorStats.set(key, incoming);
            continue;
        }
        existing.painted += incoming.painted;
        existing.required += incoming.required;
        existing.wrong += incoming.wrong;
        existing.missing += incoming.missing;
        if (!existing.firstWrongPixel) existing.firstWrongPixel = incoming.firstWrongPixel;
        if (!existing.firstMissingPixel) existing.firstMissingPixel = incoming.firstMissingPixel;
    }
}
