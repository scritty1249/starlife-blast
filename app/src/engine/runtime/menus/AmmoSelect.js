import { Menu, Vector, zip, clamp } from "../../core/Core.js";
import { AmmoTypeButton } from "../selections/AmmoTypeButton.js";
import { AmmoTypeDetails } from "../utils/AmmoTypeDetails.js";

export class AmmoSelect extends Menu {
    static MIN_BUTTON_SIZE = 75;
    static MAX_BUTTON_SIZE = 300;
    static BUTTON_SPACING_SCALE = -0.1;
    static FOCAL_LERP_FACTOR = 0.15; // speed that focal point moves from different points onscreen
    static FOCAL_SNAP_THRESHOLD = 10**2; // (squared) distance in pixels that focal point will snap to target position
    static BUTTON_TEXT_PADDING_SCALE = new Vector(.2, .4); // percentage of button text size to treat as extra padding
    constructor (phase, ammoTypes) {
        super(phase);
        try {
            this.#init(ammoTypes);
            this.resolveLoad();
        } catch (error) {
            this.rejectLoad(error);
        }
    }

    #init (ammoTypes) {
        const position = this.Parent.Global.Display.center;
        this.store.selections = ammoTypes;
        this.store.pointerRecord = {
            lastDrawn: position.clone(),
            lastActive: position.clone()
        };
        this.store.layout = {};
        this.flags.followPointer = false;
        this.flags.trackActive = false;
        this.flags.focalUpdated = false;
        this.flags.snapToFocal = false;

        this.store.underButton.onclick = () => this.close(undefined, true);
        this.InterfaceLayers.buttons = this.Interface.insert();
        this.InterfaceLayers.buttons.fixed = true;

