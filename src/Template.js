import { debugLog } from './utils.js';
import { encodeChunk } from './templateChunks.js';

/** An instance of a template.
 * Handles all mathematics, manipulation, and analysis regarding a single template.
 * @class Template
 * @since 0.65.2
 */
export default class Template {
    /** The constructor for the {@link Template} class with enhanced pixel tracking.
     * @param {Object} [params={}] - Object containing all optional parameters
     * @param {string} [params.displayName='My template'] - The display name of the template
     * @param {number} [params.sortID=0] - The sort number of the template for rendering priority
     * @param {string} [params.authorID=''] - The user ID of the person who exported the template (prevents sort ID collisions)
     * @param {string} [params.url=''] - The URL to the source image
     * @param {File} [params.file=null] - The template file (pre-processed File or processed bitmap)
     * @param {Array<number>} [params.coords=null] - The coordinates of the top left corner as (tileX, tileY, pixelX, pixelY)
     * @param {Object} [params.chunked=null] - The affected chunks of the template, and their template for each chunk
     * @param {number} [params.tileSize=1000] - The size of a tile in pixels (assumes square tiles)
     * @param {number} [params.pixelCount=0] - Total number of pixels in the template (calculated automatically during processing)
     * @since 0.65.2
     */
    constructor({
        displayName = 'My template',
        sortID = 0,
        authorID = '',
        url = '',
        file = null,
        coords = null,
        chunked = null,
        tileSize = 1000,
    } = {}) {
        this.displayName = displayName;
        this.sortID = sortID;
        this.authorID = authorID;
        this.url = url;
        this.file = file;
        this.coords = coords;
        this.chunked = chunked;
        this.tileSize = tileSize;
        this.pixelCount = 0; // Total pixel count in template
        this.disabledColors = new Set(); // Set of disabled color RGB values as strings "r,g,b"
        this.enhancedColors = new Set(); // Set of enhanced color RGB values as strings "r,g,b"
    }

