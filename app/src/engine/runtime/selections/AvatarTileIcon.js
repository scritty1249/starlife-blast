import { Icon } from "../../core/Core.js";

export class AvatarTileIcon extends Icon {
    #shape;
    #imageHash;
    #shapeHash;
    constructor (image, shape) {
        super(image);
        this.#shape = shape;
        this.#updateShapePosition();
    }

    #updateShapePosition () {
        const { shape } = this;
        const { transform } = shape;
        const shapeHash = shape.hash;
        const imageHash = super.getBoundingBox().hash;
        if (true || shapeHash !== this.#shapeHash || imageHash !== this.#imageHash) {
            this.#shapeHash = shapeHash;
            this.#imageHash = imageHash;
            const offset = super.getBoundingBox().center.sub(shape.center, true);
            transform.save();
            transform.reset();
            transform.offset.apply(offset);
            shape.applyTransform();
            transform.restore();
        }
    }

    draw (cursor, fixed = false) {
        this.#updateShapePosition();
        cursor.save();
        cursor.fixed = fixed;
        this.shape.draw(cursor, true);
        cursor.clip();
        super.draw(cursor, fixed);
        cursor.restore();
    }
    getBoundingBox () { return this.shape.getBoundingBox() }
    setPosition (x, y = null) {
        super.setPosition(x, y);
        this.#updateShapePosition();
    }

    get isAvatarTileIcon () { return true }
    get shape () { return this.#shape }
    get width () { return this.getBoundingBox().width }
    get height () { return this.getBoundingBox().height }
}