import { BoundingBox } from "../geometry/BoundingBox.js";
import { Vector } from "../math/Vector.js";
import { Identifiable } from "../utils/tracking/Identifiable.js";

export class MenuItem extends Identifiable {
    // these need to be set as non-functions by default for isSupported checks to work
    // all given parameters are Vectors
    #callback = {
        // (position, delta, isTouch)
        onclick: undefined,
        // (position, isTouch)
        onhold: undefined,
        // (position, origin, delta, isTouch) => ?null
        // returning null relays that dragging was interrupted on this item
        ondrag: undefined,
        // (position, isTouch)
        onpress: undefined,
        // (position, delta, isTouch)
        // delta is calculated from pressed position
        onrelease: undefined,
        // (position, delta, isTouch)
        // position is where the pointer is while scrolled
        // delta is scrolled amount
        onscroll: undefined
    };
    #userData = {};
    #originOffset = new Vector(0, 0);
    keepDragFocus = false; // when set, drag events will continue even after pointer leaves this button's area
    hide = false; // tells InterfaceLayer to skip drawing this item, and will not return any callbacks
    constructor () { super() }

    async computeBounds (cursor) {} // optional. Can be used to manually trigger any recalculations for sizing / positioning
    draw (cursor, fixed) {}
    isOver (point) { return false }
    getBoundingBox () { return new BoundingBox() }
    setPosition (x, y = null) {}
    getPosition () { return new Vector().add(this.originOffset) }

    get isMenuItem () { return true }
    get originOffset () { return this.#originOffset }
    get children () { return false } // subclasses should return an iterator of contained items
    get width () { return 0 }
    get height () { return 0 }
    get size () { return this.getBoundingBox().size }
    get userData () { return this.#userData }
    get onclick () { return this.hide ? null : this.#callback.onclick }
    set onclick (callbackFn) { return (this.#callback.onclick = callbackFn) }
    get onhold () { return this.hide ? null : this.#callback.onhold }
    set onhold (callbackFn) { return (this.#callback.onhold = callbackFn) }
    get ondrag () { return this.hide ? null : this.#callback.ondrag }
    set ondrag (callbackFn) { return (this.#callback.ondrag = callbackFn) }
    get onpress () { return this.hide ? null : this.#callback.onpress }
    set onpress (callbackFn) { return (this.#callback.onpress = callbackFn) }
    get onrelease () { return this.hide ? null : this.#callback.onrelease }
    set onrelease (callbackFn) { return (this.#callback.onrelease = callbackFn) }
    get onscroll () { return this.hide ? null : this.#callback.onscroll }
    set onscroll (callbackFn) { return (this.#callback.onscroll = callbackFn) }
}