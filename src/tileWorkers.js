/** Background workers for the heavy per-pixel loops of tile processing.
 *
 * The loops themselves live in tilePixelOps.js and are the very same functions the main thread would run:
 * they are inserted into the worker script with Function.prototype.toString(), so there is one implementation.
 * Large pixel buffers are moved to a worker (transferred, not copied) and handed back when it is done.
 *
 * Everything degrades to the main thread: if workers are unavailable (blocked by the page, failed their
 * start-up self-test, or turned off with localStorage 'smWorkers' = '0'), the same functions run inline.
 * @since 1.0.1
 */

import { scanTemplateColors, countChunkPixels } from './tilePixelOps.js';
import { debugLog } from './utils.js';

/** Upper bound on the number of workers. Tiles arrive a few at a time, so a handful is plenty. */
const MAX_WORKERS = 4;
/** How long the start-up self-test may take before workers are considered unavailable. */
const STARTUP_TIMEOUT_MS = 4000;

/** The worker's entry point. It never runs on the main thread: its source text is inserted into the worker
 * script with Function.prototype.toString(), like the pixel loops.
 * It has to be real code, not a string: the build renames properties, and it must rename them the same way
 * here as in the code that builds the messages. For the same reason the handler table is looked up by a
 * string at runtime, so its keys are quoted (quoted names are never renamed).
 * @param {Function} scanFn - scanTemplateColors
 * @param {Function} countFn - countChunkPixels
 */
function workerEntry(scanFn, countFn) {
    const handlers = {
        ping: () => ({ result: 'pong' }),

        scan: (a) => {
            const data = new Uint8ClampedArray(a.data);
            const originalData = a.hasEnhancedColors ? new Uint8ClampedArray(data) : null;
            const enhancedMask = a.hasEnhancedColors ? new Uint8Array(a.width * a.height) : null;
            const enhancedCount = scanFn(
                data,
                originalData,
                a.width,
                a.height,
                a.mult,
                new Set(a.disabled),
                new Set(a.enhanced),
                enhancedMask,
                a.hasDisabledColors,
                a.hasEnhancedColors,
            );
            const transfer = [data.buffer];
            if (originalData) transfer.push(originalData.buffer);
            if (enhancedMask) transfer.push(enhancedMask.buffer);
            return {
                result: {
                    data: data.buffer,
                    originalData: originalData ? originalData.buffer : null,
                    enhancedMask: enhancedMask ? enhancedMask.buffer : null,
                    enhancedCount,
                },
                transfer,
            };
        },

        count: (a) => {
            const colorStats = new Map();
            const totals = { required: 0, painted: 0, wrong: 0 };
            countFn(
                new Uint8ClampedArray(a.tData),
                a.tempW,
                a.tempH,
                a.offsetX,
                a.offsetY,
                a.tilePixels,
                a.tileStride,
                a.drawSize,
                a.mult,
                colorStats,
                totals,
            );
            return { result: { entries: Array.from(colorStats), totals } };
        },
    };

    self.onmessage = (event) => {
        const { id, type, args } = event.data;
        try {
            const out = handlers[type](args);
            self.postMessage({ id, ok: true, result: out.result }, out.transfer || []);
        } catch (error) {
            self.postMessage({ id, ok: false, error: String((error && error.message) || error) });
        }
    };
}

/** Builds the worker script.
 * @returns {string} JavaScript source of the worker
 */
function buildWorkerSource() {
    return `(${workerEntry.toString()})(${scanTemplateColors.toString()}, ${countChunkPixels.toString()});`;
}

/** Default worker factory: a worker from a Blob URL.
 * @param {string} source - Worker script
 * @returns {Worker} The worker
 */
function defaultCreateWorker(source) {
    const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
    return new Worker(url);
}

/** Rejects if the promise does not settle in time.
 * @param {Promise} promise - The promise to wait for
 * @param {number} ms - Timeout in milliseconds
 * @returns {Promise} The promise, or a rejection on timeout
 */
