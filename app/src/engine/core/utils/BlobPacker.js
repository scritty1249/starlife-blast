export class BlobPacker {
    static HEADER_SIZE_OFFSET = 4; // 32-bit uint
    static unpack (data, byteOffset = 0, byteLength = undefined) {
        const { HEADER_SIZE_OFFSET } = BlobPacker;
        
        const originalOffset = data.byteOffset || 0;
        const buffer = ArrayBuffer.isView(data) ? data.buffer : data;

        const localOffset = Number.isInteger(byteOffset) && byteOffset >= 0
            ? byteOffset : 0;
        const localLength = Number.isInteger(byteLength) && byteLength >= 0
            ? byteLength : (ArrayBuffer.isView(data)
                ? data.byteLength
                : data.byteLength - localOffset);

        return new BlobView(buffer, localOffset + originalOffset, localLength);
    }
    // close buffer if browser supports it
    static closeBuffer (buffer) {
        if (buffer instanceof ArrayBuffer && typeof buffer?.transfer === "function")
            try { buffer.transfer(0) } catch {}
    }
    static #parseItem (item, textEncoder) {
        if (item instanceof ArrayBuffer) {
            return new Uint8Array(item);
        } else if (ArrayBuffer.isView(item)) {
            return new Uint8Array(item.buffer, item.byteOffset, item.byteLength);
        } else if (Number.isFinite(item)) {
            const bytes = new Uint8Array(4);
            (new DataView(bytes.buffer)).setFloat32(0, item, true);
            return bytes;
        } else if (typeof item === "string" || item instanceof String) {
            return textEncoder.encode(item);
        } else if (item) {
            return textEncoder.encode(JSON.stringify(item));
        } else {
            return new Uint8Array(0);
        }
    }
    #textEncoder = new TextEncoder();
    #items = new Array();
    constructor () {}

    #getDataViews () {
        const views = [];
        for (const item of this.#items)
            views.push(BlobPacker.#parseItem(item, this.#textEncoder));
        return views;
    }

    // data may be an ArrayBuffer or JSON Object
    push (data) {
        this.#items.push(data);
    }
    at (index) {
        return this.#items.at(index);
    }
    pack () {
        const { HEADER_SIZE_OFFSET } = BlobPacker;
        const views = this.#getDataViews();
        const size = views.reduce((acc, curr) => acc + curr.byteLength + HEADER_SIZE_OFFSET, 0);
        const uintView = new Uint8Array(size);
        const dataView = new DataView(uintView.buffer);
        let offset = 0;
        for (const view of views) {
            const length = view.byteLength;
            dataView.setUint32(offset, length, true);
            offset += HEADER_SIZE_OFFSET;
            uintView.set(view, offset);
            offset += length;
        }
        return uintView.buffer;
    }

    get isBlobPacker () { return true }
    get length () { return this.#items.length }
}

class BlobView extends Iterator {
    #view;
    #offset = 0;
    constructor (buffer, offset, length) {
        super();
        this.#view = new DataView(buffer, offset, length);
    }

    next () {
        const view = this.#view;
        const { HEADER_SIZE_OFFSET } = BlobPacker;
        const { buffer, byteOffset, byteLength } = view;
        if (this.#offset < byteLength) {
            const length = view.getUint32(this.#offset, true);
            this.#offset += HEADER_SIZE_OFFSET;
            const data = new DataView(buffer, this.#offset + byteOffset, length);
            this.#offset += length;
            return new PackedItem(data);
        }
        return new PackedItem();
    }

    get isBlobView () { return true }
}

class PackedItem {
    #done;
    #view;
    #textDecoder = new TextDecoder();
    constructor (dataView = undefined) {
        this.#done = !(dataView instanceof DataView);
        this.#view = dataView;
    }

    get isPackedItem () { return true }
    get done () { return this.#done }
    get value () { return this.#view }
    get String () { return this.done ? undefined : this.#textDecoder.decode(this.value) }
    get Object () { return this.done ? undefined : JSON.parse(this.String) }
    get Number () { return this.done ? undefined : this.value.getFloat32(0, true) } // [!] JS does not distingish between Floats and Integers (for expressions)
}