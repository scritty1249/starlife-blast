import { Vector } from "../math/Vector.js";

// all time in milliseconds
export class Animation {
    #position = new Vector();
    #frame = undefined;
    #index = 0;
    #time = {
        current: 0,
        drawn: 0
    };
    #promise = {
        onend: {},
        onstart: {} // resolves when played and delay has passed
    };
    #paused = true;
    #loop = false;
    #framerate;
    #frames;
    speed = 1;
    delay = 0; // not affected by speed
    constructor (position, frames, framerate) {
        this.#position.apply(position);
        this.#framerate = 1000 / framerate;
        this.#frames = frames;
        this.#newPromise(this.#promise.onend);
        this.#newPromise(this.#promise.onstart);
    }

    #newPromise (container) {
        const { promise: oldPromise, resolve: oldResolve, reject: oldReject } = container;
        ({ promise: container.promise, resolve: container.resolve, reject: container.reject } = Promise.withResolvers());
        container.isResolved = false;
        container.promise
            .finally(() => container.isResolved = true);
        // maintain previous promises
        if (oldPromise !== undefined) // assume all are populated if promise exists
            container.promise
                .then((e) => oldResolve(e))
                .catch((e) => oldReject(e));
    }

    update (delta) {
        if (this.paused) return;
        if (this.frame === 0) {
            this.#time.drawn = 0;
            if (!this.#promise.onstart.isResolved) this.#promise.onstart.resolve();
        } else if (this.ended && !this.#promise.onend.isResolved) {
            this.#promise.onend.resolve();
            this.#newPromise(this.#promise.onend);
            this.#newPromise(this.#promise.onstart);
        }
        const previous = this.#time.current;
        this.#time.current += delta;
        const frames = Math.floor(this.#delta / this.#interval);
        if (frames) {
            this.frame += frames;
            this.#time.drawn = previous + (this.#framerate * frames);
            this.#frame = this.#frames.at(this.frame);
        }
    }
    draw (cursor) {
        if (this.#frame && this.#delta >= 0) this.#frame.draw(cursor, this.position);
    }
    next () {
        if (this.ended) return undefined;
        if (this.playing) {
            this.#time.drawn = this.#time.current;
            this.#frame = this.#frames.at(this.frame++);
        }
        return this.#frame;
    }
    play () {
        this.#paused = false;
        return this; // for chaining
    }
    pause () {
        this.#paused = true;
        return this; // for chaining
    }
    clone () { // Clones by reference
        const ani = new Animation (this.position, this.#frames.clone(), this.#framerate * 1000);
        ani.speed = this.speed;
        if (this.playing) ani.play();
        return ani;
    }

    get isAnimation () { return true }
    get hasNext () { return this.#delta >= this.#interval && this.playing && !this.ended }
    get playing () { return !this.paused }
    get paused () { return this.#paused }
    get ended () { return this.frame >= this.#frames.length && !this.loop }
    get onend () { return this.#promise.onend.promise }
    get onstart () { return this.#promise.onstart.promise }
    get progress () { return this.frame / this.#frames.length }
    get duration () { return this.#framerate * this.#frames.length }
    get elapsed () { return this.progress * this.duration }
    get position () { return this.#position }
    get frame () { return this.#index }
    set frame (index) { return this.#index = (this.loop ? index % this.#frames.length : Math.min(index, this.#frames.length - 1)) }
    get loop () { return this.#loop }
    set loop (bool) {
        if (bool && this.loop && this.#index > this.#frames.length)
            this.#index = 0;
        return (this.#loop = bool);
    }
    get #delta () { ((this.#time.current / this.speed) - this.delay) - (this.#time.drawn / this.speed) }
    get #interval () { return this.#framerate / this.speed }
}