function withTimeout(promise, ms) {
    let timer;
    const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`timed out after ${ms} ms`)), ms);
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/** Returns an ArrayBuffer that exactly holds the typed array, so it can be transferred.
 * Transferring detaches the original buffer, so a typed array that is only a view onto a bigger buffer is copied.
 * @param {ArrayBufferView} array - The typed array
 * @returns {ArrayBuffer} A buffer holding exactly the array's bytes
 */
function exactBuffer(array) {
    if (array.byteOffset === 0 && array.byteLength === array.buffer.byteLength) {
        return array.buffer;
    }
    return array.slice().buffer;
}

/** Small fixed input used to verify that a worker computes exactly what the main thread does.
 * @returns {Object} Self-test inputs
 */
function selfTestInput() {
    const width = 6;
    const height = 6;
    const mult = 3;
    const data = new Uint8ClampedArray(width * height * 4);
    const put = (x, y, r, g, b, a) => {
        const i = (y * width + x) * 4;
        data[i] = r;
        data[i + 1] = g;
        data[i + 2] = b;
        data[i + 3] = a;
    };
    put(1, 1, 255, 0, 0, 255); // centers of the four 3x3 blocks
    put(4, 1, 0, 255, 0, 255);
    put(1, 4, 0, 0, 255, 255);
    put(4, 4, 222, 250, 206, 255); // #deface, ignored by counting

    // A 2x2 native tile: red (painted), blue where green is expected (wrong), transparent (missing), anything
    const tilePixels = new Uint8ClampedArray([255, 0, 0, 255, 0, 0, 255, 255, 0, 0, 0, 0, 9, 9, 9, 255]);
    const red = (255 << 16) | (0 << 8) | 0;
    const green = (0 << 16) | (255 << 8) | 0;
    return { data, width, height, mult, tilePixels, disabled: [green], enhanced: [red] };
}

/** A fixed-size pool of tile workers. */
class TileWorkerPool {
    /**
     * @param {Function} createWorker - Takes the worker source, returns a Worker-like object
     * @param {number} size - Number of workers
     */
    constructor(createWorker, size) {
        this.createWorker = createWorker;
        this.size = size;
        this.slots = [];
        this.nextId = 1;
        this.available = false;
        this.readyPromise = null;
    }

