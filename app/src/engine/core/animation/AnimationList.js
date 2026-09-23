import { typeString } from "../utils/logging.js";

export class AnimationList {
    #animations = new Array();
    constructor (...animations) {
        this.push(...animations);
    }

    // cleans up ended animations
    #trim () {
        const animations = this.#animations.filter((ani) => !ani.ended || ani.isAnimationList);
        if (animations.length === this.length) return;
        this.#animations.splice(0, this.length);
        for (let i = 0; i < animations.length; i++)
            this.#animations.push(animations[i]);
    }

    // accepts AnimationLists and Animations
    push (...animations) {
        for (const animation of animations) {
            if (!animation?.isAnimationList && !animation?.isAnimation)
                throw new Error(`[${typeString(this)}] Error: Cannot add non-animation of type ${typeString(animation)}`);
            else this.#animations.push(animation);
        }
    }
    update (delta) {
        this.#trim();
        this.#animations.forEach((ani) => ani.update(delta));
    }
    draw (cursor) {
        this.#trim();
        this.#animations.forEach((ani) => ani.draw(cursor));
    }
    play () {
        for (const ani of this.#animations)
            ani.play();
        return this;
    }
    pause () {
        for (const ani of this.#animations)
            ani.pause();
        return this;
    }
    // removes everything, including AnimationLists
    clear () {
        this.#animations.splice(0, this.length);
        return this;
    }
    // removes all Animations, keeps AnimationLists
    // depth parameter dictates nested AnimationList recursion depth
    // setitng depth to non-numeric truthy value will recurse through all children
    flush (depth = 0) {
        const animations = this.#animations.filter((ani) => ani.isAnimationList);
        if (animations.length !== this.length) {
            this.#animations.splice(0, this.length);
            for (let i = 0; i < animations.length; i++)
                this.#animations.push(animations[i]);
        }
        if (depth) {
            const d = Number.isFinite(depth) ? depth - 1 : !!depth;
            animations.forEach((ani) => ani.flush(d));
        }
        return this;
    }
    // returns all animations recursively
    *flatten () {
        for (let i = 0; i < this.length; i++) {
            const ani = this.#animations[i];
            if (ani.isAnimationList) yield* ani.flatten();
            else yield ani;
        }
    }
    // returns all AnimationLists recursively
    *children () {
        for (let i = 0; i < this.length; i++) {
            const ani = this.#animations[i];
            if (ani.isAnimationList) yield ani;
        }
    }
    *[Symbol.iterator]() {
        yield* this.#animations;
    }

    get isAnimationList () { return true }
    get playing () { return this.#animations.some((ani) => ani.playing) }
    get length () { return this.#animations.length }
    get onend () { return Promise.all(this.#animations.map((ani) => ani.onend)) }
    get ended () { return !this.length || this.#animations.every((ani) => ani.ended) }
}
