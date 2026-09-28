import { BoundingBox } from "../../geometry/BoundingBox.js";
import { Vector } from "../../math/Vector.js";
import { MenuItem } from "../MenuItem.js";
import { LayoutSpacing } from "./LayoutSpacing.js";
import { LayoutAxis, ALIGNMENT } from "./LayoutAxis.js";

export class ItemLayout extends MenuItem {
    #bbox = new BoundingBox();
    #items = new Array();
    #padding = new LayoutSpacing();
    #crossAxis = new LayoutAxis();
    #position = new Vector();
    #size = new Vector(); // [!] do not return as reference
    #gap = 0;
    #isColumn = false;
    constructor () {
        super();
        this.padding.onupdate = () => this.updateLayout();
    }

    #updateSize () {
        let x = 0;
        let y = 0;
        if (this.#items.length) {
            const collectX = this.isColumn
                ? (item) => { const { width } = item; if (width > x) x = width; }
                : (item) => { x += item.width }
            const collectY = this.isColumn
                ? (item) => { y += item.height }
                : (item) => { const { height } = item; if (height > y) y = height; }
            for (let i = 0; i < this.#items.length; i++) {
                const item = this.#items[i];
                collectX(item);
                collectY(item);
            }
            const { horizontal, vertical } = this.padding;
            const gaps = (this.#items.length - 1) * this.gap;
            x += horizontal;
            y += vertical;
            if (this.isColumn) y += gaps;
            else x += gaps;
        }
        this.#size.apply(x, y);
    }
    // [!] trying to shave down code redundancy at the cost of bloating performance
    //      rewrite this first if engine performance suffers - KT
    #getCrossAlignMethod () {
        const origin = this.isColumn
            ? this.#originX
            : this.#originY;
        const max = this.isColumn
            ? this.#size.x
            : this.#size.y;
        const sign = this.isColumn
            ? -1
            : 1;
        const getLength = this.isColumn
            ? (item) => item.width * sign
            : (item) => item.height * sign;
        if (this.align === ALIGNMENT.CENTER) {
            const pad = this.isColumn
                ? this.padding.horizontal
                : this.padding.vertical;
            const offset = origin - (sign * (max - pad) / 2);
            return (item) => offset + (getLength(item) / 2);
        } else if (this.align === ALIGNMENT.START) {
            return (item) => origin;
        } else if (this.align === ALIGNMENT.END) {
            const offset = this.isColumn
                ? (origin + max) - this.padding.horizontal
                : (origin - max) + this.padding.vertical;
            return (item) => offset + getLength(item);
        }
    }
    // [!] trying to shave down code redundancy at the cost of bloating performance
    //      rewrite this first if engine performance suffers - KT
    #updateItemPositions () {
        if (!this.#items.length) return;
        const { gap } = this;
        const getAlignment = this.#getCrossAlignMethod();
        let mainAxis = this.isColumn
            ? this.#originY
            : this.#originX;
        const applyPosition = this.isColumn
            ? (item) => {
                item.setPosition(getAlignment(item), mainAxis);
                mainAxis -= item.height + gap;
            } : (item) => {
                item.setPosition(mainAxis, getAlignment(item));
                mainAxis += item.width + gap;
            };
        for (let i = 0; i < this.#items.length; i++)
            applyPosition(this.#items[i]);
    }
    #updateBoundingBox () {
        const { min, max } = this.#bbox;
        min.apply(this.#position.x, this.#position.y - this.#size.y);
        max.apply(this.#position.x + this.#size.x, this.#position.y);
    }

    // menuitem methods
    async computeBounds (cursor) {
        await super.computeBounds(cursor);
        const items = this.#items;
        for (let i = 0; i < items.length; i++)
            await items[i].computeBounds(cursor);
        this.updateLayout();
    }
    draw (cursor, fixed) {
        const items = this.#items;
        for (let i = 0; i < items.length; i++)
            if (!items[i]?.hide) items[i]?.draw?.(cursor, fixed);
    }
    isOver (point) { return false }
    updateLayout () {
        for (let i = 0; i < this.#items; i++) {
            const item = this.#items[i];
            if (item?.isItemLayout) item.updateLayout();
        }
        this.#updateSize();
        this.#updateBoundingBox();
        this.#updateItemPositions();
    }
    setPosition (x, y = null) {
        this.#position.apply(x, y).sub(this.originOffset, true);
        this.updateLayout();
    }
    getPosition () { return this.#position.add(this.originOffset) }
    getBoundingBox () { return this.#bbox }
    // array-like methods
    get (id) {
        const items = this.#items;
        for (let i = 0; i < items.length; i++)
            if (items[i]?.id === id)
                return items[i];
        return null;
    }
    at (index) {
        return this.#items.at(index);
    }
    unshift (...items) {
        const length = this.#items.unshift(...items);
        this.updateLayout();
        return length;
    }
    shift () {
        const item = this.#items.shift();
        this.updateLayout();
        return item;
    }
    some (...args) { return this.#items.some(...args) }
    every (...args) { return this.#items.every(...args) }
    push (...items) {
        const length = this.#items.push(...items);
        this.updateLayout();
        return length;
    }
    pop () {
        const item = this.#items.pop();
        this.updateLayout();
        return item;
    }
    splice (...args) {
        const items = this.#items.splice(...args);
        this.updateLayout();
        return items;
    }
    clear () {
        this.#items.splice(0, this.#items.length);
        this.updateLayout();
    }
    filter (...args) { return this.#items.filter(...args) }
    map (...args) { return this.#items.map(...args) }

    get isItemLayout () { return true }
    get #originX () { return this.#position.x + this.padding.left }
    get #originY () { return this.#position.y - this.padding.top }
    get children () { return this.#items.values() }
    get length () { return this.#items.length }
    get padding () { return this.#padding }
    get width () { return this.#size.x }
    get height () { return this.#size.y }
    get size () { return this.#size.clone() }
    get align () { return this.#crossAxis.align }
    set align (value) {
        const prev = this.align;
        this.#crossAxis.align = value;
        if (prev !== value) this.updateLayout();
        return value;
    }
    get isColumn () { return this.#isColumn }
    set isColumn (bool) {
        const prev = this.isColumn;
        this.#isColumn = bool;
        if (bool != prev) this.updateLayout();
        return bool;
    }
    get gap () { return this.#gap }
    set gap (num) {
        const result = (this.#gap = num);
        this.updateLayout();
        return result;
    }
}