    /** Starts the workers (once) and verifies them.
     * @returns {Promise<boolean>} Whether workers are available
     */
    start() {
        if (!this.readyPromise) {
            this.readyPromise = withTimeout(this.#startAndVerify(), STARTUP_TIMEOUT_MS)
                .then(() => {
                    this.available = true;
                    debugLog(`[Tile Workers] ${this.slots.length} workers ready`);
                    return true;
                })
                .catch((error) => {
                    debugLog('[Tile Workers] Unavailable, using the main thread:', error);
                    this.#disable(error);
                    return false;
                });
        }
        return this.readyPromise;
    }

    async #startAndVerify() {
        const source = buildWorkerSource();
        for (let i = 0; i < this.size; i++) {
            this.slots.push(this.#spawn(source));
        }

        // Every worker must reproduce the main thread's results exactly on a small input
        const input = selfTestInput();
        const expectedScan = this.#mainThreadScan(input);
        const expectedCount = this.#mainThreadCount(input);

        await Promise.all(
            this.slots.map(async (slot) => {
                const scan = await this.#runOn(
                    slot,
                    'scan',
                    {
                        data: input.data.slice().buffer,
                        width: input.width,
                        height: input.height,
                        mult: input.mult,
                        disabled: input.disabled,
                        enhanced: input.enhanced,
                        hasDisabledColors: true,
                        hasEnhancedColors: true,
                    },
                    [],
                );
                const scanSignature = JSON.stringify([
                    Array.from(new Uint8ClampedArray(scan.data)),
                    Array.from(new Uint8ClampedArray(scan.originalData)),
                    Array.from(new Uint8Array(scan.enhancedMask)),
                    scan.enhancedCount,
                ]);
                if (scanSignature !== expectedScan) throw new Error('scan self-test mismatch');

                const count = await this.#runOn(
                    slot,
                    'count',
                    {
                        tData: input.data.slice().buffer,
                        tempW: input.width,
                        tempH: input.height,
                        offsetX: 0,
                        offsetY: 0,
                        tilePixels: input.tilePixels,
                        tileStride: 2,
                        drawSize: 6,
                        mult: input.mult,
                    },
                    [],
                );
                if (JSON.stringify([count.entries, count.totals]) !== expectedCount) {
                    throw new Error('count self-test mismatch');
                }
            }),
        );
    }

    #mainThreadScan(input) {
        const data = input.data.slice();
        const originalData = new Uint8ClampedArray(data);
        const mask = new Uint8Array(input.width * input.height);
        const count = scanTemplateColors(
            data,
            originalData,
            input.width,
            input.height,
            input.mult,
            new Set(input.disabled),
            new Set(input.enhanced),
            mask,
            true,
            true,
        );
        return JSON.stringify([Array.from(data), Array.from(originalData), Array.from(mask), count]);
    }

    #mainThreadCount(input) {
        const colorStats = new Map();
        const totals = { required: 0, painted: 0, wrong: 0 };
        countChunkPixels(input.data.slice(), input.width, input.height, 0, 0, input.tilePixels, 2, 6, input.mult, colorStats, totals);
        return JSON.stringify([Array.from(colorStats), totals]);
    }

    #spawn(source) {
        const worker = this.createWorker(source);
        const slot = { worker, pending: new Map(), busy: 0 };

        worker.onmessage = (event) => {
            const { id, ok, result, error } = event.data;
            const pending = slot.pending.get(id);
            if (!pending) return;
            slot.pending.delete(id);
            slot.busy--;
            if (ok) pending.resolve(result);
            else pending.reject(new Error(error));
        };
        worker.onerror = (event) => {
            this.#disable(new Error((event && event.message) || 'worker error'));
        };

        return slot;
    }

    #runOn(slot, type, args, transfer) {
        return new Promise((resolve, reject) => {
            const id = this.nextId++;
            slot.pending.set(id, { resolve, reject });
            slot.busy++;
            try {
                slot.worker.postMessage({ id, type, args }, transfer);
            } catch (error) {
                slot.pending.delete(id);
                slot.busy--;
                reject(error);
            }
        });
    }

    /** Runs a job on the least busy worker.
     * @param {string} type - 'scan' or 'count'
     * @param {Object} args - Job arguments
     * @param {ArrayBuffer[]} transfer - Buffers to move to the worker
     * @returns {Promise<Object>} The job result
     */
    run(type, args, transfer) {
        if (!this.available || this.slots.length === 0) {
            return Promise.reject(new Error('workers unavailable'));
        }
        const slot = this.slots.reduce((best, candidate) => (candidate.busy < best.busy ? candidate : best));
        return this.#runOn(slot, type, args, transfer);
    }

    #disable(reason) {
        this.available = false;
        const error = reason instanceof Error ? reason : new Error(String(reason));
        for (const slot of this.slots) {
            for (const pending of slot.pending.values()) pending.reject(error);
            slot.pending.clear();
            try {
                slot.worker.terminate();
            } catch (_) {
                /* already gone */
            }
        }
        this.slots = [];
    }
}

let pool = null;

/** Starts the worker pool. Safe to call when workers are unsupported or blocked.
 * @param {{createWorker?: Function, size?: number}} [options] - Overrides, mostly for tests
 * @returns {Promise<boolean>|null} Resolves to whether workers are available
 */
