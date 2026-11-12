/** @file Tile Management for handling tile refresh pausing and performance
 * Contains logic for managing tile updates and refresh behavior
 * @since 1.0.0
 */

import { debugLog } from './utils.js';
import { getTileRefreshPaused, saveTileRefreshPaused, getSmartTileCacheEnabled, saveSmartTileCacheEnabled } from './settingsManager.js';

/** Global state for tile refresh pausing */
let tileRefreshPaused = false;
let originalDrawTemplateOnTile = null;
let frozenTileCache = new Map(); // Cache de tiles com templates aplicados
let isCapturingState = false; // Flag para evitar recursão durante captura

/** Smart tile cache system for persistent performance improvement */
let smartTileCacheEnabled = true;
let smartTileCache = new Map(); // Persistent cache with LRU eviction
let cacheAccessOrder = new Map(); // Track access times for LRU
let cacheHits = 0;
let cacheMisses = 0;
let maxCacheSize = 500; // Increased cache size for better performance
let cacheVersion = '1.0'; // Version for cache invalidation
let lastCanvasChangeTime = 0; // Track when canvas was last modified

/** Cache statistics and management */
const CACHE_STATS_KEY = 'bmSmartTileCacheStats';
const CACHE_VERSION_KEY = 'bmSmartTileCacheVersion';

/** Notifies cache system that canvas has changed (pixels painted/modified)
 * Note: Cache no longer blocks real-time updates, so this is mainly for statistics
 * @since 1.0.0
 */
export function notifyCanvasChange() {
    lastCanvasChangeTime = Date.now();
    debugLog('[Tile Cache] Canvas change detected');
}

/** Gets a canvas state hash for cache invalidation
 * @returns {string} A simple hash representing canvas state
 * @since 1.0.0
 */
function getCanvasStateHash() {
    // Simple static hash - cache is now only used for storage, not blocking real-time updates
    return 'static';
}

/** Initializes the smart tile cache system
 * @since 1.0.0
 */
function initializeSmartTileCache() {
    smartTileCacheEnabled = getSmartTileCacheEnabled();

    // Check cache version and clear if outdated
    try {
        const storedVersion = localStorage.getItem(CACHE_VERSION_KEY);
        if (storedVersion !== cacheVersion) {
            debugLog('[Tile Cache] Version mismatch, clearing cache');
            clearSmartTileCache();
            localStorage.setItem(CACHE_VERSION_KEY, cacheVersion);
        }

        // Load cache statistics
        const stats = JSON.parse(localStorage.getItem(CACHE_STATS_KEY) || '{"hits":0,"misses":0}');
        cacheHits = stats.hits || 0;
        cacheMisses = stats.misses || 0;

        debugLog(`[Tile Cache] Initialized - Enabled: ${smartTileCacheEnabled}, Cache size: ${smartTileCache.size}`);
    } catch (error) {
        console.warn('Failed to initialize smart tile cache:', error);
        clearSmartTileCache();
    }
}

/** Generates a cache key for a tile based on coordinates, template state, and tile content
 * @param {Array<number>|string} tileCoords - The tile coordinates
 * @param {Array} templateArray - Current templates for hash generation
 * @param {Blob} tileBlob - The tile blob to hash for content changes
 * @returns {string} Cache key
 * @since 1.0.0
 */
function generateCacheKey(tileCoords, templateArray, tileBlob) {
    // Format coordinates consistently
    const coordsKey = Array.isArray(tileCoords)
        ? tileCoords[0].toString().padStart(4, '0') + ',' + tileCoords[1].toString().padStart(4, '0')
        : tileCoords.toString();

    // Create a simple hash of active templates and their settings
    let templateHash = '';
    if (templateArray && templateArray.length > 0) {
        templateHash = templateArray
            .filter((template) => template.enabled !== false)
            .map((template) => `${template.name || 'unnamed'}_${template.sortID || 0}`)
            .sort()
            .join('|');
    }

    // Create a simple hash of the tile content to detect canvas changes
    let contentHash = 'nodata';
    if (tileBlob && tileBlob.size) {
        // Use blob size and type as a simple content signature
        // This will change when pixels are painted on the tile
        contentHash = `${tileBlob.size}_${tileBlob.type}`;
    }

    return `${coordsKey}_${templateHash}_${contentHash}`;
}

