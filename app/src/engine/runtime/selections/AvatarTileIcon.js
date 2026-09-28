import { Icon, Vector } from "../../core/Core.js";
export class AvatarTileIcon extends Icon {
    #shape;
    #positionOffset = new Vector();
    #imageHash;
    #shapeHash;
    constructor (image, shape) {
        super(image);
        this.#shape = shape;
        this.#updateShape();
    }

    #updateShape () {
        const { shape } = this;
        const { transform } = shape;
        const { hash: shapeHash, center: shapeCenter } = shape;
        const { hash: imageHash, center: imageCenter } = super.getBoundingBox();
        if (!shapeCenter.eq(imageCenter) || shapeHash !== this.#shapeHash || imageHash !== this.#imageHash) {
            this.#shapeHash = shapeHash;
            this.#imageHash = imageHash;
            const offsetCenter = imageCenter.sub(shapeCenter, true);
            // move shape
            transform.save();
            transform.reset();
            transform.offset.apply(offsetCenter);
            shape.applyTransform();
            transform.restore();
            // save new position offset
            const { min, height } = shape.getBoundingBox();
            this.#positionOffset.apply(
                this.position.x - min.x,
                this.position.y - (min.y + height)
            );
        }
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
    getPosition () { return super.getPosition().sub(this.#positionOffset, true) }
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