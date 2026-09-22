import { Multishot } from "./Multishot.js";
import { BoundingBox } from "../geometry/BoundingBox.js";
import { typeString } from "../utils/logging.js";
import { Identifiable } from "../utils/tracking/Identifiable.js";
import { AmmoTracer } from "./AmmoTracer.js";
import { AmmoLegend } from "./AmmoLegend.js";

// a sequence of multishot "stages"
export class Ammo extends Identifiable {
    static SFX = {
        null: () => {}
    };
    #bbox = new BoundingBox();
    #time = 0;
    #colliders;
    #currentStage;
    #isStarted = false;
    #stages = new Array();
    #stageIdx = 0;
    #blasts = new Array();
    #decodeParams = new Array(); // to pass between threads
    #transferData = {}; // pass between threads. Primitives/Basic objects only
    #launchCallback;
    #displayBoundingBox;
    #isTracing = true;
    constructor (colliders = [], stages = []) {
        super();
        this.#colliders = colliders;
        for (const stage of stages) {
            this.#stages.push(stage);
        }
        this.#currentStage = this.#stages[0];
    }

    draw (cursor) {
        if (!this.isFinished) {
            this.#currentStage.drawGlow(cursor);
            this.#currentStage.drawBody(cursor);
        }
    }
    nextStage () {
        this.#currentStage = this.#stages[++this.#stageIdx];
        this.#currentStage.blastTimeOffset += this.time;
    }
    update (seconds) {
        if (!this.#isStarted) this.#isStarted = true;
        this.time += seconds;
        this.#currentStage?.update(seconds);
        while (this.#currentStage?.isFinished) {
            if (this.hasNextStage) this.nextStage();
            else this.#currentStage = undefined;
        }
        const bbox = this.currentStage?.getBoundingBox?.(true, true, false);
        if (bbox) {
            this.#bbox.apply(bbox);
        } else {
            this.#bbox.min.apply(0);
            this.#bbox.max.apply(0);
        }
    }
    // create multishot stage by default
    newStage (delay = 0) {
        const stage = new Multishot(delay, this.blasts, this.colliders, this.constructor.SFX);
        stage.launchCallback = this.launchCallback;
        stage.displayBoundingBox = this.displayBoundingBox;
        this.#stages.push(stage);
        if (this.#stageIdx === 0 && this.#currentStage === undefined) this.#currentStage = this.#stages[this.#stageIdx];
        return stage;
    }
    getBoundingBox (merge = true, includeStopped = true, includeFx = false) {
        if (this.currentStage) {
            this.#bbox.apply(this.currentStage.getBoundingBox?.(merge, includeStopped, includeFx));
        } else {
            this.#bbox.min.apply(0);
            this.#bbox.max.apply(0);
        }
        return this.#bbox;
    }
    // returns bounding boxes of all blasts of delay within range (start - end)
    // if end is undefined, all blasts from start will be included
    getBlastBoundingBox (start = 0, end = undefined, merge = true) {
        const bboxes = [];
        for (const blast of this.blasts)
            if (blast.delay >= start && (end === undefined || blast.delay < end))
                bboxes.push(blast.shape.getBoundingBox().clone());
        if (!merge) return bboxes;
        if (!bboxes.length) return new BoundingBox();
        const bbox = bboxes.shift();
        for (const bb of bboxes)
            bbox.add(bb, true);
        return bbox;
    }
    clone (deep = false) {
        const stages = [];
        for (const stage of this.#stages) stages.push(stage.clone(deep));
        const ammo = new Ammo(this.colliders, stages);
        return ammo;
    }
    traceLegend (legend) {
        try {
            const stages = this.stages;
            for (let i = 0; i < stages.length; i++)
                stages[i].traceLegend(legend.stages[i]);
            this.decodeTransferData(legend.transfer);
            this.#isTracing = false;
        } catch (error) {
            console.error(`[${typeString(this)}]: Error parsing legend`);
            throw error;
        }
    }
    encodeTransferData () { return this.transferData }
    decodeTransferData (data) {}
    getTracer () { return new AmmoTracer(this.stages) }
    encode () { return this.decodeParams }

    get isAmmo () { return true }
    get isInsideDisplay () { return this.stages.some(({isInsideDisplay}) => isInsideDisplay) } // [!] will return shot as in-bounds if a display bbox is not set
    get isTracing () { return this.#isTracing }
    get decodeParams () { return this.#decodeParams }
    get transferData () { return this.#transferData }
    get colliders () { return this.#colliders }
    get blasts () { return this.#blasts }
    get stages () { return this.#stages }
    get currentStage () { return this.#currentStage }
    get legend () { return AmmoLegend.capture(this) }
    get hasNextStage () { return this.#stageIdx + 1 < this.#stages.length }
    get isStarted () { return this.#isStarted }
    get isFinished () { return this.isStarted && this.#currentStage === undefined }
    get time () { return this.#time }
    set time (value) { return (this.#time = value) }
    get launchCallback () { return this.#launchCallback }
    set launchCallback (callbackFn) {
        for (const stage of this.stages)
            stage.launchCallback = callbackFn;
        return (this.#launchCallback = callbackFn);
    }
    get displayBoundingBox () { return this.#displayBoundingBox }
    set displayBoundingBox (bbox) {
        for (const stage of this.stages)
            stage.displayBoundingBox = bbox;
        return (this.#displayBoundingBox = bbox);
    }
    set applyDestruction (value) { this.stages.forEach((stage) => stage.applyDestruction = value); return value }
}