/** Updates LRU cache access order
 * @param {string} key - Cache key
 * @since 1.0.0
 */
function updateCacheAccess(key) {
    cacheAccessOrder.set(key, Date.now());
}

/** Evicts least recently used cache entries when cache is full
 * @since 1.0.0
 */
function evictLRUEntries() {
    if (smartTileCache.size <= maxCacheSize) return;

    // Sort by access time and remove oldest entries
    const sortedEntries = Array.from(cacheAccessOrder.entries()).sort(([, a], [, b]) => a - b);

    const entriesToRemove = sortedEntries.slice(0, smartTileCache.size - maxCacheSize + 10);

    for (const [key] of entriesToRemove) {
        smartTileCache.delete(key);
        cacheAccessOrder.delete(key);
    }

    debugLog(`[Tile Cache] Evicted ${entriesToRemove.length} LRU entries, cache size now: ${smartTileCache.size}`);
}

/** Stores a processed tile in the smart cache
 * @param {string} cacheKey - The cache key
 * @param {*} processedTile - The processed tile data
 * @since 1.0.0
 */
function storeInSmartCache(cacheKey, processedTile) {
    if (!smartTileCacheEnabled) return;

    try {
        smartTileCache.set(cacheKey, processedTile);
        updateCacheAccess(cacheKey);
        evictLRUEntries();

        // Save cache statistics periodically
        if ((cacheHits + cacheMisses) % 50 === 0) {
            saveCacheStatistics();
        }
    } catch (error) {
        console.warn('Failed to store tile in smart cache:', error);
    }
}

/** Retrieves a tile from the smart cache
 * @param {string} cacheKey - The cache key
 * @returns {*|null} Cached tile data or null if not found
 * @since 1.0.0
 */
function getFromSmartCache(cacheKey) {
    if (!smartTileCacheEnabled) return null;

    if (smartTileCache.has(cacheKey)) {
        updateCacheAccess(cacheKey);
        cacheHits++;
        debugLog(`[Tile Cache] HIT for key: ${cacheKey.substring(0, 20)}...`);
        return smartTileCache.get(cacheKey);
    }

    cacheMisses++;
    debugLog(`[Tile Cache] MISS for key: ${cacheKey.substring(0, 20)}...`);
    return null;
}

/** Saves cache statistics to localStorage
 * @since 1.0.0
 */
function saveCacheStatistics() {
    try {
        const stats = { hits: cacheHits, misses: cacheMisses };
        localStorage.setItem(CACHE_STATS_KEY, JSON.stringify(stats));
    } catch (error) {
        console.warn('Failed to save cache statistics:', error);
    }
}

/** Clears the smart tile cache
 * @since 1.0.0
 */
function clearSmartTileCache() {
    smartTileCache.clear();
    cacheAccessOrder.clear();
    cacheHits = 0;
    cacheMisses = 0;
    saveCacheStatistics();
    debugLog('[Tile Cache] Cache cleared');
}

/** Gets cache statistics for display
 * @returns {Object} Cache statistics
 * @since 1.0.0
 */
export function getSmartCacheStats() {
    const hitRate = cacheHits + cacheMisses > 0 ? ((cacheHits / (cacheHits + cacheMisses)) * 100).toFixed(1) : '0.0';
    return {
        enabled: smartTileCacheEnabled,
        size: smartTileCache.size,
        maxSize: maxCacheSize,
        hits: cacheHits,
        misses: cacheMisses,
        hitRate: `${hitRate}%`,
    };
}

/** Toggles smart tile cache on/off
 * @returns {boolean} New cache state
 * @since 1.0.0
 */
export function toggleSmartTileCache() {
    smartTileCacheEnabled = !smartTileCacheEnabled;
    saveSmartTileCacheEnabled(smartTileCacheEnabled);

    if (!smartTileCacheEnabled) {
        clearSmartTileCache();
    }

    debugLog(`[Tile Cache] Toggled ${smartTileCacheEnabled ? 'ON' : 'OFF'}`);
    return smartTileCacheEnabled;
}