    /** Creates chunks of the template for each tile.
     * A chunk holds the template's pixels at their real size (see templateChunks.js).
     *
     * @returns {Object} Collection of template chunks & their saved PNG data (base64) organized by tile coordinates
     * @since 0.65.4
     */
    async createTemplateTiles() {
        // // console.log('Template coordinates:', this.coords);

        // Create bitmap using a more compatible approach
        let bitmap;
        try {
            bitmap = await createImageBitmap(this.file);
        } catch (error) {
            // // console.log('createImageBitmap failed, using fallback method');
            // Fallback: create image element and canvas
            const img = new Image();
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');

            await new Promise((resolve, reject) => {
                img.onload = () => {
                    canvas.width = img.width;
                    canvas.height = img.height;
                    ctx.drawImage(img, 0, 0);
                    resolve();
                };
                img.onerror = reject;
                img.src = URL.createObjectURL(this.file);
            });

            bitmap = { width: canvas.width, height: canvas.height, canvas, ctx };
        }
        const imageWidth = bitmap.width;
        const imageHeight = bitmap.height;

        // Persist original image dimensions for later calculations (e.g., screenshots)
        this.imageWidth = imageWidth;
        this.imageHeight = imageHeight;

        // Calculate pixel counts - total and valid (non-transparent)
        const totalPixels = imageWidth * imageHeight;
        let validPixels = 0;
        let transparentPixels = 0;

        // Count valid pixels by analyzing the image data
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = imageWidth;
        tempCanvas.height = imageHeight;
        const tempCtx = tempCanvas.getContext('2d');
        tempCtx.imageSmoothingEnabled = false;

        if (bitmap.canvas) {
            // Fallback method - use canvas directly
            tempCtx.drawImage(bitmap.canvas, 0, 0);
        } else {
            // Standard method - use bitmap
            tempCtx.drawImage(bitmap, 0, 0);
        }

        const imageData = tempCtx.getImageData(0, 0, imageWidth, imageHeight);
        const data = imageData.data;

        for (let i = 0; i < data.length; i += 4) {
            const alpha = data[i + 3];
            if (alpha >= 64) {
                // Non-transparent pixel (alpha >= 64 like in template analysis)
                validPixels++;
            } else {
                transparentPixels++;
            }
        }

        // console.log(`Template pixel analysis - Dimensions: ${imageWidth}×${imageHeight}, Valid: ${validPixels.toLocaleString()}, Transparent: ${transparentPixels.toLocaleString()}`);

        // Store pixel counts in instance properties
        this.pixelCount = totalPixels;
        this.validPixelCount = validPixels;
        this.transparentPixelCount = transparentPixels;

        const templateTiles = {}; // Holds the template chunks, one per tile (see templateChunks.js)
        const templateTilesBuffers = {}; // Holds the saved PNG data of the chunks (base64)

        // Reuse single canvas for all chunks
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d', { willReadFrequently: true, alpha: true });
        context.imageSmoothingEnabled = false;

        // Colors that are disabled while the template is created (packed as (r << 16) | (g << 8) | b)
        const disabledColorsSet = new Set();
        for (const colorKey of this.disabledColors) {
            const [r, g, b] = colorKey.split(',').map(Number);
            disabledColorsSet.add((r << 16) | (g << 8) | b);
        }

        // For every tile... (with async processing to prevent UI blocking)
        let tileCount = 0;

        for (let pixelY = this.coords[3]; pixelY < imageHeight + this.coords[3]; ) {
            // This calculates the size based on which is smaller:
            // A. The top left corner of the current tile to the bottom right corner of the current tile
            // B. The top left corner of the current tile to the bottom right corner of the image
            const drawSizeY = Math.min(this.tileSize - (pixelY % this.tileSize), imageHeight - (pixelY - this.coords[3]));

            for (let pixelX = this.coords[2]; pixelX < imageWidth + this.coords[2]; ) {
                // Yield control periodically to prevent UI blocking
                if (tileCount % 5 === 0) {
                    await new Promise((resolve) => setTimeout(resolve, 0));
                }
                tileCount++;

                const drawSizeX = Math.min(this.tileSize - (pixelX % this.tileSize), imageWidth - (pixelX - this.coords[2]));

                // The chunk is kept at the template's real size: one canvas pixel per template pixel
                if (canvas.width !== drawSizeX || canvas.height !== drawSizeY) {
                    canvas.width = drawSizeX;
                    canvas.height = drawSizeY;
                    context.imageSmoothingEnabled = false;
                }
                context.clearRect(0, 0, drawSizeX, drawSizeY);

                const source = bitmap.canvas ? bitmap.canvas : bitmap; // the fallback keeps its canvas in bitmap.canvas
                context.drawImage(
                    source, // Image to draw
                    pixelX - this.coords[2], // Coordinate X to draw from
                    pixelY - this.coords[3], // Coordinate Y to draw from
                    drawSizeX, // X width to draw from
                    drawSizeY, // Y height to draw from
                    0, // Coordinate X to draw at
                    0, // Coordinate Y to draw at
                    drawSizeX, // X width to draw at
                    drawSizeY, // Y height to draw at
                );

                const chunkData = context.getImageData(0, 0, drawSizeX, drawSizeY).data;

                // Make disabled colors transparent. #deface is never filtered: it becomes a checkerboard when drawn
                if (disabledColorsSet.size > 0) {
                    for (let i = 0; i < chunkData.length; i += 4) {
                        if (chunkData[i] === 222 && chunkData[i + 1] === 250 && chunkData[i + 2] === 206) continue;
                        if (disabledColorsSet.has((chunkData[i] << 16) | (chunkData[i + 1] << 8) | chunkData[i + 2])) {
                            chunkData[i + 3] = 0;
                        }
                    }
                }

                // Creates the "0000,0000,000,000" key name
                const templateTileName = `${(this.coords[0] + Math.floor(pixelX / 1000)).toString().padStart(4, '0')},${(
                    this.coords[1] + Math.floor(pixelY / 1000)
                )
                    .toString()
                    .padStart(4, '0')},${(pixelX % 1000).toString().padStart(3, '0')},${(pixelY % 1000).toString().padStart(3, '0')}`;

                const chunk = { width: drawSizeX, height: drawSizeY, pixels: chunkData };
                templateTiles[templateTileName] = chunk;
                templateTilesBuffers[templateTileName] = await encodeChunk(chunk);

                pixelX += drawSizeX;
            }

            pixelY += drawSizeY;
        }

        return { templateTiles, templateTilesBuffers };
    }

    /** Disables a specific color in the template
     * @param {number[]} rgbColor - RGB color array [r, g, b]
     * @since 1.0.0
     */
    disableColor(rgbColor) {
        const colorKey = rgbColor.join(',');
        this.disabledColors.add(colorKey);
    }

    /** Enables a specific color in the template
     * @param {number[]} rgbColor - RGB color array [r, g, b]
     * @since 1.0.0
     */
    enableColor(rgbColor) {
        const colorKey = rgbColor.join(',');
        this.disabledColors.delete(colorKey);
    }