        this.updateLayout();
        this.#resetButtonPositions();
    }
    #resetButtonPositions () {
        if (!this.InterfaceLayers.buttons.size) return;
        const { spacing, count, center } = this.store.layout;
        const coords = [];
        for (let q = -count; q <= count; q++) {
            const rMin = Math.max(-count, -q - count);
            const rMax = Math.min(count, -q + count);
            for (let r = rMin; r <= rMax; r++) {
                const s = -q - r;
                const distance = Math.max(Math.abs(q), Math.abs(r), Math.abs(s));
                coords.push({ q, r, distance });
            }
        }
        // sort to arrange shapes to sprial from inside-out
        coords.sort((a, b) => {
            if (a.distance !== b.distance) return a.distance - b.distance;
            return a.q - b.q || a.r - b.r;
        });
        for (const [ {q, r}, {shape} ] of zip([coords, this.InterfaceLayers.buttons.items])) {
            shape.moveTo(center);
            shape.transform.offset.apply(spacing.x * (q + r / 2), spacing.y * r);
            shape.applyTransform();
        }
    }
    #createButtons (legLength) {
        const { selections } = this.store;
        const { buttons } = this.InterfaceLayers;
        const { BUTTON_TEXT_PADDING_SCALE } = this.constructor;
        const { FONT_SIZE } = this.Parent.Global.store;
        buttons.clear();
        if (selections.length) {
            for (let i = 0; i < this.store.layout.count; i++) {
                const selection = selections[i % selections.length];
                const button = new AmmoTypeButton(selection, legLength);
                button.fontSize = FONT_SIZE;
                button.computeTextSizing(this.Parent.Global.Display.cursor);
                button.textPadding.apply(
                    button.textSizing.width * BUTTON_TEXT_PADDING_SCALE.x,
                    button.textSizing.height * BUTTON_TEXT_PADDING_SCALE.y
                );
                button.onclick = () => {
                    this.close({selection});
                };
                buttons.push(button);
            }
        }
    }
    // computes delta from last drawn position to last active position
    #getPointerDelta () {
        const { lastDrawn, lastActive } = this.store. pointerRecord;
        return this.flags.INVERT_TRACKING
            ? lastDrawn.sub(lastActive)
            : lastActive.sub(lastDrawn);
    }
    #updateFocalPoint () {
        const { FOCAL_LERP_FACTOR, FOCAL_SNAP_THRESHOLD } = this.constructor;
        const { focal } = this.store.layout;
        const { pointer } = this.Parent.Global.Input;
        const target = this.flags.followPointer
            ? pointer.position
            : this.Parent.Global.Display.center;
        const previous = focal.clone();
        if (this.flags.snapToFocal)
            focal.apply(target);
        else {
            focal.lerp(target, FOCAL_LERP_FACTOR, true);
            this.flags.snapToFocal = this.flags.snapToFocal
                || target.sub(focal).dot() < FOCAL_SNAP_THRESHOLD;
        }
        this.flags.focalUpdated = !previous.eq(focal)
            || (!this.flags.followPointer && pointer.delta.lengthSquared);
    }

    onResize () {
        if (!super.onResize()) return false;
        this.reset(true);
        return true;
    }
    animate () {
        const { cursor } = this.Display;
        const { lastDrawn, lastActive } = this.store.pointerRecord;
        if (this.flags.focalUpdated)
            this.updateButtons();
        if (!lastDrawn.eq(lastActive))
            lastDrawn.apply(lastActive);
        this.Interface.draw(cursor);
        this.draw(true);
        this.#updateFocalPoint();
    }
    async tick (delta) {
        this.handleInput();
        const { isHovering, isActive, isTouch, isDragging, delta: dt } = this.Parent.Global.Input.pointer;
        const followPointer = isHovering || (isActive && !isTouch && (!isDragging || !dt.lengthSquared));
        this.setFocalTarget(followPointer);
        this.#updateFocalPoint();
    }
    handleInput () {
        const { lastDrawn, lastActive } = this.store.pointerRecord;
        const { pointer } = this.Parent.Global.Input;
        if (pointer.isActive) {
            if (this.flags.trackActive) {
                lastActive.apply(pointer.position);
                return;
            } else {
                this.flags.trackActive = true;
                lastDrawn.apply(lastActive.apply(pointer.position));
            }
        } else this.flags.trackActive = false;
    }
    reset (resetPositions = true) {
        const { lastDrawn, lastActive } = this.store.pointerRecord;
        this.flags.followPointer = false;
        this.flags.trackActive = false;
        this.flags.focalUpdated = false;
        this.flags.snapToFocal = false;
        lastDrawn.apply(this.Parent.Global.Display.center);
        lastActive.apply(lastDrawn);
        if (resetPositions) {
            this.updateLayout();
            this.#resetButtonPositions();
        } else {
            this.updateButtons();
        }
    }
    setFocalTarget (followPointer) {
        this.flags.snapToFocal = followPointer === this.flags.followPointer && this.flags.snapToFocal
        this.flags.followPointer = followPointer;
    }
    updateLayout () {
        const { MIN_BUTTON_SIZE, MAX_BUTTON_SIZE, BUTTON_SPACING_SCALE } = this.constructor;
        const { layout } = this.store;
        const buttonWidth = clamp(this.Parent.Global.Display.size.x / 2, MIN_BUTTON_SIZE, MAX_BUTTON_SIZE);
        const legLength = buttonWidth / Math.sqrt(3);
        const padding = buttonWidth * BUTTON_SPACING_SCALE;

        let layers = 1;
        while (3 * layers * layers - 3 * layers + 1 < this.store.selections.length)
            layers++;
        layout.rings = Math.max(5, --layers);
        const triple = 3 * layers;
        layout.count = Math.max(37, (triple * triple) - triple + 1);
        this.#createButtons(legLength);
        layout.center = this.Parent.Global.Display.center;
        layout.focal = layout.center.clone();
        if (!this.InterfaceLayers.buttons.size) return;
        const { shape } = this.InterfaceLayers.buttons.items[0];
        layout.buttonSize = shape.globalTransform.scale.clone();
        layout.buttonSize.x *= Math.sqrt(3) * shape.length;
        layout.buttonSize.y *= 1.5 * shape.length;
        layout.spacing = layout.buttonSize.clone();
        layout.spacing.x += padding;
        layout.spacing.y += padding;

        const totalSpace = layout.spacing.mul(layout.rings * 2 - 1);
        const halfSpace = totalSpace.div(2);
        const rowSkew = layout.rings * (layout.spacing.x / 2);
        const maxDistance = this.Parent.Global.Display.size.min();
        for (const button of this.InterfaceLayers.buttons.items) {
            button.setLayout(totalSpace, halfSpace, rowSkew, maxDistance);
        }
    }
    updateButtons () {
        const buttons = this.InterfaceLayers.buttons.items;
        if (!buttons.length) return;
        const delta = this.#getPointerDelta();
        const { focal, center } = this.store.layout;
        for (let i = 0; i < buttons.length; i++) {
            const button = buttons[i];
            button.updateOffset(delta, center, focal);
        }
    }
    open () {
        if (!super.open()) return false;
        this.reset(false);
        return true;
    }
    close (returnData = undefined, haltAudio = true) {
        if (!super.close(returnData, haltAudio)) return;
        if (returnData?.selection?.isAmmoTypeDetails)
            // don't need to update buttons, will be called on next open
            this.#resetButtonPositions();
        return true;
    }
}
