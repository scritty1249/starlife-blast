import { BoundingBox } from "../../geometry/BoundingBox.js";
import { Vector } from "../../math/Vector.js";
import { MenuItem } from "../MenuItem.js";
import { LayoutSpacing } from "./LayoutSpacing.js";

export class ItemLayout extends MenuItem {
    #bbox = new BoundingBox();
    #items = new Array();
    #padding = new LayoutSpacing();
    #position = new Vector();
    #size = new Vector(); // [!] do not return as reference
    #gap = 0;
    #isColumn = false;
    constructor () {
        super();
        this.padding.onupdate = () => this.updateLayout();
    }

    #updateColumnPositions () {
        const { padding, gap } = this;
        const maxWidth = this.#getItemMaxWidth();
        const { x: originX, y: originY } = this.#position;
        const midX = padding.left + (maxWidth / 2);
        let y = originY - padding.top;
        for (let i = 0; i < this.#items.length; i++) {
            const item = this.#items[i];
            const x = midX - (item.width / 2);
            item.setPosition(x + originX, y);
            y -= item.height;
            if (i + 1 < this.#items.length) y -= gap;
        }
        this.#size.x = padding.left + maxWidth + padding.right;
        this.#size.y = padding.bottom + (originY - y);
    }
    #updateRowPositions () {
        const { padding, gap } = this;
        const maxHeight = this.#getItemMaxHeight();
        const { x: originX, y: originY } = this.#position;
        const midY = (originY - padding.top) - (maxHeight / 2);
        let x = padding.left;
        for (let i = 0; i < this.#items.length; i++) {
            const item = this.#items[i];
            const y = midY + (item.height / 2);
            item.setPosition(x + originX, y);
            x += item.width;
            if (i + 1 < this.#items.length) x += gap;
        }
        this.#size.x = x + padding.right;
        this.#size.y = padding.top + maxHeight + padding.bottom;
    }
    #updateBoundingBox () {
        const { min, max } = this.#bbox;
        min.apply(this.#position.x, this.#position.y - this.#size.y);
        max.apply(this.#position.x + this.#size.x, this.#position.y);
    }
    #getItemMaxWidth () {
        let maxWidth = 0;
        for (let i = 0; i < this.#items.length; i++) {
            const { width } = this.#items[i];
            if (width > maxWidth) maxWidth = width;
        }
        return maxWidth;
    }
    #getItemMaxHeight () {
        let maxHeight = 0;
        for (let i = 0; i < this.#items.length; i++) {
            const { height } = this.#items[i];
            if (height > maxHeight) maxHeight = height;
        }
        return maxHeight;
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
        if (this.isColumn) this.#updateColumnPositions();
        else this.#updateRowPositions();
        this.#updateBoundingBox();
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
    get children () { return this.#items.values() }
    get length () { return this.#items.length }
    get padding () { return this.#padding }
    get width () { return this.#size.x }
    get height () { return this.#size.y }
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
