import { BoundingBox } from "../../geometry/BoundingBox.js";
import { Vector } from "../../math/Vector.js";
import { MenuItem } from "../MenuItem.js";
import { LayoutSpacing } from "./LayoutSpacing.js";
import { LayoutAxis, ALIGNMENT } from "./LayoutAxis.js";

function getContentWidth (menuItem) { return Math.max(menuItem.width, menuItem.minWidth) }
function getContentHeight (menuItem) { return Math.max(menuItem.height, menuItem.minHeight) }

// falsey conditions return values for main axis, when isColumn = false
class LayoutAlignment {
    static #getSize (flip, vec) {
        return flip ? vec.y : vec.x;
    }
    static #getSign (flip) {
        return flip ? 1 : -1;
    }
    #x = new LayoutAxis();
    #y = new LayoutAxis();
    #isColumn = false;
    #main;
    #cross;
    #onswap;
    constructor (isColumn, onswap) {
        this.#isColumn = !!isColumn;
        this.#main = this.#x;
        this.#cross = this.#y;
        this.#onswap = onswap;
    }

    #swapAxes () {
        const mainCallback = this.main.onupdate;
        const crossCallback = this.cross.onupdate;
        const axis = this.main;
        this.#main = this.cross;
        this.main.onupdate = mainCallback;
        this.#cross = axis;
        this.cross.onupdate = crossCallback;
        this.#onswap?.();
    }

    getMainAxis (vec) {
        return LayoutAlignment.#getSize(this.isColumn, vec);
    }
    getCrossAxis (vec) {
        return LayoutAlignment.#getSize(!this.isColumn, vec);
    }

    get isLayoutAlignment () { return true }
    get main () { return this.#main }
    get cross () { return this.#cross }
    get mainSign () { return LayoutAlignment.#getSign(this.isColumn); }
    get crossSign () { return LayoutAlignment.#getSign(!this.isColumn); }
    get isColumn () { return this.#isColumn }
    set isColumn (bool) {
        const prev = this.#isColumn;
        this.#isColumn = !!bool;
        if (prev !== this.#isColumn) this.#swapAxes();
        return this.#isColumn;
    }
}

export class ItemLayout extends MenuItem {
    #bbox = new BoundingBox();
    #items = new Array();
    #padding = new LayoutSpacing();
    #position = new Vector();
    #size = {
        content: new Vector(),
        box: new Vector()
    };
    #contentFlow = {
        mainOffset: 0,
        alignMethod: () => 0
    };
    #gap = 0;
    #isColumn = false;
    #ignoreHidden = false; // make space for hidden items
    #axis;
    constructor () {
        super();
        this.#axis = new LayoutAlignment(this.isColumn, () => this.isColumn = !!this.isColumn);
        this.padding.onupdate = () => this.updateLayout();
        this.axis.main.onupdate = () => {
            this.#updateMainAlignment();
            this.#updateItemPositions();
        }
        this.axis.cross.onupdate = () => {
            this.#updateCrossAlignment();
            this.#updateItemPositions();
        }
    }

    // [!] trying to shave down code redundancy at the cost of bloating performance
    //      rewrite this first if engine performance suffers - KT
    #updateItemPositions () {
        if (!this.#items.length) return;
        const { gap } = this;
        const getAlignment = this.#contentFlow.alignMethod;
        let mainAxis = this.#mainOrigin - this.#contentFlow.mainOffset;
        const applyPosition = this.isColumn
            ? (item) => {
                item.setPosition(getAlignment(item), mainAxis);
                mainAxis -= getContentHeight(item) + gap;
            } : (item) => {
                item.setPosition(mainAxis, getAlignment(item));
                mainAxis += getContentWidth(item) + gap;
            };
        for (let i = 0; i < this.#items.length; i++) {
            if (this.ignoreHidden && this.#items[i]?.hide) continue;
            applyPosition(this.#items[i]);
        }
    }
    #updateSize () {
        let x = 0;
        let y = 0;
        if (this.#items.length) {
            let itemCount = 0;
            const collectX = this.isColumn
                ? (item) => { const width = getContentWidth(item); if (width > x) x = width; if (width > 0) itemCount++; }
                : (item) => x += getContentWidth(item)
            const collectY = this.isColumn
                ? (item) => y += getContentHeight(item)
                : (item) => { const height = getContentHeight(item); if (height > y) y = height; if (height > 0) itemCount++; }
            for (let i = 0; i < this.#items.length; i++) {
                const item = this.#items[i];
                if (this.ignoreHidden && item?.hide) continue;
                collectX(item);
                collectY(item);
            }
            const { horizontal, vertical } = this.padding;
            const gaps = Math.max(0, itemCount - 1) * this.gap;
            x += horizontal;
            y += vertical;
            if (this.isColumn) y += gaps;
            else x += gaps;
        }
        this.#size.content.apply(x, y);
        this.#size.box.apply(Math.max(x, this.minWidth), Math.max(y, this.minHeight));
    }
    #updateMainAlignment () {
        const excess = this.axis.getMainAxis(this.#size.box) - this.axis.getMainAxis(this.#size.content);
        if (this.axis.main.align === ALIGNMENT.CENTER) {
            this.#contentFlow.mainOffset = excess / 2;
        } else if (this.axis.main.align === ALIGNMENT.END) {
            this.#contentFlow.mainOffset = excess;
        } else { // align start
            this.#contentFlow.mainOffset = 0;
        }
    }
    // [!] trying to shave down code redundancy at the cost of bloating performance
    //      rewrite this first if engine performance suffers - KT
    #updateCrossAlignment () {
        const origin = this.#crossOrigin;
        const max = this.axis.getCrossAxis(this.#size.box);
        const sign = this.axis.crossSign;
        const getLength = this.isColumn
            ? (item) => getContentWidth(item) * sign
            : (item) => getContentHeight(item) * sign;
        if (this.axis.cross.align === ALIGNMENT.START) {
            this.#contentFlow.alignMethod = (item) => origin;
        } else if (this.axis.cross.align === ALIGNMENT.END) {
            const offset = this.isColumn
                ? (origin + max) - this.padding.horizontal
                : (origin - max) + this.padding.vertical;
            this.#contentFlow.alignMethod = (item) => offset + getLength(item);
        } else { // align center
            const pad = this.isColumn
                ? this.padding.horizontal
                : this.padding.vertical;
            const offset = origin - (sign * (max - pad) / 2);
            this.#contentFlow.alignMethod = (item) => offset + (getLength(item) / 2);
        }
    }
    #updateBoundingBox () {
        const { min, max } = this.#bbox;
        min.apply(this.#position.x, this.#position.y - this.#size.box.y);
        max.apply(this.#position.x + this.#size.box.x, this.#position.y);
    }
    #reflowLayout () {
        this.#updateSize();
        this.#updateBoundingBox();
        this.#updateMainAlignment();
        this.#updateCrossAlignment();
        this.#updateItemPositions();
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
        this.#reflowLayout();
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
    get #mainOrigin () { return this.isColumn ? this.#originY : this.#originX }
    get #crossOrigin () { return this.isColumn ? this.#originX : this.#originY }
    get children () { return this.#items.values() }
    get length () { return this.#items.length }
    get padding () { return this.#padding }
    get width () { return this.#size.box.x }
    get height () { return this.#size.box.y }
    get contentWidth () { return this.#size.content.x }
    get contentHeight () { return this.#size.content.y }
    get size () { return this.#size.box.clone() }
    get axis () { return this.#axis }
    get isColumn () { return this.#isColumn }
    set isColumn (bool) {
        const prev = this.isColumn;
        this.#isColumn = bool;
        if (bool !== this.axis.isColumn) this.axis.isColumn = bool;
        if (bool != prev) this.updateLayout();
        return bool;
    }
    get gap () { return this.#gap }
    set gap (num) {
        const prev = this.#gap;
        this.#gap = num;
        if (prev !== num) this.updateLayout();
        return num;
    }
    get ignoreHidden () { return this.#ignoreHidden }
    set ignoreHidden (bool) {
        const prev = this.#ignoreHidden;
        this.#ignoreHidden = !!bool;
        if (prev !== this.#ignoreHidden) this.updateLayout();
        return this.#ignoreHidden;
    }
    get minWidth () { return super.minWidth }
    set minWidth (num) {
        super.minWidth = num;
        if (this.minWidth > this.width) this.#reflowLayout();
        return num;
    }
    get minHeight () { return super.minHeight }
    set minHeight (num) {
        super.minWidth = num;
        if (this.minHeight > this.height) this.#reflowLayout();
        return num;
    }
}
