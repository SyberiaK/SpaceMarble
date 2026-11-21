/** Background workers for the heavy per-pixel loops of tile processing.
 *
 * The loops themselves live in tilePixelOps.js and are the very same functions the main thread would run:
 * they are inserted into the worker script with Function.prototype.toString(), so there is one implementation.
 * Large pixel buffers are moved to a worker (transferred, not copied) and handed back when it is done.
 * PNG encoding of the finished tile also runs in the workers, so several tiles are encoded in parallel and
 * the main thread does not have to wait for the browser to schedule the encode.
 *
 * Everything degrades to the main thread: if workers are unavailable (blocked by the page, failed their
 * start-up self-test, or turned off with localStorage 'smWorkers' = '0'), the same functions run inline.
 * @since 1.0.1
 */

import { scanTemplateColors, countChunkPixels, expandChunkTo3x } from './tilePixelOps.js';
import { debugLog } from './utils.js';

/** Upper bound on the number of workers. A view shows about 8 to 9 tiles, and encoding one takes the longest. */
const MAX_WORKERS = 6;
/** How long the start-up self-test may take before workers are considered unavailable. */
const STARTUP_TIMEOUT_MS = 3000;

/** The worker's entry point. It never runs on the main thread: its source text is inserted into the worker
 * script with Function.prototype.toString(), like the pixel loops.
 * It has to be real code, not a string: the build renames properties, and it must rename them the same way
 * here as in the code that builds the messages. For the same reason jobs are dispatched on the job type
 * string with a switch: a table keyed by job type would have its keys renamed, but the type string sent
 * by the main thread would not be.
 * @param {Function} scanFn - scanTemplateColors
 * @param {Function} countFn - countChunkPixels
 * @param {Function} expandFn - expandChunkTo3x
 */
