/** Decides when "Displaying 0 templates." may be shown.
 *
 * Tiles without a template are handled instantly, while a tile with a template is still being processed.
 * Each tile writes the status when it starts, so without this the empty tiles would overwrite the status of
 * the template tile (whichever tile starts last wins). The "no templates" status is therefore held back until
 * no template tile has been seen for a while; it is shown by a timer if no further tile arrives.
 * @since 1.0.1
 */
export class EmptyStatusGate {
    /**
     * @param {Object} options
     * @param {Function} options.show - Shows the "no templates" status
     * @param {number} [options.holdMs] - How long after the last template tile the status is held back
     * @param {Function} [options.now] - Clock, in milliseconds
     * @param {Function} [options.setTimer] - setTimeout
     * @param {Function} [options.clearTimer] - clearTimeout
     */
    constructor({ show, holdMs = 5000, now = Date.now, setTimer = setTimeout, clearTimer = clearTimeout }) {
        this.show = show;
        this.holdMs = holdMs;
        this.now = now;
        this.setTimer = setTimer;
        this.clearTimer = clearTimer;
        this.lastTemplateTile = -Infinity;
        this.timer = null;
    }

    /** Call when a tile with a template is being processed (and again when it is done). */
    noteTemplateTile() {
        this.lastTemplateTile = this.now();
    }

    /** Call for a tile without a template.
     * @param {boolean} [immediate] - Show right away (e.g. there is no enabled template at all)
     */
    requestEmptyStatus(immediate = false) {
        this.clearTimer(this.timer);
        this.timer = null;

        const wait = this.holdMs - (this.now() - this.lastTemplateTile);
        if (immediate || wait <= 0) {
            this.show();
            return;
        }
        // A template tile was seen recently: look again once the hold has passed
        this.timer = this.setTimer(() => {
            this.timer = null;
            this.requestEmptyStatus(false);
        }, wait + 50);
    }
}
