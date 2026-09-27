import {
    HexaButton,
    Color,
    Vector,
    lerp,
} from "../../core/Core.js";

export class MapButton extends HexaButton {
    static LERP_FACTOR = 0.175;
    static LERP_CLAMP_THRESHOLD = 0.1;
    #thumb;
    #name = "";
    #state = {
        open: undefined,
        closed: new MapButtonState(),
        active: undefined
    };
    #property = {
        isLerping: false,
        state: -1, // 0 - open | -1 - closed, 1 - active
        targetState: undefined,
    };
    constructor (name, thumbnail, legLength) {
        super(legLength, 0);
        this.#state.open = new MapButtonState(() => this.#maxWidthUpdate());
        this.#state.active = new MapButtonState(() => this.#maxWidthUpdate());
        Object.freeze(this.#state);
        this.#name = name;
        this.#thumb = thumbnail;
        this.#maxWidthUpdate();
    }

    #maxWidthUpdate () {
        const { width, height } = this;
        this.thumb.width = width;
        this.originOffset.apply(-width / 2, height / 2);
    }
    #lerp () {
        const property = this.#property;
        const target = property.targetState;
        const { LERP_FACTOR, LERP_CLAMP_THRESHOLD } = this.constructor;
        let isDone = true;
        this.fontColor.lerp(target.font, LERP_FACTOR, true, true);
        isDone = isDone && this.fontColor.distance(target.font) <= LERP_CLAMP_THRESHOLD;
        this.fillColor.lerp(target.fill, LERP_FACTOR, true, true);
        isDone = isDone && this.fillColor.distance(target.fill) <= LERP_CLAMP_THRESHOLD;
        this.strokeColor.lerp(target.stroke, LERP_FACTOR, true, true);
        isDone = isDone && this.strokeColor.distance(target.stroke) <= LERP_CLAMP_THRESHOLD;
        this.textOffset.lerp(target.offset, LERP_FACTOR, true);
        isDone = isDone && this.textOffset.distance(target.offset) <= LERP_CLAMP_THRESHOLD;
        this.bodyWidth = lerp(this.bodyWidth, target.width, LERP_FACTOR);
        isDone = isDone && Math.abs(this.bodyWidth - target.width) <= LERP_CLAMP_THRESHOLD;
        if (isDone) property.isLerping = false;
    }

    async computeBounds (cursor) {
        await super.computeBounds(cursor);
        this.#maxWidthUpdate();
    }
    drawThumbnail (cursor, fixed) {
        cursor.save();
        cursor.fixed = fixed;
        this.shape.draw(cursor, true);
        cursor.clip();
        const { x, y } = this.getPosition();
        this.thumb.draw(cursor, x, y, true);
        cursor.restore();
    }
    drawGlow (cursor, fixed) {
        cursor.save();
        cursor.fixed = fixed;
        if (this.isActive) cursor.lineWidth = 8;
        else if (this.isOpen) cursor.lineWidth = 1;
        else cursor.lineWidth = 4;
        cursor.fillColor = "transparent";
        cursor.filter = "blur(10px)";
        cursor.strokeStyle = this.strokeColor.toString();
        this.shape.draw(cursor, true);
        cursor.stroke();
        cursor.fill();
        cursor.restore();
    }
    drawButton (cursor, fixed = false) {
        this.drawGlow(cursor, fixed);
        this.drawThumbnail(cursor, fixed);
        super.drawButton(cursor, fixed);
    }
    open () {
        if (this.isOpen) return;
        this.#property.state = 0;
        this.#property.targetState = this.state.open;
        this.#property.isLerping = true;
    }
    close () {
        if (this.isClosed) return;
        this.#property.state = -1;
        this.#property.targetState = this.state.closed;
        this.#property.isLerping = true;
    }
    active () {
        if (this.isActive) return;
        this.#property.state = 1;
        this.#property.targetState = this.state.active;
        this.#property.isLerping = true;
    }
    tick () {
        if (this.isAnimating) this.#lerp();
    }
    getBoundingBox () {
        const bbox = super.getBoundingBox();
        bbox.width = this.width;
        return bbox;
    }

    get isMapButton () { return true }
    get isOpen () { return this.#property.state === 0 }
    get isActive () { return this.#property.state === 1 }
    get isClosed () { return this.#property.state === -1 }
    get isAnimating () { return this.#property.isLerping }
    get state () { return this.#state }
    get name () { return this.#name }
    get text () { return this.name }
    get thumb () { return this.#thumb }
    get width () { return (this.state.open.width + (this.shape.length * 2)) * this.shape.globalTransform.scale.x }
}

class MapButtonState {
    #stroke = new Color();
    #fill = new Color();
    #font = new Color();
    #offset = new Vector(); // text offset
    #width = 0;
    #callback;
    constructor (onwidthchange = undefined) {
        this.#callback = onwidthchange;
    }
    
    get stroke () { return this.#stroke }
    get fill () { return this.#fill }
    get font () { return this.#font }
    get offset () { return this.#offset }
    get width () { return this.#width }
    set width (num) {
        this.#width = num;
        this.#callback?.();
        return num;
    }
}
