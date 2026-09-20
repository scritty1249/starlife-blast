import { HitPoints } from "./hitpoints/HitPoints.js";
import { Vector } from "../math/Vector.js";
import { typeString } from "../utils/logging.js";
import { Hashable, FNV1a } from "../math/Hash.js";

// assigned to each player
export class HitTotal extends Hashable {
    static fromObject (obj, hitpointMap) {
        try {
            return new HitTotal(...Array.from(obj,
                (hitpoints) => hitpointMap[String(hitpoints.type)].fromObject(hitpoints)
            ));
        } catch (err) {
            console.error(`[${typeString(this)}]: Failed to parse HitTotal object. is HitpointMap populated?`);
            throw err;
        }
    }
    #barOffset = new Vector();
    #layers = new Array();
    constructor (bottomLayer, ...layers) {
        super();
        this.push(bottomLayer, ...layers);
    }

    // returns the remaining damage, if any, after all layers have dropped to zero amount.
    // expects amount to be positive
    damage (amount) {
        let rollover = amount;
        while (rollover > 0 && !this.currentLayer.isZero)
            rollover = this.currentLayer.update(-rollover);
        return rollover;
    }
    push (...layers) {
        if (layers.some((layer) => !layer?.isHitPoints)) throw new Error(`[${typeString(this)}]: Layers must be of type HitPoints`);
        this.#layers.push(...layers);
    }
    pop () { 
        return this.#layers.pop();
    }
    insert (index, ...layers) {
        if (layers.some((layer) => !layer?.isHitPoints)) throw new Error(`[${typeString(this)}]: Layers must be of type HitPoints`);
        this.#layers.splice(index, 0, ...layers);
    }
    remove (index, deleteCount = 1) {
        this.#layers.splice(index, deleteCount);
    }
    layer (index) {
        return this.#layers.at(index);
    }
    draw (cursor, position) {
        const pos = position.add(this.barOffset);
        const { bars } = this;
        bars[0].draw(cursor, pos, true);
        pos.x -= bars[0].width / 2;
        for (let i = 1; i < bars.length; i++)
            bars[i].draw(cursor, pos, false);
    }
    toJSON () {
        return {
            layers: this.#layers.map((layer) => layer.toJSON()),
            hash: this.hash
        };
    }
    set (layers) {
        if (layers?.length !== this.#layers.length) throw new Error(`[${typeString(this)}]: Mismatched HitPoint layers`);
        for (let i = 0; i < this.#layers.length; i++) {
            const { increase, decrease, amount, regen, max, reserve } = layers[i];
            const layer = this.#layers[i];
            layer.max = max;
            layer.reserve = reserve;
            layer.amount = amount;
            layer.regeneration = regen;
            layer.increaseMultiplier = increase;
            layer.decreaseMultiplier = decrease;
        }
    }
    clone (deep = false) {
        return new HitTotal(...this.#layers.map((layer) => layer.clone(deep)));
    }

    get isHitTotal () { return true }
    get rawHash () {
        let hash = this.baseLayer.rawHash;
        for (let i = 1; i < this.length; i++)
            hash = FNV1a.Extend32Bit(hash, this.#layers[i].rawHash);
        return hash;
    }
    get bars () { return this.#layers.map(({bar}) => bar) } // convenience
    get barOffset () { return this.#barOffset }
    get isZero () { return this.baseLayer.isZero } // if base layer is zero, player is dead.
    get baseLayer () { return this.#layers[0] }
    get length () { return this.#layers.length }
    get currentLayer () { return this.#layers[this.currentLayerIndex] }
    get currentLayerIndex () {
        for (let i = this.#layers.length - 1; i >= 0; i--)
            if (!this.#layers[i].isZero) return i;
        return 0;
    }
    get barWidth () { return this.baseLayer.bar.width }
    set barWidth (pixels) {
        const baseMax = this.baseLayer.max;
        for (const layer of this.#layers)
            layer.bar.width = pixels * (layer.max / baseMax);
        return pixels;
    }
    get barHeight () { return this.baseLayer.bar.height }
    set barHeight (pixels) {
        for (const layer of this.#layers)
            layer.bar.height = pixels;
        return pixels;
    }
}