/** Invalidates the tile cache when visual settings change
 * This ensures tiles are reprocessed when Map View or Enhanced modes change
 * @since 1.0.0
 */
export function invalidateCacheForSettingsChange() {
    if (smartTileCacheEnabled && smartTileCache.size > 0) {
        debugLog('[Tile Cache] Invalidating cache due to visual settings change');
        clearSmartTileCache();
    }
}

/** Initializes the tile refresh pause system
 * @param {Object} templateManager - The template manager instance
 * @since 1.0.0
 */
export function initializeTileRefreshPause(templateManager) {
    // Initialize smart cache system first
    initializeSmartTileCache();

    // Load the saved pause state
    tileRefreshPaused = getTileRefreshPaused();

    // Store reference to original function and wrap it with smart caching
    if (!originalDrawTemplateOnTile) {
        originalDrawTemplateOnTile = templateManager.drawTemplateOnTile.bind(templateManager);

        // Wrap the original function with smart caching and freeze functionality
        templateManager.drawTemplateOnTile = async function (tileBlob, tileCoords) {
            // Generate cache key for smart cache
            const cacheKey = generateCacheKey(tileCoords, this.templatesArray, tileBlob);

            // Try to get from smart cache first (if enabled and not paused)
            if (!tileRefreshPaused && smartTileCacheEnabled) {
                const cachedResult = getFromSmartCache(cacheKey);
                if (cachedResult) {
                    return cachedResult;
                }
            }

            // Process tile with original function (cache miss or disabled)
            const result = await originalDrawTemplateOnTile(tileBlob, tileCoords);

            // Store in smart cache for future use
            if (!tileRefreshPaused && !isCapturingState && smartTileCacheEnabled) {
                storeInSmartCache(cacheKey, result);

                // Also store in frozen cache for pause functionality
                const tileKey = Array.isArray(tileCoords)
                    ? tileCoords[0].toString().padStart(4, '0') + ',' + tileCoords[1].toString().padStart(4, '0')
                    : tileCoords.toString();
                frozenTileCache.set(tileKey, result);

                // Limit frozen cache size to prevent memory issues
                if (frozenTileCache.size > 100) {
                    const firstKey = frozenTileCache.keys().next().value;
                    frozenTileCache.delete(firstKey);
                }
            }

            return result;
        };
    }

    // Apply the pause state
    applyTileRefreshPause(templateManager);

    debugLog('[Tile Manager] Initialized with cache and pause functionality. Paused:', tileRefreshPaused);
}

/** Applies the tile refresh pause setting to the template manager
 * @param {Object} templateManager - The template manager instance
 * @since 1.0.0
 */
function applyTileRefreshPause(templateManager) {
    if (tileRefreshPaused) {
        // Replace the drawTemplateOnTile function with a paused version that uses frozen cache
        templateManager.drawTemplateOnTile = function (tileBlob, tileCoords) {
            // Use the same formatting as the original function for consistency
            const tileKey = Array.isArray(tileCoords)
                ? tileCoords[0].toString().padStart(4, '0') + ',' + tileCoords[1].toString().padStart(4, '0')
                : tileCoords.toString();

            // Check if we have a cached version with templates applied
            if (frozenTileCache.has(tileKey)) {
                debugLog('🧊 [Tile Refresh Paused] Using frozen tile cache for:', tileKey);
                return frozenTileCache.get(tileKey);
            }

            // If no cache, return original blob (fallback)
            debugLog('⏸️ [Tile Refresh Paused] No cache for tile:', tileKey, '- returning original');
            return tileBlob;
        };
    } else {
        // When resuming, restore the wrapped function that continues smart caching
        if (originalDrawTemplateOnTile) {
            templateManager.drawTemplateOnTile = async function (tileBlob, tileCoords) {
                // Generate cache key for smart cache
                const cacheKey = generateCacheKey(tileCoords, this.templatesArray, tileBlob);

                // Try to get from smart cache first
                if (smartTileCacheEnabled) {
                    const cachedResult = getFromSmartCache(cacheKey);
                    if (cachedResult) {
                        return cachedResult;
                    }
                }

                // Process tile with original function (cache miss or disabled)
                const result = await originalDrawTemplateOnTile(tileBlob, tileCoords);

                // Store in smart cache for future use
                if (!tileRefreshPaused && !isCapturingState && smartTileCacheEnabled) {
                    storeInSmartCache(cacheKey, result);

                    // Also store in frozen cache for pause functionality
                    const tileKey = Array.isArray(tileCoords)
                        ? tileCoords[0].toString().padStart(4, '0') + ',' + tileCoords[1].toString().padStart(4, '0')
                        : tileCoords.toString();
                    frozenTileCache.set(tileKey, result);

                    // Limit frozen cache size to prevent memory issues
                    if (frozenTileCache.size > 100) {
                        const firstKey = frozenTileCache.keys().next().value;
                        frozenTileCache.delete(firstKey);
                    }
                }

                return result;
            };
        }
    }
}

