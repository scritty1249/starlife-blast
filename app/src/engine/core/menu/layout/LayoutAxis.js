import { typeString } from "../../utils/logging.js";

export const ALIGNMENT = {
    START: 3,
    CENTER: 2,
    END: 1
};
Object.freeze(ALIGNMENT);

const _ALIGNMENT_VALUES = Object.values(ALIGNMENT);
const _ALIGNMENT_KEY_MAP = new Map(Array.from(Object.entries(ALIGNMENT), ([k, v]) => [v, k.toLowerCase()]));

function getAlignment (value) {
    if (typeof value === "string" || value instanceof String) {
        return ALIGNMENT[value.toUpperCase()];
    } else if (Number.isInteger(value) && _ALIGNMENT_VALUES.includes(value)) {
        return value;
    } else if (value?.isAxisAlignment) {
        return value.align;
    }
    return undefined;
}

export class LayoutAxis {
    #align = ALIGNMENT.CENTER;
    constructor (align) {
        if (align) {
            const alignment = getAlignment(align);
            if (!alignment) throw new Error(`[${typeString(this)}]: Invalid alignment ${align}`);
            this.#align = alignment;
        }
    }

    eq (other) { return other?.isAxisAlignment && other.align === this.align }
    clone () { return new AxisAlignment(this.#align) }
    toString () { return _ALIGNMENT_KEY_MAP.get(this.#align) }
    toJSON () { return this.#align }

    get isLayoutAxis () { return true }
    get align () { return this.#align }
    set align (value) {
        const alignment = getAlignment(value);
        if (!alignment) throw new Error(`[${typeString(this)}]: Invalid alignment ${value}`);
        return (this.#align = alignment);
    }
}