export function initTileWorkers(options = {}) {
    try {
        if (localStorage.getItem('smWorkers') === '0') {
            debugLog('[Tile Workers] Disabled by the smWorkers setting');
            return null;
        }
    } catch (_) {
        /* storage unavailable: keep going */
    }

    const createWorker = options['createWorker'] || (typeof Worker !== 'undefined' ? defaultCreateWorker : null);
    if (!createWorker) return null;

    const hardwareThreads = (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 4;
    const size = options['size'] || Math.max(1, Math.min(MAX_WORKERS, hardwareThreads >> 1));

    pool = new TileWorkerPool(createWorker, size);
    return pool.start();
}

/** Whether workers are currently in use (false while starting, or when they are unavailable or turned off). */
export function workersActive() {
    return Boolean(pool && pool.available);
}

/** Resolves true if workers can be used for the next job. */
async function workersReady() {
    if (!pool) return false;
    await pool.start();
    return pool.available;
}

/** Applies color filtering and finds enhanced pixels for one template chunk (see scanTemplateColors).
 * The pixel buffer goes to a worker when possible: the `data` array passed in must not be used afterwards,
 * use the returned `data` instead.
 * @param {Object} job - Scan job
 * @param {Uint8ClampedArray} job.data - Template RGBA data
 * @param {number} job.width - Chunk width
 * @param {number} job.height - Chunk height
 * @param {number} job.mult - Enlarged pixel size (3)
 * @param {Set<number>} job.disabledInts - Packed disabled colors
 * @param {Set<number>} job.enhancedInts - Packed enhanced colors
 * @param {boolean} job.hasDisabledColors - Whether disabled colors are filtered
 * @param {boolean} job.hasEnhancedColors - Whether enhanced pixels are tracked
 * @returns {Promise<{data: Uint8ClampedArray, originalData: Uint8ClampedArray|null, enhancedMask: Uint8Array|null, enhancedCount: number}>}
 */
export async function scanTemplateColorsAsync(job) {
    const { data, width, height, mult, disabledInts, enhancedInts, hasDisabledColors, hasEnhancedColors } = job;

    if (await workersReady()) {
        const buffer = exactBuffer(data);
        const result = await pool.run(
            'scan',
            {
                data: buffer,
                width,
                height,
                mult,
                disabled: Array.from(disabledInts),
                enhanced: Array.from(enhancedInts),
                hasDisabledColors,
                hasEnhancedColors,
            },
            [buffer],
        );
        return {
            data: new Uint8ClampedArray(result.data),
            originalData: result.originalData ? new Uint8ClampedArray(result.originalData) : null,
            enhancedMask: result.enhancedMask ? new Uint8Array(result.enhancedMask) : null,
            enhancedCount: result.enhancedCount,
        };
    }

    // Main-thread fallback: same function, same arrays
    const originalData = hasEnhancedColors ? new Uint8ClampedArray(data) : null;
    const enhancedMask = hasEnhancedColors ? new Uint8Array(width * height) : null;
    const enhancedCount = scanTemplateColors(
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
    );
    return { data, originalData, enhancedMask, enhancedCount };
}

/** Counts required/painted/wrong/missing pixels of one template chunk (see countChunkPixels).
 * The `tData` array passed in must not be used afterwards when workers are in use.
 * @param {Object} job - Count job
 * @param {Uint8ClampedArray} job.tData - Template chunk RGBA data
 * @param {number} job.tempW - Chunk width
 * @param {number} job.tempH - Chunk height
 * @param {number} job.offsetX - Chunk x offset inside the enlarged tile
 * @param {number} job.offsetY - Chunk y offset inside the enlarged tile
 * @param {Uint8ClampedArray} job.tilePixels - Server tile RGBA data at native resolution (copied, not moved)
 * @param {number} job.tileStride - Server tile width in pixels
 * @param {number} job.drawSize - Enlarged tile size in pixels
 * @param {number} job.mult - Enlarged pixel size (3)
 * @returns {Promise<{entries: Array<[number, Object]>, totals: {required: number, painted: number, wrong: number}}>}
 */
export async function countChunkPixelsAsync(job) {
    const { tData, tempW, tempH, offsetX, offsetY, tilePixels, tileStride, drawSize, mult } = job;

    if (await workersReady()) {
        const buffer = exactBuffer(tData);
        return pool.run('count', { tData: buffer, tempW, tempH, offsetX, offsetY, tilePixels, tileStride, drawSize, mult }, [buffer]);
    }

    const colorStats = new Map();
    const totals = { required: 0, painted: 0, wrong: 0 };
    countChunkPixels(tData, tempW, tempH, offsetX, offsetY, tilePixels, tileStride, drawSize, mult, colorStats, totals);
    return { entries: Array.from(colorStats), totals };
}
