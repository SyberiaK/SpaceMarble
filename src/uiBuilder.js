/** @file UI Builder functions for creating overlay interfaces
 * Contains all the complex UI building logic that was previously in main.js
 * @since 1.0.0
 */

import * as icons from './icons.js';
// UI Builder utilities - currently minimal

/** Builds the main overlay interface
 * @param {Object} params - Parameters object
 * @param {Object} params.templateManager - The template manager instance
 * @param {Object} params.apiManager - The API manager instance
 * @param {string} params.version - The script version
 * @param {Function} params.updateMiniTracker - Function to update mini tracker
 * @param {Function} params.deleteAllTemplates - Function to delete all templates
 * @param {Function} params.deleteSelectedTemplate - Function to delete selected template
 * @param {Function} params.buildColorFilterOverlay - Function to build color filter overlay
 * @returns {Object} The built overlay main
 * @since 1.0.0
 */
export async function buildOverlayMain({
    templateManager,
    apiManager,
    version,
    updateMiniTracker,
    deleteAllTemplates,
    deleteSelectedTemplate,
    buildColorFilterOverlay,
}) {
    let isMinimized = false;
    const Overlay = (await import('./Overlay.js')).default;

    const overlayMain = new Overlay({
        id: 'bm-overlay-main',
        style: 'z-index: 999999; right: 20px; top: 20px; min-width: 400px; max-width: 500px; position: fixed; display: flex; background: rgba(40, 44, 52, 0.95); backdrop-filter: blur(10px); border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 12px; box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3); font-family: Inter, system-ui, sans-serif; font-size: 14px; color: white; flex-direction: column; overflow: hidden; transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);',
        innerHTML: `
    <div style="
      padding: 16px 20px 12px;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-radius: 12px 12px 0 0;
      margin: -1px -1px 0 -1px;
      cursor: move;
    ">
      <h3 style="
        margin: 0;
        font-size: 16px;
        font-weight: 600;
        color: white;
        text-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
      ">Blue Marble</h3>
      <button id="bm-minimize-btn" style="
        background: rgba(255, 255, 255, 0.2);
        border: none;
        border-radius: 6px;
        width: 28px;
        height: 28px;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        color: white;
        font-size: 12px;
        transition: background 0.2s ease;
        font-family: monospace;
      " onmouseover="this.style.background='rgba(255,255,255,0.3)'" onmouseout="this.style.background='rgba(255,255,255,0.2)'">−</button>
    </div>
    <div id="bm-content" style="
      padding: 20px;
      display: flex;
      flex-direction: column;
      gap: 16px;
      transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    ">`,
        apiManager: apiManager,
    });

    // Add drag functionality to the header
    let isDragging = false;
    let currentX;
    let currentY;
    let initialX;
    let initialY;
    let xOffset = 0;
    let yOffset = 0;

    const header = overlayMain.element.querySelector('div[style*="cursor: move"]');

    header.addEventListener('mousedown', (e) => {
        if (e.target.id === 'bm-minimize-btn') return;
        isDragging = true;
        initialX = e.clientX - xOffset;
        initialY = e.clientY - yOffset;
        header.style.cursor = 'grabbing';
    });

    document.addEventListener('mousemove', (e) => {
        if (isDragging) {
            e.preventDefault();
            currentX = e.clientX - initialX;
            currentY = e.clientY - initialY;
            xOffset = currentX;
            yOffset = currentY;
            overlayMain.element.style.transform = `translate(${currentX}px, ${currentY}px)`;
        }
    });

    document.addEventListener('mouseup', () => {
        if (isDragging) {
            isDragging = false;
            header.style.cursor = 'move';
        }
    });

    // Minimize/maximize functionality
    document.getElementById('bm-minimize-btn').addEventListener('click', () => {
        const content = document.getElementById('bm-content');
        const btn = document.getElementById('bm-minimize-btn');

        if (isMinimized) {
            content.style.display = 'flex';
            content.style.opacity = '1';
            btn.textContent = '−';
            overlayMain.element.style.minWidth = '400px';
        } else {
            content.style.display = 'none';
            btn.textContent = '+';
            overlayMain.element.style.minWidth = 'auto';
        }
        isMinimized = !isMinimized;
    });

    const buildContent = () => {
        return (
            overlayMain
                .addDiv({ style: 'display: flex; flex-direction: column; gap: 12px;' })
                // Coordinates input section
                .addDiv({
                    style: 'background: rgba(255, 255, 255, 0.05); border-radius: 8px; padding: 16px; border: 1px solid rgba(255, 255, 255, 0.1);',
                })
                .addP({
                    innerHTML: '<strong>📍 Coordinates</strong>',
                    style: 'margin: 0 0 12px 0; font-size: 14px; color: #e0e0e0;',
                })
                .buildElement()
                .addDiv({
                    style: 'display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 12px;',
                })
                .addInput({
                    id: 'bm-input-tx',
                    type: 'number',
                    placeholder: 'Tile X',
                    style: 'padding: 10px; border: 1px solid rgba(255, 255, 255, 0.2); border-radius: 6px; background: rgba(255, 255, 255, 0.1); color: white; font-size: 13px;',
                })
                .buildElement()
                .addInput({
                    id: 'bm-input-ty',
                    type: 'number',
                    placeholder: 'Tile Y',
                    style: 'padding: 10px; border: 1px solid rgba(255, 255, 255, 0.2); border-radius: 6px; background: rgba(255, 255, 255, 0.1); color: white; font-size: 13px;',
                })
                .buildElement()
                .buildElement()
                .addDiv({ style: 'display: grid; grid-template-columns: 1fr 1fr; gap: 8px;' })
                .addInput({
                    id: 'bm-input-px',
                    type: 'number',
                    placeholder: 'Pixel X',
                    style: 'padding: 10px; border: 1px solid rgba(255, 255, 255, 0.2); border-radius: 6px; background: rgba(255, 255, 255, 0.1); color: white; font-size: 13px;',
                })
                .buildElement()
                .addInput({
                    id: 'bm-input-py',
                    type: 'number',
                    placeholder: 'Pixel Y',
                    style: 'padding: 10px; border: 1px solid rgba(255, 255, 255, 0.2); border-radius: 6px; background: rgba(255, 255, 255, 0.1); color: white; font-size: 13px;',
                })
                .buildElement()
                .buildElement()
                .buildElement()

                // Template management section
                .addDiv({
                    style: 'background: rgba(255, 255, 255, 0.05); border-radius: 8px; padding: 16px; border: 1px solid rgba(255, 255, 255, 0.1);',
                })
                .addP({
                    innerHTML: '<strong>🎨 Template</strong>',
                    style: 'margin: 0 0 12px 0; font-size: 14px; color: #e0e0e0;',
                })
                .buildElement()
                .addInput({
                    id: 'bm-input-file',
                    type: 'file',
                    accept: '.png,.jpg,.jpeg,.gif,.bmp,.webp',
                    style: 'margin-bottom: 12px; padding: 8px; border: 1px solid rgba(255, 255, 255, 0.2); border-radius: 6px; background: rgba(255, 255, 255, 0.1); color: white; font-size: 13px; width: 100%; box-sizing: border-box;',
                })
                .buildElement()
                .addDiv({ style: 'display: flex; gap: 8px; flex-wrap: wrap;' })
                .addButton(
                    {
                        id: 'bm-button-upload',
                        innerHTML: icons.createIcon + ' Upload',
                        style: 'flex: 1; min-width: 100px; background: linear-gradient(135deg, #4CAF50, #45a049); color: white; border: none; padding: 10px 16px; border-radius: 6px; cursor: pointer; font-weight: 500; font-size: 13px; transition: all 0.2s ease;',
                    },
                    (instance, button) => {
                        button.onmouseover = () => (button.style.transform = 'translateY(-1px)');
                        button.onmouseout = () => (button.style.transform = 'translateY(0)');
                        button.onclick = () => {
                            const input = document.getElementById('bm-input-file');
                            const coordTlX = document.getElementById('bm-input-tx');
                            const coordTlY = document.getElementById('bm-input-ty');
                            const coordPxX = document.getElementById('bm-input-px');
                            const coordPxY = document.getElementById('bm-input-py');

                            if (!coordTlX.value || !coordTlY.value || !coordPxX.value || !coordPxY.value) {
                                instance.handleDisplayError(`Please fill in all coordinate fields!`);
                                return;
                            }

                            if (!input?.files[0]) {
                                instance.handleDisplayError(`No file selected!`);
                                return;
                            }

                            templateManager.createTemplate(input.files[0], input.files[0]?.name.replace(/\.[^/.]+$/, ''), [
                                Number(coordTlX.value),
                                Number(coordTlY.value),
                                Number(coordPxX.value),
                                Number(coordPxY.value),
                            ]);

                            setTimeout(() => updateMiniTracker(), 500);
                            instance.handleDisplayStatus(`Template uploaded successfully!`);
                        };
                    },
                )
                .buildElement()
                .addButton(
                    {
                        id: 'bm-button-enable',
                        innerHTML: icons.enableIcon + ' Enable',
                        style: 'background: linear-gradient(135deg, #2196F3, #1976D2); color: white; border: none; padding: 10px 16px; border-radius: 6px; cursor: pointer; font-weight: 500; font-size: 13px; transition: all 0.2s ease;',
                    },
                    (instance, button) => {
                        button.onmouseover = () => (button.style.transform = 'translateY(-1px)');
                        button.onmouseout = () => (button.style.transform = 'translateY(0)');
                        button.onclick = () => {
                            instance.apiManager?.templateManager?.setTemplatesShouldBeDrawn(true);
                            instance.handleDisplayStatus(`Templates enabled!`);
                        };
                    },
                )
                .buildElement()
                .addButton(
                    {
                        id: 'bm-button-disable',
                        innerHTML: icons.disableIcon + ' Disable',
                        style: 'background: linear-gradient(135deg, #ff9800, #f57c00); color: white; border: none; padding: 10px 16px; border-radius: 6px; cursor: pointer; font-weight: 500; font-size: 13px; transition: all 0.2s ease;',
                    },
                    (instance, button) => {
                        button.onmouseover = () => (button.style.transform = 'translateY(-1px)');
                        button.onmouseout = () => (button.style.transform = 'translateY(0)');
                        button.onclick = () => {
                            instance.apiManager?.templateManager?.setTemplatesShouldBeDrawn(false);
                            instance.handleDisplayStatus(`Templates disabled!`);
                        };
                    },
                )
                .buildElement()
                .buildElement()
                .buildElement()

                // Quick Paint section
                .addDiv({
                    style: 'background: rgba(255, 255, 255, 0.05); border-radius: 8px; padding: 16px; border: 1px solid rgba(255, 255, 255, 0.1);',
                })
                .addP({
                    innerHTML: '<strong>🎯 Quick Paint</strong>',
                    style: 'margin: 0 0 12px 0; font-size: 14px; color: #e0e0e0;',
                })
                .buildElement()
                .addDiv({
                    id: 'bm-quick-paint-container',
                    style: 'display: flex; gap: 8px; align-items: center; flex-wrap: wrap;',
                })
                .addInput({
                    id: 'bm-quick-fill-input',
                    type: 'number',
                    placeholder: 'Count',
                    min: 1,
                    max: 1000,
                    value: 5,
                    style: 'width: 70px; padding: 8px; border: 1px solid rgba(255, 255, 255, 0.2); border-radius: 4px; background: rgba(255, 255, 255, 0.1); color: white; font-size: 13px;',
                })
                .buildElement()
                .addInput({
                    id: 'bm-color-id-input',
                    type: 'number',
                    placeholder: 'Color ID',
                    min: 1,
                    max: 65,
                    value: 25,
                    style: 'width: 80px; padding: 8px; border: 1px solid rgba(255, 255, 255, 0.2); border-radius: 4px; background: rgba(255, 255, 255, 0.1); color: white; font-size: 13px;',
                })
                .buildElement()
                .addButton(
                    {
                        id: 'bm-button-quick-paint',
                        innerHTML: icons.quickFillIcon + ' Quick Paint',
                        style: 'background: linear-gradient(135deg, #28a745, #20c997); color: white; border: none; padding: 8px 16px; border-radius: 4px; cursor: pointer; font-weight: 500; font-size: 13px; transition: all 0.2s ease;',
                    },
                    (instance, button) => {
                        button.onmouseover = () => (button.style.transform = 'translateY(-1px)');
                        button.onmouseout = () => (button.style.transform = 'translateY(0)');
                        button.onclick = () => {
                            const currentlyEnabled = localStorage.getItem('bm-quick-paint-enabled') === 'true';
                            if (currentlyEnabled) {
                                localStorage.setItem('bm-quick-paint-enabled', 'false');
                                button.innerHTML = icons.quickFillIcon + ' Quick Paint';
                                button.style.background = 'linear-gradient(135deg, #28a745, #20c997)';
                                instance.handleDisplayStatus('Quick Paint disabled.');
                            } else {
                                localStorage.setItem('bm-quick-paint-enabled', 'true');
                                button.innerHTML = icons.quickFillIcon + ' Quick Paint ON';
                                button.style.background = 'linear-gradient(135deg, #ffc107, #ff8c00)';
                                instance.handleDisplayStatus('Quick Paint enabled! Place a pixel to automatically paint more with selected color.');
                            }
                        };
                    },
                )
                .buildElement()
                .buildElement()
                .buildElement()

                // Controls section
                .addDiv({
                    style: 'background: rgba(255, 255, 255, 0.05); border-radius: 8px; padding: 16px; border: 1px solid rgba(255, 255, 255, 0.1);',
                })
                .addP({
                    innerHTML: '<strong>⚙️ Controls</strong>',
                    style: 'margin: 0 0 12px 0; font-size: 14px; color: #e0e0e0;',
                })
                .buildElement()
                .addDiv({ style: 'display: flex; gap: 8px; flex-wrap: wrap;' })
                .addButton(
                    {
                        id: 'bm-button-color-filter',
                        innerHTML: icons.colorFilterIcon + ' Color Filter',
                        style: 'background: linear-gradient(135deg, #9c27b0, #7b1fa2); color: white; border: none; padding: 10px 16px; border-radius: 6px; cursor: pointer; font-weight: 500; font-size: 13px; transition: all 0.2s ease;',
                    },
                    (instance, button) => {
                        button.onmouseover = () => (button.style.transform = 'translateY(-1px)');
                        button.onmouseout = () => (button.style.transform = 'translateY(0)');
                        button.onclick = () => buildColorFilterOverlay();
                    },
                )
                .buildElement()
                .buildElement()
                .buildElement()

                // Status section
                .addDiv({
                    style: 'background: rgba(255, 255, 255, 0.05); border-radius: 8px; padding: 16px; border: 1px solid rgba(255, 255, 255, 0.1);',
                })
                .addP({
                    innerHTML: '<strong>📋 Status</strong>',
                    style: 'margin: 0 0 12px 0; font-size: 14px; color: #e0e0e0;',
                })
                .buildElement()
                .addTextarea({
                    id: overlayMain.outputStatusId,
                    placeholder: `Status: Ready...\nVersion: ${version}`,
                    readOnly: true,
                    style: 'width: 100%; min-height: 80px; padding: 12px; border: 1px solid rgba(255, 255, 255, 0.2); border-radius: 6px; background: rgba(0, 0, 0, 0.3); color: #e0e0e0; font-family: monospace; font-size: 12px; resize: vertical; box-sizing: border-box;',
                })
                .buildElement()
                .buildElement()

                // Action buttons section
                .addDiv({
                    id: 'bm-contain-buttons-action',
                    style: 'display: flex; gap: 8px; flex-wrap: wrap;',
                })
                .addButton(
                    {
                        id: 'bm-button-delete-all',
                        innerHTML: icons.deleteIcon + ' Delete All',
                        style: 'flex: 1; min-width: 120px; background: linear-gradient(135deg, #f44336, #d32f2f); color: white; border: none; padding: 10px 16px; border-radius: 6px; cursor: pointer; font-weight: 500; font-size: 13px; transition: all 0.2s ease;',
                    },
                    (instance, button) => {
                        button.onmouseover = () => (button.style.transform = 'translateY(-1px)');
                        button.onmouseout = () => (button.style.transform = 'translateY(0)');
                        button.onclick = () => deleteAllTemplates(instance);
                    },
                )
                .buildElement()
                .addButton(
                    {
                        id: 'bm-button-delete-selected',
                        innerHTML: icons.deleteIcon + ' Delete Selected',
                        style: 'flex: 1; min-width: 140px; background: linear-gradient(135deg, #ff5722, #e64a19); color: white; border: none; padding: 10px 16px; border-radius: 6px; cursor: pointer; font-weight: 500; font-size: 13px; transition: all 0.2s ease;',
                    },
                    (instance, button) => {
                        button.onmouseover = () => (button.style.transform = 'translateY(-1px)');
                        button.onmouseout = () => (button.style.transform = 'translateY(0)');
                        button.onclick = () => deleteSelectedTemplate(instance);
                    },
                )
                .buildElement()
                .buildElement()
                .buildElement()
        );
    };

    buildContent();
    return overlayMain;
}

/** Builds the template tab overlay interface
 * @returns {Object} The built overlay template tab
 * @since 1.0.0
 */
export function buildOverlayTabTemplate() {
    // Implementation would go here - this was a smaller function
    // For now, keeping the original structure but could be expanded
    return null;
}

/** Builds the color filter overlay interface
 * @param {Object} params - Parameters object
 * @param {Object} params.templateManager - The template manager instance
 * @param {Function} params.refreshTemplateDisplay - Function to refresh template display
 * @param {Function} params.updateMiniTracker - Function to update mini tracker
 * @returns {Object} The built color filter overlay
 * @since 1.0.0
 */
export function buildColorFilterOverlay({ templateManager, refreshTemplateDisplay, updateMiniTracker }) {
    // This would contain the complex color filter overlay building logic
    // For now, returning null to maintain compatibility
    return null;
}

/** Builds the crosshair settings overlay interface
 * @param {Object} params - Parameters object
 * @returns {Object} The built crosshair settings overlay
 * @since 1.0.0
 */
export function buildCrosshairSettingsOverlay(params) {
    // This would contain the crosshair settings overlay building logic
    // For now, returning null to maintain compatibility
    return null;
}
