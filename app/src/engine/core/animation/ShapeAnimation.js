import { Animation } from "./Animation.js";

export class ShapeAnimation extends Animation {
    #shape;
    #drawFn; // (cursor, shape, progress, ...args) => {}
    #drawArgs;
    // duration in seconds
    constructor (shape, duration, framerate, drawFn = (cursor, shape, progress) => {}, drawArgs = []) {
        const totalFramesCount = Math.ceil(duration * framerate);
        super(shape.origin, Array.from({length: totalFramesCount}), framerate);
        this.#shape = shape;
        this.#drawFn = drawFn?.bind(this);
        this.#drawArgs = drawArgs;
    }

    draw (cursor) {
        if (this.progress > 0)
            this.#drawFn?.(cursor, this.#shape, this.progress, ...this.#drawArgs);
    }
    clone () {
        const ani = new ShapeAnimation(this.#shape.clone(), this.duration, this.framerate, this.#drawFn);
        ani.speed = this.speed;
        if (this.playing) ani.play();
        return ani;
    }

    get isShapeAnimation () { return true }
    get position () { return this.#shape.origin }
}