/** Logs the current state of the tile cache for debugging
 * @since 1.0.0
 */
function logCacheState() {
    debugLog(`🧊 [Tile Cache] Currently cached tiles: ${frozenTileCache.size}`);
    if (frozenTileCache.size > 0) {
        const keys = Array.from(frozenTileCache.keys()).slice(0, 5); // Show first 5 keys
        debugLog(`🧊 [Tile Cache] Sample cached tiles: ${keys.join(', ')}${frozenTileCache.size > 5 ? '...' : ''}`);
    }
}

/** Toggles the tile refresh pause state
 * @param {Object} templateManager - The template manager instance
 * @returns {boolean} The new pause state
 * @since 1.0.0
 */
export function toggleTileRefreshPause(templateManager) {
    if (!tileRefreshPaused) {
        // We're about to pause - log current cache state
        logCacheState();
        debugLog('🧊 [Freeze Tiles] Freezing current template view with cached tiles');
    } else {
        // We're about to resume - the cache will be used for new tiles
        debugLog('▶️ [Resume Tiles] Resuming live tile processing');
    }

    tileRefreshPaused = !tileRefreshPaused;

    // Save the new state
    saveTileRefreshPaused(tileRefreshPaused);

    // Apply the new state
    applyTileRefreshPause(templateManager);

    debugLog('⏸️ Tile refresh pause toggled. Now paused:', tileRefreshPaused);

    return tileRefreshPaused;
}

/** Gets the current tile refresh pause state
 * @returns {boolean} Whether tile refresh is currently paused
 * @since 1.0.0
 */
export function isTileRefreshPaused() {
    return tileRefreshPaused;
}

/** Forces a single tile refresh even when paused (for testing)
 * @param {Object} templateManager - The template manager instance
 * @param {File} tileBlob - The tile blob data
 * @param {Array<number>} tileCoords - The tile coordinates
 * @returns {Promise<File>} The processed tile blob
 * @since 1.0.0
 */
export async function forceRefreshSingleTile(templateManager, tileBlob, tileCoords) {
    if (originalDrawTemplateOnTile) {
        debugLog('Force Refresh - Processing single tile:', tileCoords);
        return await originalDrawTemplateOnTile(tileBlob, tileCoords);
    }
    return tileBlob;
}

/** Gets performance statistics for tile processing
 * @returns {Object} Performance stats including processed tiles count
 * @since 1.0.0
 */
export function getTilePerformanceStats() {
    return {
        paused: tileRefreshPaused,
        cachedTiles: frozenTileCache.size,
        message: tileRefreshPaused ? `Tile processing is paused. ${frozenTileCache.size} tiles cached.` : 'Tile processing is active',
    };
}

/** Gets the number of tiles currently in the frozen cache
 * @returns {number} Number of cached tiles
 * @since 1.0.0
 */
export function getCachedTileCount() {
    return frozenTileCache.size;
}

/** Clears the frozen tile cache to free memory and ensure clean state
 * @since 1.0.0
 */
export function clearFrozenTileCache() {
    const previousSize = frozenTileCache.size;
    frozenTileCache.clear();
    debugLog(`Cleared frozen tile cache (${previousSize} tiles removed)`);
}
