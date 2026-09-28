export class LayoutSpacing {
    #top = 0;
    #left = 0;
    #bottom = 0;
    #right = 0;
    onupdate;
    // accepts args
    // 1: top | left | bottom | right
    // 2: top | left, bottom | right
    // 4: top, left, bottom, right
    constructor (top = 0, left, bottom, right) {
        this.apply(top, left, bottom, right);
    }

    #update () {
        this.onupdate?.();
    }

    // accepts args
    // 1: top | left | bottom | right
    // 2: top | bottom, left | right
    // 4: top, left, bottom, right
    apply (top, left, bottom, right) {
        if (top === undefined) {
            // called with no arguments
        } else if (left === undefined) {
            this.#top
                = this.#left
                = this.#bottom
                = this.#right
                = top;
        } else if (bottom === undefined) {
            this.#top = this.#bottom = top;
            this.#left = this.#right = left;
        } else {
            this.#top = top;
            this.#left = left;
            this.#bottom = bottom;
            this.#right = right;
        }
        this.#update();
        return this; // for chaining
    }

    get isLayoutSpacing () { return true }
    get horizontal () { return this.right + this.left }
    set horizontal (num) {
        this.#left = this.#right = num;
        this.#update();
        return num;
    }
    get vertical () { return this.top + this.bottom }
    set vertical (num) {
        this.#top = this.#bottom = num;
        this.#update();
        return num;
    }
    get top () { return this.#top }
    get left () { return this.#left }
    get bottom () { return this.#bottom }
    get right () { return this.#right }
    set top (num) {
        const result = (this.#top = num);
        this.#update();
        return result;
    }
    set left (num) {
        const result = (this.#left = num);
        this.#update();
        return result;
    }
    set bottom (num) {
        const result = (this.#bottom = num);
        this.#update();
        return result;
    }
    set right (num) {
        const result = (this.#right = num);
        this.#update();
        return result;
    }
}
