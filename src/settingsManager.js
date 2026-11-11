/** @file Settings Manager for handling persistent storage and configuration
 * Contains all storage/settings functions that were previously in main.js
 * @since 1.0.0
 */

import { debugLog } from './utils.js';

/** Helper function to invalidate tile cache when settings change
 * @since 1.0.0
 */
function invalidateCache() {
    // Dynamic import to avoid circular dependencies
    import('./tileManager.js')
        .then((tileManager) => {
            if (tileManager.invalidateCacheForSettingsChange) {
                tileManager.invalidateCacheForSettingsChange();
            }
        })
        .catch(() => {
            // Ignore errors if tileManager is not available yet
        });
}

/** Gets the saved crosshair color from storage
 * @returns {Object} The crosshair color configuration
 * @since 1.0.0
 */
export function getCrosshairColor() {
    try {
        let savedColor = null;

        // Try TamperMonkey storage first
        if (typeof GM_getValue !== 'undefined') {
            const saved = GM_getValue('bmCrosshairColor', null);
            if (saved) savedColor = JSON.parse(saved);
        }

        // Fallback to localStorage
        if (!savedColor) {
            const saved = localStorage.getItem('bmCrosshairColor');
            if (saved) savedColor = JSON.parse(saved);
        }

        // Auto-migrate old alpha values (180 -> 255)
        if (savedColor && savedColor.alpha === 180) {
            savedColor.alpha = 255;
            saveCrosshairColor(savedColor); // Save the migrated value
            debugLog('Auto-migrated crosshair transparency from 71% to 100%');
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

/** Saves the crosshair color to storage
 * @param {Object} colorConfig - The color configuration to save
 * @since 1.0.0
 */
export function saveCrosshairColor(colorConfig) {
    try {
        const colorString = JSON.stringify(colorConfig);

        // Save to TamperMonkey storage
        if (typeof GM_setValue !== 'undefined') {
            GM_setValue('bmCrosshairColor', colorString);
        }

        // Also save to localStorage as backup
        localStorage.setItem('bmCrosshairColor', colorString);

        debugLog('Crosshair color saved:', colorConfig);
        invalidateCache();
    } catch (error) {
        console.error('Failed to save crosshair color:', error);
    }
}

/** Gets the border enabled setting from storage
 * @returns {boolean} Whether borders are enabled
 * @since 1.0.0
 */
export function getBorderEnabled() {
    try {
        let borderEnabled = null;

        // Try TamperMonkey storage first
        if (typeof GM_getValue !== 'undefined') {
            const saved = GM_getValue('bmCrosshairBorder', null);
            if (saved !== null) borderEnabled = JSON.parse(saved);
        }

        // Fallback to localStorage
        if (borderEnabled === null) {
            const saved = localStorage.getItem('bmCrosshairBorder');
            if (saved !== null) borderEnabled = JSON.parse(saved);
        }

        if (borderEnabled !== null) {
            return borderEnabled;
        }
    } catch (error) {
        console.warn('Failed to load border setting:', error);
    }

    // Default to disabled
    return false;
}

/** Saves the border enabled setting to storage
 * @param {boolean} enabled - Whether borders should be enabled
 * @since 1.0.0
 */
export function saveBorderEnabled(enabled) {
    try {
        const enabledString = JSON.stringify(enabled);

        // Save to TamperMonkey storage
        if (typeof GM_setValue !== 'undefined') {
            GM_setValue('bmCrosshairBorder', enabledString);
        }

        // Also save to localStorage as backup
        localStorage.setItem('bmCrosshairBorder', enabledString);

        invalidateCache();
    } catch (error) {
        console.error('Failed to save border setting:', error);
    }
}

/** Gets the enhanced size enabled setting from storage
 * @returns {boolean} Whether enhanced size is enabled
 * @since 1.0.0
 */
export function getEnhancedSizeEnabled() {
    try {
        let enhancedSizeEnabled = null;

        // Try TamperMonkey storage first
        if (typeof GM_getValue !== 'undefined') {
            const saved = GM_getValue('bmCrosshairEnhancedSize', null);
            if (saved !== null) enhancedSizeEnabled = JSON.parse(saved);
        }

        // Fallback to localStorage
        if (enhancedSizeEnabled === null) {
            const saved = localStorage.getItem('bmCrosshairEnhancedSize');
            if (saved !== null) enhancedSizeEnabled = JSON.parse(saved);
        }

        if (enhancedSizeEnabled !== null) {
            return enhancedSizeEnabled;
        }
    } catch (error) {
        console.warn('Failed to load enhanced size setting:', error);
    }

    // Default to disabled
    return false;
}

/** Saves the enhanced size enabled setting to storage
 * @param {boolean} enabled - Whether enhanced size should be enabled
 * @since 1.0.0
 */
export function saveEnhancedSizeEnabled(enabled) {
    try {
        const enabledString = JSON.stringify(enabled);

        // Save to TamperMonkey storage
        if (typeof GM_setValue !== 'undefined') {
            GM_setValue('bmCrosshairEnhancedSize', enabledString);
        }

        // Also save to localStorage as backup
        localStorage.setItem('bmCrosshairEnhancedSize', enabledString);

        invalidateCache();
    } catch (error) {
        console.error('Failed to save enhanced size setting:', error);
    }
}

/** Gets the mini tracker enabled setting from storage
 * @returns {boolean} Whether mini tracker is enabled
 * @since 1.0.0
 */
export function getMiniTrackerEnabled() {
    try {
        let miniTrackerEnabled = null;

        // Try TamperMonkey storage first
        if (typeof GM_getValue !== 'undefined') {
            const saved = GM_getValue('bmMiniTrackerEnabled', null);
            if (saved !== null) miniTrackerEnabled = JSON.parse(saved);
        }

        // Fallback to localStorage
        if (miniTrackerEnabled === null) {
            const saved = localStorage.getItem('bmMiniTrackerEnabled');
            if (saved !== null) miniTrackerEnabled = JSON.parse(saved);
        }

        if (miniTrackerEnabled !== null) {
            return miniTrackerEnabled;
        }
    } catch (error) {
        console.warn('Failed to load mini tracker setting:', error);
    }

    // Default to enabled
    return true;
}

/** Saves the mini tracker enabled setting to storage
 * @param {boolean} enabled - Whether mini tracker should be enabled
 * @since 1.0.0
 */
export function saveMiniTrackerEnabled(enabled) {
    try {
        const enabledString = JSON.stringify(enabled);

        // Save to TamperMonkey storage
        if (typeof GM_setValue !== 'undefined') {
            GM_setValue('bmMiniTrackerEnabled', enabledString);
        }

        // Also save to localStorage as backup
        localStorage.setItem('bmMiniTrackerEnabled', enabledString);

        invalidateCache();
    } catch (error) {
        console.error('Failed to save mini tracker setting:', error);
    }
}

/** Gets the collapse min enabled setting from storage
 * @returns {boolean} Whether collapse min is enabled
 * @since 1.0.0
 */
export function getCollapseMinEnabled() {
    try {
        let collapseMinEnabled = null;

        // Try TamperMonkey storage first
        if (typeof GM_getValue !== 'undefined') {
            const saved = GM_getValue('bmCollapseMinEnabled', null);
            if (saved !== null) collapseMinEnabled = JSON.parse(saved);
        }

        // Fallback to localStorage
        if (collapseMinEnabled === null) {
            const saved = localStorage.getItem('bmCollapseMinEnabled');
            if (saved !== null) collapseMinEnabled = JSON.parse(saved);
        }

        if (collapseMinEnabled !== null) {
            return collapseMinEnabled;
        }
    } catch (error) {
        console.warn('Failed to load collapse min setting:', error);
    }

    // Default to disabled
    return false;
}

/** Saves the collapse min enabled setting to storage
 * @param {boolean} enabled - Whether collapse min should be enabled
 * @since 1.0.0
 */
export function saveCollapseMinEnabled(enabled) {
    try {
        const enabledString = JSON.stringify(enabled);

        // Save to TamperMonkey storage
        if (typeof GM_setValue !== 'undefined') {
            GM_setValue('bmCollapseMinEnabled', enabledString);
        }

        // Also save to localStorage as backup
        localStorage.setItem('bmCollapseMinEnabled', enabledString);

        invalidateCache();
    } catch (error) {
        console.error('Failed to save collapse min setting:', error);
    }
}

/** Gets the mobile mode setting from storage
 * @returns {boolean} Whether mobile mode is enabled
 * @since 1.0.0
 */
export function getMobileMode() {
    try {
        const saved = localStorage.getItem('bmMobileMode');
        if (saved !== null) {
            return JSON.parse(saved);
        }
    } catch (error) {
        console.warn('Failed to load mobile mode setting:', error);
    }
    return false; // Default to disabled
}

/** Saves the mobile mode setting to storage
 * @param {boolean} enabled - Whether mobile mode should be enabled
 * @since 1.0.0
 */
export function saveMobileMode(enabled) {
    try {
        localStorage.setItem('bmMobileMode', JSON.stringify(enabled));
        debugLog('Mobile mode setting saved:', enabled);
        invalidateCache();
    } catch (error) {
        console.error('Failed to save mobile mode setting:', error);
    }
}

/** Gets the tile refresh pause setting from storage
 * @returns {boolean} Whether tile refresh is paused
 * @since 1.0.0
 */
export function getTileRefreshPaused() {
    try {
        let pausedState = null;

        // Try TamperMonkey storage first
        if (typeof GM_getValue !== 'undefined') {
            const saved = GM_getValue('bmTileRefreshPaused', null);
            if (saved !== null) pausedState = JSON.parse(saved);
        }

        // Fallback to localStorage
        if (pausedState === null) {
            const saved = localStorage.getItem('bmTileRefreshPaused');
            if (saved !== null) pausedState = JSON.parse(saved);
        }

        if (pausedState !== null) {
            debugLog('⏸️ Tile refresh pause setting loaded:', pausedState);
            return pausedState;
        }
    } catch (error) {
        console.warn('Failed to load tile refresh pause setting:', error);
    }

    // Default to not paused
    debugLog('⏸️ Using default tile refresh pause setting: false');
    return false;
}

/** Saves the tile refresh pause setting to storage
 * @param {boolean} paused - Whether tile refresh should be paused
 * @since 1.0.0
 */
export function saveTileRefreshPaused(paused) {
    try {
        const pausedString = JSON.stringify(paused);

        // Save to TamperMonkey storage
        if (typeof GM_setValue !== 'undefined') {
            GM_setValue('bmTileRefreshPaused', pausedString);
        }

        // Also save to localStorage as backup
        localStorage.setItem('bmTileRefreshPaused', pausedString);

        debugLog('⏸️ Tile refresh pause setting saved:', paused);
        invalidateCache();
    } catch (error) {
        console.error('Failed to save tile refresh pause setting:', error);
    }
}

/** Gets the smart tile cache setting from storage
 * @returns {boolean} Whether smart tile caching is enabled
 * @since 1.0.0
 */
export function getSmartTileCacheEnabled() {
    try {
        let cacheEnabled = null;

        // Try TamperMonkey storage first
        if (typeof GM_getValue !== 'undefined') {
            const saved = GM_getValue('bmSmartTileCache', null);
            if (saved !== null) {
                cacheEnabled = JSON.parse(saved);
            }
        }

        // Fallback to localStorage
        if (cacheEnabled === null) {
            const saved = localStorage.getItem('bmSmartTileCache');
            if (saved !== null) {
                cacheEnabled = JSON.parse(saved);
            }
        }

        if (cacheEnabled !== null) {
            debugLog('🧠 Smart tile cache setting loaded:', cacheEnabled);
            return cacheEnabled;
        }
    } catch (error) {
        console.warn('Failed to load smart tile cache setting:', error);
    }

    // Default to enabled for better performance
    debugLog('🧠 Using default smart tile cache setting: true');
    return true;
}

/** Saves the smart tile cache setting to storage
 * @param {boolean} enabled - Whether smart tile caching should be enabled
 * @since 1.0.0
 */
export function saveSmartTileCacheEnabled(enabled) {
    try {
        const enabledString = JSON.stringify(enabled);

        // Save to TamperMonkey storage
        if (typeof GM_setValue !== 'undefined') {
            GM_setValue('bmSmartTileCache', enabledString);
        }

        // Also save to localStorage as backup
        localStorage.setItem('bmSmartTileCache', enabledString);

        debugLog('🧠 Smart tile cache setting saved:', enabled);
        invalidateCache();
    } catch (error) {
        console.error('Failed to save smart tile cache setting:', error);
    }
}

/** Gets the smart template detection setting from storage
 * @returns {boolean} Whether smart detection is enabled
 * @since 1.0.0
 */
export function getSmartDetectionEnabled() {
    try {
        let smartDetectionEnabled = null;

        // Try TamperMonkey storage first
        if (typeof GM_getValue !== 'undefined') {
            const saved = GM_getValue('bmSmartDetectionEnabled', null);
            if (saved !== null) smartDetectionEnabled = JSON.parse(saved);
        }

        // Fallback to localStorage
        if (smartDetectionEnabled === null) {
            const saved = localStorage.getItem('bmSmartDetectionEnabled');
            if (saved !== null) smartDetectionEnabled = JSON.parse(saved);
        }

        if (smartDetectionEnabled !== null) {
            debugLog('Smart detection setting loaded:', smartDetectionEnabled);
            return smartDetectionEnabled;
        }
    } catch (error) {
        console.warn('Failed to load smart detection setting:', error);
    }

    // Default to enabled
    debugLog('Using default smart detection setting: true');
    return true;
}

/** Saves the smart template detection setting to storage
 * @param {boolean} enabled - Whether smart detection should be enabled
 * @since 1.0.0
 */
export function saveSmartDetectionEnabled(enabled) {
    try {
        const enabledString = JSON.stringify(enabled);

        // Save to TamperMonkey storage
        if (typeof GM_setValue !== 'undefined') {
            GM_setValue('bmSmartDetectionEnabled', enabledString);
        }

        // Also save to localStorage as backup
        localStorage.setItem('bmSmartDetectionEnabled', enabledString);

        debugLog('Smart detection setting saved:', enabled);
        invalidateCache();
    } catch (error) {
        console.error('Failed to save smart detection setting:', error);
    }
}

/** Gets the navigation method setting from storage
 * @returns {string} Navigation method ('flyto' or 'openurl')
 * @since 1.0.0
 */
export function getNavigationMethod() {
    try {
        let navigationMethod = null;

        // Try TamperMonkey storage first
        if (typeof GM_getValue !== 'undefined') {
            const saved = GM_getValue('bmNavigationMethod', null);
            if (saved !== null) navigationMethod = JSON.parse(saved);
        }

        // Fallback to localStorage
        if (navigationMethod === null) {
            const saved = localStorage.getItem('bmNavigationMethod');
            if (saved !== null) navigationMethod = JSON.parse(saved);
        }

        if (navigationMethod !== null) {
            debugLog('Navigation method setting loaded:', navigationMethod);
            return navigationMethod;
        }
    } catch (error) {
        console.warn('Failed to load navigation method setting:', error);
    }

    // Default to flyto
    debugLog('Using default navigation method setting: flyto');
    return 'flyto';
}

/** Saves the navigation method setting to storage
 * @param {string} method - Navigation method ('flyto' or 'openurl')
 * @since 1.0.0
 */
export function saveNavigationMethod(method) {
    try {
        const methodString = JSON.stringify(method);

        // Save to TamperMonkey storage
        if (typeof GM_setValue !== 'undefined') {
            GM_setValue('bmNavigationMethod', methodString);
        }

        // Also save to localStorage as backup
        localStorage.setItem('bmNavigationMethod', methodString);

        debugLog('Navigation method setting saved:', method);
        invalidateCache();
    } catch (error) {
        console.error('Failed to save navigation method setting:', error);
    }
}

/** Gets the drag mode setting from storage
 * @returns {boolean} True for full overlay drag, false for drag bar only
 * @since 1.0.0
 */
export function getDragModeEnabled() {
    try {
        // Try TamperMonkey storage first
        if (typeof GM_getValue !== 'undefined') {
            const tmValue = GM_getValue('bmDragMode', null);
            if (tmValue !== null) {
                return JSON.parse(tmValue);
            }
        }

        // Fallback to localStorage
        const localValue = localStorage.getItem('bmDragMode');
        if (localValue !== null) {
            return JSON.parse(localValue);
        }

        // Default to true (full overlay drag)
        return true;
    } catch (error) {
        console.error('Failed to load drag mode setting:', error);
        return true;
    }
}

/** Saves the drag mode setting to storage
 * @param {boolean} enabled - True for full overlay drag, false for drag bar only
 * @since 1.0.0
 */
export function saveDragModeEnabled(enabled) {
    try {
        const enabledString = JSON.stringify(enabled);

        // Save to TamperMonkey storage
        if (typeof GM_setValue !== 'undefined') {
            GM_setValue('bmDragMode', enabledString);
        }

        // Also save to localStorage as backup
        localStorage.setItem('bmDragMode', enabledString);

        debugLog('Drag mode setting saved:', enabled);
        invalidateCache();
    } catch (error) {
        console.error('Failed to save drag mode setting:', error);
    }
}
/** Gets the main Template Color Filter sort */
export function getTemplateColorSort() {
    try {
        // Prefer Tampermonkey
        if (typeof GM_getValue !== 'undefined') {
            const v = GM_getValue('bmTemplateColorSort', null);
            if (v !== null) return JSON.parse(v);
        }
        // Fallback + migration from any old key (if you used localStorage before)
        const ls = localStorage.getItem('bmTemplateColorSort');
        if (ls !== null) return JSON.parse(ls);
    } catch {}
    return 'default';
}

/** Saves the main Template Color Filter sort */
export function saveTemplateColorSort(sortValue) {
    try {
        const s = JSON.stringify(sortValue);
        if (typeof GM_setValue !== 'undefined') GM_setValue('bmTemplateColorSort', s);
        localStorage.setItem('bmTemplateColorSort', s); // backup
    } catch {}
}

/** Gets the Compact List sort (migrates old localStorage key) */
export function getCompactSort() {
    try {
        // Prefer Tampermonkey
        if (typeof GM_getValue !== 'undefined') {
            const v = GM_getValue('bmcf-compact-sort', null);
            if (v !== null) return JSON.parse(v);
        }
        // Fallback to old localStorage key
        const ls = localStorage.getItem('bmcf-compact-sort');
        if (ls !== null) return ls; // old value was a plain string
    } catch {}
    return 'default';
}

/** Saves the Compact List sort */
export function saveCompactSort(sortValue) {
    try {
        if (typeof GM_setValue !== 'undefined')
            GM_setValue('bmcf-compact-sort', JSON.stringify(sortValue));
        localStorage.setItem('bmcf-compact-sort', sortValue); // keep old key as backup
    } catch {}
}
