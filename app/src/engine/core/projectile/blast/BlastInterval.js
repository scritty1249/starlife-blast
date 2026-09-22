import { BoundingBox } from "../../geometry/BoundingBox.js";
import { Terrain } from "../../geometry/Terrain.js";
import { Polygon } from "../../geometry/Polygon.js";
import { BlobPacker } from "../../utils/BlobPacker.js";
import { Blast } from "./Blast.js";
import { typeString } from "../../utils/logging.js";

export class BlastInterval {
    static unpack (data) {
        const viewIterator = BlobPacker.unpack(data);
        const { d, b } = viewIterator.next().Object;
        const blasts = b.map((blast) => Blast.decode(blast));
        const polygonView = viewIterator.next().value;
        const terrain = polygonView.byteLength
            ? new Terrain(Polygon.unpack(polygonView))
            : undefined;
        return new BlastInterval(d, terrain, undefined, blasts);
    }
    #blasts = new Array();
    #delay;
    #frame;
    #terrain;
    #bbox;
    #bboxes;
    constructor (delay, terrain, frame = undefined, blasts = []) {
        this.#delay = delay;
        this.#frame = frame;
        this.#terrain = terrain;
        this.#blasts.push(...blasts);
        this.#bboxes = blasts.map(({shape}) => shape.getBoundingBox());
        this.#bbox = this.boundingBoxes?.length ? BoundingBox.merge(this.boundingBoxes) : new BoundingBox();
        Object.freeze(this.#blasts);
        Object.freeze(this.#bboxes);
    }

    // doesn't include the frame
    pack (includeTerrain = true) {
        const packer = new BlobPacker();
        packer.push({
            d: this.delay,
            b: this.blasts.map((blast) => {
                const payload = blast.encode();
                delete payload.buffers;
                return payload;
            })
        });
        packer.push((includeTerrain && this.terrain?.isTerrain)
            ? this.terrain.polygon.pack()
            : new ArrayBuffer(0)
        );
        return packer.pack();
    }
    // [!] doesn't clone the frame
    clone (deep = false) {
        const terrain = deep ? this.terrain.clone(true) : this.terrain;
        return new BlastInterval(this.delay, terrain, this.frame, this.blasts);
    }

    get isBlastInterval () { return true }
    get blasts () { return this.#blasts }
    get delay () { return this.#delay }
    get frame () { return this.#frame }
    set frame (frame) {
        if (this.#frame)
            throw new Error(`[${typeString(this)}]: Cannot set frame, property already set`);
        return (this.#frame = frame);
    }
    get terrain () { return this.#terrain }
    set terrain (terrain) {
        if (this.#terrain?.isTerrain)
            throw new Error(`[${typeString(this)}]: Cannot set terrain, property already set`);
        return (this.#terrain = terrain);
    }
    get boundingBox () { return this.#bbox }
    get boundingBoxes () { return this.#bboxes }
}
