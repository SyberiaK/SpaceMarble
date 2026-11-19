/** Template chunks: the part of a template that lies inside one tile.
 *
 * A chunk holds the template's pixels at their real size (1x), as raw RGBA, not the 3x overlay that is drawn
 * on a tile. That is 9 times smaller in memory. The 3x overlay is built from it while a tile is processed
 * (see expandChunkTo3x in tilePixelOps.js).
 *
 * The #deface color (222, 250, 206) is kept as it is. It is turned into a checkerboard when the overlay is built.
 *
 * Chunks are saved as PNG images of their 1x pixels (base64 encoded).
 * @since 2.0.0
 */

import { base64ToUint8 } from './utils.js';

/** @typedef {{width: number, height: number, pixels: Uint8ClampedArray}} TemplateChunk */

/** Encodes a blob as base64
 * @param {Blob} blob - The blob to encode
 * @returns {Promise<string>} Base64 text without the data URL prefix
 */
function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(',')[1]);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
}

/** Saves a chunk as a base64 encoded PNG
 * @param {TemplateChunk} chunk - The chunk
 * @returns {Promise<string>} Base64 text of the PNG
 */
export async function encodeChunk(chunk) {
    const canvas = new OffscreenCanvas(chunk.width, chunk.height);
    canvas.getContext('2d').putImageData(new ImageData(chunk.pixels, chunk.width, chunk.height), 0, 0);
    return blobToBase64(await canvas.convertToBlob({ type: 'image/png' }));
}

/** Reads a chunk back from a base64 encoded PNG
 * @param {string} base64 - Base64 text of the PNG
 * @returns {Promise<TemplateChunk>} The chunk
 */
export async function decodeChunk(base64) {
    const bitmap = await createImageBitmap(new Blob([base64ToUint8(base64)], { type: 'image/png' }));
    const { width, height } = bitmap;
    const context = new OffscreenCanvas(width, height).getContext('2d', { willReadFrequently: true });
    context.drawImage(bitmap, 0, 0);
    bitmap.close();
    return { width, height, pixels: context.getImageData(0, 0, width, height).data };
}

/** Counts the pixels of a chunk that are not fully transparent
 * @param {TemplateChunk} chunk - The chunk
 * @returns {number} Number of pixels with an alpha above 0
 */
export function countOpaquePixels(chunk) {
    let count = 0;
    for (let i = 3; i < chunk.pixels.length; i += 4) {
        if (chunk.pixels[i] > 0) count++;
    }
    return count;
}
