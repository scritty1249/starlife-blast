import { Button } from "./Button.js";
import { BoundingBox } from "../../Core.js";
import { typeString } from "../../utils/logging.js";

export class ScreenButton extends Button {
    draw = undefined; // override parent method to hide this button
    #bbox = new BoundingBox();
    #appCavnas;
    #size = {
        width: 0,
        height: 0
    };
    constructor (appCanvas) {
        super();
        if (!appCanvas?.isAppCanvas) throw new Error(`[${typeString(this)}]: Expected AppCanvas, got ${typeString(appCanvas)}`);
        this.#appCavnas = appCanvas;
        this.#appCavnas.addResizeListener(this.#resizeHandler);
        this.onResize();
    }

    #resizeHandler = () => { this.onResize() }

    async computeBounds (cursor) {
        await super.computeBounds(cursor);
        if (this.#appCavnas.size.hash !== this.#bbox.size.hash)
            this.onResize();
    }
    onResize () {
        this.#bbox.max.apply(this.#appCavnas.size);
        ({width: this.#size.width, height: this.#size.height} = this.#bbox);
    }
    isOver (point) { return this.#bbox.isIntersecting(point) }
    close () { this.#appCavnas.removeResizeListener(this.#resizeHandler) }

    get isScreenButton () { return true }
    get width () { return this.#size.width }
    get height () { return this.#size.height }
}