function workerEntry(scanFn, countFn, expandFn) {
    const scan = (a) => {
        const data = new Uint8ClampedArray(a.data);
        const originalData = a.hasEnhancedColors ? new Uint8ClampedArray(data) : null;
        const enhancedMask = a.hasEnhancedColors ? new Uint8Array(a.width * a.height) : null;
        const enhancedCount = scanFn(
            data,
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
    };

    const count = (a) => {
        const colorStats = new Map();
        const totals = { required: 0, painted: 0, wrong: 0 };
        countFn(a.pixels, a.width, a.height, a.offsetX, a.offsetY, a.tilePixels, a.tileStride, colorStats, totals);
        return { result: { entries: Array.from(colorStats), totals } };
    };

    // Encodes a finished tile as PNG. If anything goes wrong the pixels are handed back,
    // so the main thread can still encode the tile itself.
    const encode = async (a) => {
        const bitmap = a.bitmap;
        const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
        try {
            // The bitmaprenderer context takes the bitmap over without copying it (and consumes it);
            // drawing it onto a 2D context is the fallback
            const renderer = canvas.getContext('bitmaprenderer');
            if (renderer) {
                renderer.transferFromImageBitmap(bitmap);
            } else {
                canvas.getContext('2d').drawImage(bitmap, 0, 0);
                bitmap.close();
            }
            const blob = await canvas.convertToBlob({ type: 'image/png' });
            // Encoding is done: release the canvas memory now, not whenever the worker next collects garbage
            canvas.width = 0;
            canvas.height = 0;
            return { result: { blob } };
        } catch (error) {
            // A consumed bitmap has width 0: take the pixels back out of the canvas instead
            let pixels = bitmap;
            if (bitmap.width === 0) {
                try {
                    pixels = canvas.transferToImageBitmap();
                } catch (_) {
                    pixels = null;
                }
            }
            const message = String((error && error.message) || error);
            return pixels ? { result: { error: message, bitmap: pixels }, transfer: [pixels] } : { result: { error: message } };
        }
    };

    // Builds the 3x overlay of a template chunk as an ImageBitmap
    const expand = async (a) => {
        const out = new Uint8ClampedArray(a.width * 3 * a.height * 3 * 4);
        expandFn(a.pixels, a.width, a.height, out);
        const bitmap = await createImageBitmap(new ImageData(out, a.width * 3, a.height * 3));
        // The bitmap has its own copy: free this 36 MB buffer now. An idle worker may not collect garbage for a long time
        if (out.buffer.transfer) out.buffer.transfer();
        return { result: { bitmap }, transfer: [bitmap] };
    };

    self.onmessage = async (event) => {
        const { id, type, args } = event.data;
        try {
            let out;
            switch (type) {
                case 'scan':
                    out = scan(args);
                    break;
                case 'count':
                    out = count(args);
                    break;
                case 'encode':
                    out = await encode(args);
                    break;
                case 'expand':
                    out = await expand(args);
                    break;
                case 'ping':
                    out = { result: 'pong' };
                    break;
                default:
                    throw new Error(`unknown job type: ${type}`);
            }
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
    return `(${workerEntry.toString()})(${scanTemplateColors.toString()}, ${countChunkPixels.toString()}, ${expandChunkTo3x.toString()});`;
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

/** Reads the pixels of an ImageBitmap and closes it.
 * @param {ImageBitmap} bitmap - The bitmap
 * @returns {Uint8ClampedArray} RGBA pixels
 */
function readBitmapPixels(bitmap) {
    const context = new OffscreenCanvas(bitmap.width, bitmap.height).getContext('2d', { willReadFrequently: true });
    context.drawImage(bitmap, 0, 0);
    const pixels = context.getImageData(0, 0, bitmap.width, bitmap.height).data;
    bitmap.close();
    return pixels;
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
    // 2x2 template pixels for counting: red (painted), green (wrong, the tile has blue), #deface (ignored), blue (wrong, the tile has gray)
    const chunk = { width: 2, height: 2, pixels: new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 255, 222, 250, 206, 255, 0, 0, 255, 255]) };
    return { data, width, height, mult, tilePixels, chunk, disabled: [green], enhanced: [red] };
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
        this.encodeAvailable = false; // whether workers can also encode PNGs (verified separately at start-up)
        this.expandAvailable = false; // whether workers can also build template overlays (verified separately)
        this.readyPromise = null;
    }

    /** Starts the workers (once) and verifies them.
     * @returns {Promise<boolean>} Whether workers are available
     */
    start() {
        if (!this.readyPromise) {
            const startedAt = Date.now();
            this.readyPromise = withTimeout(this.#startAndVerify(), STARTUP_TIMEOUT_MS)
                .then(async () => {
                    this.available = true;
                    debugLog(`[Tile Workers] ${this.slots.length} workers ready after ${Date.now() - startedAt} ms`);

                    // Encoding is verified on its own: if it fails, scanning and counting keep using the workers
                    let encodeOff = false;
                    try {
                        encodeOff = localStorage.getItem('smWorkerEncode') === '0'; // switch for comparing encode paths
                    } catch (_) {
                        /* storage unavailable: keep going */
                    }
                    if (!encodeOff) {
                        try {
                            this.encodeAvailable = await withTimeout(this.#verifyEncode(), STARTUP_TIMEOUT_MS);
                        } catch (error) {
                            this.encodeAvailable = false;
                            console.warn('[sm-workers] Tile encoding stays on the main thread:', error);
                        }
                    }

                    try {
                        this.expandAvailable = await withTimeout(this.#verifyExpand(), STARTUP_TIMEOUT_MS);
                    } catch (error) {
                        this.expandAvailable = false;
                        console.warn('[sm-workers] Template overlays stay on the main thread:', error);
                    }
                    return true;
                })
                .catch((error) => {
                    // Not a debug message: it explains why every tile is processed on the main thread
                    console.warn(`[sm-workers] Unavailable after ${Date.now() - startedAt} ms, using the main thread:`, error);
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
                        pixels: input.chunk.pixels,
                        width: input.chunk.width,
                        height: input.chunk.height,
                        offsetX: 0,
                        offsetY: 0,
                        tilePixels: input.tilePixels,
                        tileStride: 2,
                    },
                    [],
                );
                if (JSON.stringify([count.entries, count.totals]) !== expectedCount) {
                    throw new Error('count self-test mismatch');
                }
            }),
        );
    }

    /** Checks that every worker encodes a tiny image to a PNG that decodes back to the same pixels.
     * @returns {Promise<boolean>} Whether the browser supports it and all workers passed
     */
    async #verifyEncode() {
        if (typeof OffscreenCanvas === 'undefined' || typeof createImageBitmap !== 'function' || typeof ImageData === 'undefined') {
            return false;
        }

        const width = 4;
        const height = 4;
        const expected = new Uint8ClampedArray(width * height * 4);
        for (let i = 0; i < width * height; i++) {
            if (i === 5) continue; // one fully transparent pixel
            expected[i * 4] = (i * 53) & 255;
            expected[i * 4 + 1] = (i * 97) & 255;
            expected[i * 4 + 2] = (i * 29) & 255;
            expected[i * 4 + 3] = 255;
        }

        for (const slot of this.slots) {
            const bitmap = await createImageBitmap(new ImageData(expected.slice(), width, height));
            const reply = await this.#runOn(slot, 'encode', { bitmap }, [bitmap]);
            if (!reply.blob) throw new Error(`encode self-test failed in the worker: ${reply.error}`);
            if (reply.blob.type !== 'image/png') throw new Error(`encode self-test returned ${reply.blob.type}`);

            const decoded = await createImageBitmap(reply.blob);
            const canvas = new OffscreenCanvas(width, height);
            const context = canvas.getContext('2d');
            context.drawImage(decoded, 0, 0);
            decoded.close();
            const actual = context.getImageData(0, 0, width, height).data;
            for (let i = 0; i < expected.length; i++) {
                if (actual[i] !== expected[i]) throw new Error('encode self-test mismatch');
            }
        }
        return true;
    }

    /** Checks that every worker builds the same template overlay as the main thread does.
     * @returns {Promise<boolean>} Whether the browser supports it and all workers passed
     */
    async #verifyExpand() {
        if (typeof OffscreenCanvas === 'undefined' || typeof createImageBitmap !== 'function' || typeof ImageData === 'undefined') {
            return false;
        }

        // 3x2 template pixels: opaque, #deface, transparent / opaque, #deface, translucent black
        const width = 3;
        const height = 2;
        const pixels = new Uint8ClampedArray([200, 10, 30, 255, 222, 250, 206, 255, 0, 0, 0, 0, 5, 90, 160, 255, 222, 250, 206, 255, 0, 0, 0, 77]);
        const expected = new Uint8ClampedArray(width * 3 * height * 3 * 4);
        expandChunkTo3x(pixels, width, height, expected);

        for (const slot of this.slots) {
            const reply = await this.#runOn(slot, 'expand', { pixels: pixels.slice(), width, height }, []);
            const actual = readBitmapPixels(reply.bitmap);
            if (actual.length !== expected.length) throw new Error('expand self-test returned the wrong size');
            for (let i = 0; i < expected.length; i++) {
                if (actual[i] !== expected[i]) throw new Error('expand self-test mismatch');
            }
        }
        return true;
    }

    #mainThreadScan(input) {
        const data = input.data.slice();
        const originalData = new Uint8ClampedArray(data);
        const mask = new Uint8Array(input.width * input.height);
        const count = scanTemplateColors(
            data,
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
        countChunkPixels(input.chunk.pixels, input.chunk.width, input.chunk.height, 0, 0, input.tilePixels, 2, colorStats, totals);
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
            const where = event && event.filename ? ` (${event.filename}:${event.lineno})` : '';
            this.#disable(new Error(`${(event && event.message) || 'worker error'}${where}`));
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

/** Whether template overlays are currently built in the workers. */
export function expandActive() {
    return Boolean(pool && pool.available && pool.expandAvailable);
}

/** Whether finished tiles are currently encoded in the workers. */
export function encodeActive() {
    return Boolean(pool && pool.available && pool.encodeAvailable);
}

/** Whether workers can be used for the next job. Never waits: until the workers have started and passed
 * their self-test (normally well under a second), jobs simply run on the main thread. */
function workersReady() {
    return Boolean(pool && pool.available);
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

    if (workersReady()) {
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
 * The chunk's pixels are copied to the worker, not moved: the chunk stays intact.
 * @param {Object} job - Count job
 * @param {Uint8ClampedArray} job.pixels - RGBA pixels of the template chunk
 * @param {number} job.width - Chunk width in template pixels
 * @param {number} job.height - Chunk height in template pixels
 * @param {number} job.offsetX - Chunk x position inside the tile, in pixels
 * @param {number} job.offsetY - Chunk y position inside the tile, in pixels
 * @param {Uint8ClampedArray} job.tilePixels - Server tile RGBA data (copied, not moved)
 * @param {number} job.tileStride - Server tile width in pixels
 * @returns {Promise<{entries: Array<[number, Object]>, totals: {required: number, painted: number, wrong: number}}>}
 */
export async function countChunkPixelsAsync(job) {
    const { pixels, width, height, offsetX, offsetY, tilePixels, tileStride } = job;

    if (workersReady()) {
        return pool.run('count', { pixels, width, height, offsetX, offsetY, tilePixels, tileStride }, []);
    }

    const colorStats = new Map();
    const totals = { required: 0, painted: 0, wrong: 0 };
    countChunkPixels(pixels, width, height, offsetX, offsetY, tilePixels, tileStride, colorStats, totals);
    return { entries: Array.from(colorStats), totals };
}

/** Encodes a finished tile as PNG.
 * With workers, the pixels are moved out of the canvas without a copy (transferToImageBitmap) and encoded in a
 * worker, so several tiles are encoded in parallel and the main thread is not involved. The canvas is empty
 * afterwards. Without workers, the tile is encoded on the main thread.
 * @param {OffscreenCanvas} canvas - The finished tile
 * @param {Function} [onPrepared] - Called once the pixels have been taken out of the canvas
 * @returns {Promise<Blob>} PNG blob
 */
export async function encodeCanvasAsync(canvas, onPrepared) {
    if (pool && pool.available && pool.encodeAvailable) {
        const bitmap = canvas.transferToImageBitmap();
        if (onPrepared) onPrepared();

        let reply;
        try {
            reply = await pool.run('encode', { bitmap }, [bitmap]);
        } catch (error) {
            // A detached bitmap (width 0) reached the worker, which then failed: nothing is left to encode here.
            // Otherwise it never left this thread and can still be encoded below.
            if (bitmap.width === 0) throw error;
            reply = { bitmap, error: String(error) };
        }

        if (reply.blob) return reply.blob;

        // The worker could not encode this tile: stop using workers for encoding
        console.warn('[sm-workers] A worker could not encode a tile, encoding on the main thread:', reply.error);
        pool.encodeAvailable = false;
        if (!reply.bitmap) throw new Error(`worker could not encode the tile and could not hand the pixels back: ${reply.error}`);

        // It handed the pixels back: put them back into the canvas and encode here
        canvas.getContext('2d').drawImage(reply.bitmap, 0, 0);
        reply.bitmap.close();
    }

    return canvas.convertToBlob({ type: 'image/png' });
}

/** Builds the 3x overlay of a template chunk, as an ImageBitmap the caller has to close.
 * In a worker when possible: the chunk's pixels are copied, not moved, so the chunk stays intact.
 * @param {{width: number, height: number, pixels: Uint8ClampedArray}} chunk - The template chunk
 * @returns {Promise<ImageBitmap>} The overlay, (width * 3) x (height * 3) pixels
 */
export async function expandChunkAsync(chunk) {
    if (pool && pool.available && pool.expandAvailable) {
        try {
            const reply = await pool.run('expand', { pixels: chunk.pixels, width: chunk.width, height: chunk.height }, []);
            return reply.bitmap;
        } catch (error) {
            console.warn('[sm-workers] A worker could not build a template overlay, building it on the main thread:', error);
            pool.expandAvailable = false;
        }
    }

    const out = new Uint8ClampedArray(chunk.width * 3 * chunk.height * 3 * 4);
    expandChunkTo3x(chunk.pixels, chunk.width, chunk.height, out);
    return createImageBitmap(new ImageData(out, chunk.width * 3, chunk.height * 3));
}
