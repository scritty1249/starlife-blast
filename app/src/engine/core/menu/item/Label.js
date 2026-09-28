import { BoundingBox } from "../../geometry/BoundingBox.js";
import { Vector } from "../../math/Vector.js";
import { MenuItem } from "../MenuItem.js";
import { Color } from "../../math/Color.js";

export class Label extends MenuItem {
    #text;
    #font = {
        size: 0,
        family: "serif",
        color: new Color()
    };
    #properties = {
        offset: new Vector(),
        size: new Vector(),
        hasUpdate: true
    };
    #bbox = new BoundingBox();
    #position = new Vector();
    constructor (text = "", fontSize = undefined, fontColor = undefined, fontFamily = undefined, cursor = undefined) {
        super();
        this.#text = text;
        if (Number.isFinite(fontSize)) this.fontSize = fontSize;
        if (fontColor) this.fontColor.apply(fontColor);
        if (fontFamily) this.fontFamily = fontFamily;
        if (cursor) this.#computeTextSizing(cursor);
    }

    #updateBoundingBox () {
        this.#bbox.max.apply(this.#bbox.min.apply(this.#position))
        this.#bbox.min.y -= this.#properties.size.y;
        this.#bbox.max.x += this.#properties.size.x;
    }
    #applyFont (cursor) {
        cursor.textAlign = "left";
        cursor.textBaseline = "top";
        cursor.font = this.fontStyle;
    }
    #computeTextSizing (cursor) {
        if (this.text) {
            cursor.save();
            this.#applyFont(cursor);
            const {
                width: wdh,
                actualBoundingBoxAscent,
                actualBoundingBoxDescent,
                actualBoundingBoxLeft,
                actualBoundingBoxRight
            } = cursor.measureText(this.text);
            const { a: horizontalScale, d: verticalScale } = cursor.getTransform();
            const width = (Math.abs(actualBoundingBoxLeft) + Math.abs(actualBoundingBoxRight)) || wdh;
            const height = (actualBoundingBoxAscent + actualBoundingBoxDescent) || this.fontSize;
            this.#properties.offset.apply(
                actualBoundingBoxLeft || 0,
                -actualBoundingBoxAscent || 0
            );
            this.#properties.size.apply(width * horizontalScale, height * verticalScale);
            cursor.restore();
        } else {
            this.#properties.offset.apply(0, 0);
            this.#properties.size.apply(0, 0);
        }
        this.#updateBoundingBox();
        this.#properties.hasUpdate = false;
    }

    async computeBounds (cursor) {
        await super.computeBounds(cursor);
        this.#computeTextSizing(cursor);
    }
    draw (cursor, fixed = false) {
        if (this.hasUpdate) this.#computeTextSizing(cursor);
        cursor.save();
        cursor.fixed = fixed;
        this.#applyFont(cursor);
        cursor.fillStyle = this.fontColor.toString();
        cursor.fillText(this.text, this.position.add(this.#properties.offset));
        cursor.restore();
    }
    getBoundingBox () { return this.#bbox }
    getPosition () { return this.position.add(this.originOffset) }
    setPosition (x, y = null) {
        this.position.apply(x, y).sub(this.originOffset, true);
        this.#updateBoundingBox();
    }

    get isLabel () { return true }
    get width () { return this.#properties.size.x }
    get height () { return this.#properties.size.y }
    get size () { return this.#properties.size.clone() }
    get position () { return this.#position }
    get fontColor () { return this.#font.color }
    get fontStyle () { return `${this.fontSize}px ${this.fontFamily}` }
    get hasUpdate () { return this.#properties.hasUpdate }
    set hasUpdate (bool) { return (this.#properties.hasUpdate = bool) }
    get text () { return this.#text }
    set text (str) { this.#text = str; this.hasUpdate = true; return str }
    get fontSize () { return this.#font.size }
    set fontSize (pixels) {
        const prev = this.#font.size;
        this.#font.size = pixels;
        if (prev !== pixels) this.hasUpdate = true;
        return pixels;
    }
    get fontFamily () { return this.#font.family }
    set fontFamily (family) {
        const prev = this.#font.family;
        this.#font.family = family;
        if (prev?.toLowerCase?.() !== family?.toLowerCase?.()) this.hasUpdate = true;
        return family;
    }
}