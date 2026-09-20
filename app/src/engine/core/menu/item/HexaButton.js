import { Equigon } from "../../geometry/Equigon.js";
import { ShapeButton } from "./ShapeButton.js";

export class HexaButton extends ShapeButton {
    #points = {
        right: new Array(),
        left: new Array()
    };
    #totalBodyOffset = 0;
    #bodyWidth = 0;
    constructor (legLength, bodyWidth = 0, fill = undefined, stroke = undefined) {
        const shape = new Equigon(6, legLength);
        super(shape, fill, stroke);
        this.#setupPoints();
        this.bodyWidth = bodyWidth;
    }

    #setupPoints () {
        const { path } = this.shape.polygon;
        path.splice(0, 0, path.at(0).clone());
        path.splice(3 + 1, 0, path.at(3+1).clone());
        this.#points.right.push(path.at(-3), path.at(-2), path.at(-1), path.at(0));
        this.#points.left.push(path.at(1), path.at(2), path.at(3), path.at(4));
    }
    #setWidth (width) {
        const length = width / 2;
        this.#points.right.forEach((pt) => pt.x = (pt.x - this.#totalBodyOffset) + length);
        this.#points.left.forEach((pt) => pt.x = (pt.x + this.#totalBodyOffset) - length);
        this.#totalBodyOffset = length;
    }

    get isHexaButton () { return true }
    get bodyWidth () { return this.#bodyWidth }
    set bodyWidth (width) {
        const prev = this.bodyWidth;
        this.#bodyWidth = width;
        if (prev !== this.bodyWidth)
            this.#setWidth(this.bodyWidth);
        return width;
    }
}
