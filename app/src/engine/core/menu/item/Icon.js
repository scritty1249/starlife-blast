import { BoundingBox } from "../../geometry/BoundingBox.js";
import { Vector } from "../../math/Vector.js";
import { typeString } from "../../utils/logging.js";
import { MenuItem } from "../MenuItem.js";

export class Icon extends MenuItem {
    #img;
    #hash;
    #bbox = new BoundingBox();
    #position = new Vector();
    constructor (image) {
        super();
        if (!image?.isLoadImage) throw new Error(`[${typeString(this)}]: Expected LoadImage, got ${typeString(image)}`);
        this.#img = image;
        this.#bbox.apply(undefined, this.#img.size);
    }

    #computeBoundingBox () {
        const hash = Vector.hash([this.position, this.#img.size, this.#img.scale, this.#img.origin]);
        if (hash !== this.#hash) {
            this.#hash = hash;
            const { size } = this.#img;
            const min = this.position.clone();
            const max = min.clone();
            min.y -= size.y;
            max.x += size.x;
            this.#bbox.apply(min, max);
        }
    }

    async computeBounds (cursor) {
        await super.computeBounds(cursor);
        this.#computeBoundingBox();
    }
    draw (cursor, fixed = false) {
        cursor.save();
        cursor.fixed = fixed;
        this.#img.draw(cursor, this.position.x, this.position.y);
        cursor.restore();
    }
    getBoundingBox () {
        this.#computeBoundingBox();
        return this.#bbox;
    }
    getPosition () { return this.position.sub(this.originOffset) }
    setPosition (x, y = null) { this.position.apply(x, y).add(this.originOffset, true) }

    get isIcon () { return true }
    get source () { return this.#img }
    get width () { return this.#img.width }
    get height () { return this.#img.height }
    get position () { return this.#position }
}