    /** Checks if a color is disabled
     * @param {number[]} rgbColor - RGB color array [r, g, b]
     * @returns {boolean} True if color is disabled
     * @since 1.0.0
     */
    isColorDisabled(rgbColor) {
        const colorKey = rgbColor.join(',');
        return this.disabledColors.has(colorKey);
    }

    /** Gets all disabled colors
     * @returns {string[]} Array of disabled color keys "r,g,b"
     * @since 1.0.0
     */
    getDisabledColors() {
        return Array.from(this.disabledColors);
    }

    /** Sets disabled colors from an array
     * @param {string[]} colorKeys - Array of color keys "r,g,b"
     * @since 1.0.0
     */
    setDisabledColors(colorKeys) {
        this.disabledColors = new Set(colorKeys);
    }

    /** Enables enhanced mode for a specific color
     * @param {number[]} rgbColor - RGB color array [r, g, b]
     * @since 1.0.0
     */
    enableColorEnhanced(rgbColor) {
        const colorKey = `${rgbColor[0]},${rgbColor[1]},${rgbColor[2]}`;
        this.enhancedColors.add(colorKey);
    }

    /** Disables enhanced mode for a specific color
     * @param {number[]} rgbColor - RGB color array [r, g, b]
     * @since 1.0.0
     */
    disableColorEnhanced(rgbColor) {
        const colorKey = `${rgbColor[0]},${rgbColor[1]},${rgbColor[2]}`;
        this.enhancedColors.delete(colorKey);
    }

    /** Checks if a specific color has enhanced mode enabled
     * @param {number[]} rgbColor - RGB color array [r, g, b]
     * @returns {boolean} True if color is enhanced
     * @since 1.0.0
     */
    isColorEnhanced(rgbColor) {
        const colorKey = `${rgbColor[0]},${rgbColor[1]},${rgbColor[2]}`;
        return this.enhancedColors.has(colorKey);
    }

    /** Gets the set of enhanced colors as an array
     * @returns {Array<string>} Array of enhanced color strings "r,g,b"
     * @since 1.0.0
     */
    getEnhancedColors() {
        return Array.from(this.enhancedColors);
    }

    /** Sets enhanced colors from an array
     * @param {Array<string>} enhancedColorsArray - Array of color strings "r,g,b"
     * @since 1.0.0
     */
    setEnhancedColors(enhancedColorsArray) {
        this.enhancedColors = new Set(enhancedColorsArray || []);
    }

    /** Gets the saved crosshair color from storage
     * @returns {Object} The crosshair color configuration
     * @since 1.0.0
     */
    getCrosshairColor() {
        try {
            let savedColor = null;

            // Try TamperMonkey storage first
            if (typeof GM_getValue !== 'undefined') {
                const saved = GM_getValue('smCrosshairColor', null);
                if (saved) savedColor = JSON.parse(saved);
            }

            // Fallback to localStorage
            if (!savedColor) {
                const saved = localStorage.getItem('smCrosshairColor');
                if (saved) savedColor = JSON.parse(saved);
            }

            if (savedColor) return savedColor;
        } catch (error) {
            console.warn('Failed to load crosshair color:', error);
        }

        // Default red color
        return {
            name: 'Red',
            rgb: [255, 0, 0],
            alpha: 255,
        };
    }

    /** Gets the border enabled setting from storage
     * @returns {boolean} Whether borders are enabled
     * @since 1.0.0
     */
    getBorderEnabled() {
        console.group('🔲 [BORDER SETTING] Loading border configuration');

        try {
            let borderEnabled = null;
            let source = 'none';

            // Try TamperMonkey storage first
            if (typeof GM_getValue !== 'undefined') {
                const saved = GM_getValue('smCrosshairBorder', null);
                debugLog('TamperMonkey raw value:', saved);
                if (saved !== null) {
                    borderEnabled = JSON.parse(saved);
                    source = 'TamperMonkey';
                }
            }

            // Fallback to localStorage
            if (borderEnabled === null) {
                const saved = localStorage.getItem('smCrosshairBorder');
                debugLog('localStorage raw value:', saved);
                if (saved !== null) {
                    borderEnabled = JSON.parse(saved);
                    source = 'localStorage';
                }
            }

            if (borderEnabled !== null) {
                debugLog(`Border setting loaded from ${source}:`, borderEnabled);
                return borderEnabled;
            }
        } catch (error) {
            console.error('❌ Failed to load border setting:', error);
        }

        // Default to disabled
        debugLog('Using default border setting: false (no saved value found)');
        return false;
    }
}
