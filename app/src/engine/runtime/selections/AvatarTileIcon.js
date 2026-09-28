import { Icon } from "../../core/Core.js";

export class AvatarTileIcon extends Icon {
    #shape;
    #imageHash;
    #shapeHash;
    constructor (image, shape) {
        super(image);
        this.#shape = shape;
        this.#updateShape();
    }

    #updatePositionOffset () {
        const { min, height } = this.shape.getBoundingBox();
        this.position.apply(min.x, min.y + height);
    }
    #updateShape () {
        const { shape } = this;
        const { transform } = shape;
        const { hash: shapeHash, center: shapeCenter } = shape;
        const { hash: imageHash, center: imageCenter } = super.getBoundingBox();
        if (!shapeCenter.eq(imageCenter) || shapeHash !== this.#shapeHash || imageHash !== this.#imageHash) {
            this.#shapeHash = shapeHash;
            this.#imageHash = imageHash;
            const offset = imageCenter.sub(shapeCenter, true);
            transform.save();
            transform.reset();
            transform.offset.apply(offset);
            shape.applyTransform();
            transform.restore();
        }
        this.#updatePositionOffset();
    }

    async computeBounds (cursor) {
        await super.computeBounds(cursor);
        this.#updateShape();
    }
    draw (cursor, fixed = false) {
        this.#updateShape();
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
        this.#updateShape();
    }

    get isAvatarTileIcon () { return true }
    get shape () { return this.#shape }
    get width () { return this.getBoundingBox().width }
    get height () { return this.getBoundingBox().height }
    get userid () { return this.userData.userid }
    set userid (id) { return (this.userData.userid = id) }
}