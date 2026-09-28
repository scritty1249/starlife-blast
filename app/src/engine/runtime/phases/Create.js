import {
    Phase,
    ItemLayout,
    Slider,
    ShapeButton,
    Circle,
    Color,
    Label,
    HexaButton
} from "../../core/Core.js";
import { drawMenuItemRulers } from "../debug/draw.js";
import { MapButton } from "../selections/MapButton.js";

export class Create extends Phase {
    constructor (mainController, maps) {
        super(mainController);
        this.#init(maps);
        this.#load()
            .then(() => this.onResize())
            .then(() => this.resolveLoad())
            .catch((err) => this.rejectLoad(err));
    }

    #init (maps) {
        this.store.maps = maps; // [!] currently stores raw object from internet. Need to parse into a dedicated class! -KT
        this.Plane.max.apply(1000, 1000);
        this.Camera.Viewbox.bounding.left = this.Camera.Viewbox.bounding.right = false;
    }
    async #load () {
        await this.#loadMapThumbnails();
        this.#setupInterface();
    }
    #setupInterface () {
        const buttons = new ItemLayout();
        buttons.isColumn = true;
        buttons.gap = 15;
        buttons.padding.apply(10);
        const mapButtons = new ItemLayout();
        mapButtons.gap = 10;
        mapButtons.isColumn = false;
        this.Interface.insert()
            .push(buttons)
            .fixed = true;
        this.store.buttons = buttons;
        this.store.mapButtons = mapButtons;
        this.store.styling = {
            dotColor: new Color(0, 0, 0, 1),
            dotRadius: 12,
            barColor: new Color(255, 255, 255, 1),
            barWidth: 250,
            barHeight: 8,
            barCornerRadius: 4,
            rowGap: 5
        };
        // [!] minimums on init
        this.store.values = {
            teamCount: 2,
            teamSize: 1,
            map: undefined
        };
        this.#setupMapOptions();
        this.#setupTeamCountSlider();
        this.#setupTeamSizeSlider();
        this.#setupSubmitButton();
    }
    async #loadMapThumbnails () {
        const { AssetType } = this.Global.constructor;
        const { maps } = this.store;
        await Promise.all(maps.map(({id, thumb}) =>
            this.AssetPool.add(id, [AssetType.Image, undefined, thumb])));
    }
    #setupMapOptions () {
        const { mapButtons, maps } = this.store;
        for (const map of maps) {
            const button = this.#createMapOption(map);
            mapButtons.push(button);
        }
        this.store.buttons.push(mapButtons);
    }
    #createMapOption (map) {
        const { name, id } = map;
        const thumbnail = this.AssetPool.get(id).clone(false);
        const button = new MapButton(name, thumbnail, 60);
        const bbox = button.shape.getBoundingBox();
        const { FONT_SIZE } = this.Global.store;
        const { fontColor, strokeColor, fillColor, state } = button;
        button.fontSize = FONT_SIZE;
        state.closed.font.apply(fontColor.apply(255, 255, 255, 1));
        state.closed.fill.apply(fillColor.apply(0, 0, 0, 0.7));
        state.closed.stroke.apply(strokeColor.apply(255, 255, 255, 1));
        state.open.font.apply(state.closed.font);
        state.open.font.a = 0.25;
        state.open.fill.apply(state.closed.fill);
        state.open.fill.a = 0.2;
        state.open.stroke.apply(state.closed.stroke);
        state.open.offset.apply(0, -(1.2/3) * bbox.height);
        state.active.font.apply(state.active.stroke.apply(255, 0, 0, 1));
        state.active.fill.apply(state.open.fill);
        state.active.fill.a = 0.4;
        state.open.width = state.active.width = 100;

        // adding listeners
        button.onclick = () => {
            if (button.isOpen) {
                this.#closeMapButtons();
                button.active();
                this.store.values.map = map;
            } else if (!button.isActive) {
                button.open();
            }
        }
        return button;
    }
    #setupTeamCountSlider () {
        const { DEFAULT_FONT, FONT_SIZE } = this.Global.store;
        const { styling } = this.store;
        const label = new Label("Teams", FONT_SIZE * 2, undefined, DEFAULT_FONT.family, this.Global.Display.cursor);
        const row = new ItemLayout();
        const slider = new Slider(new ShapeButton(new Circle(styling.dotRadius), styling.dotColor), 4, this.store.values.teamCount);
        const value = new Label(slider.value, FONT_SIZE * 1.5, undefined, DEFAULT_FONT.family, this.Global.Display.cursor);
        slider.dotOffset.apply(slider.dot.width / 2, slider.dot.height / 2);
        slider.barColor.apply(styling.barColor);
        slider.barWidth = styling.barWidth;
        slider.barHeight = styling.barHeight;
        slider.barCornerRadius = styling.barCornerRadius;
        slider.onchange = () => value.text = this.store.values.teamCount = slider.value;
        row.gap = styling.rowGap;
        row.isColumn = false;
        row.push(slider, value);
        this.store.buttons.push(label, row);
    }
    #setupTeamSizeSlider () {
        const { DEFAULT_FONT, FONT_SIZE } = this.Global.store;
        const { styling } = this.store;
        const label = new Label("Team Size", FONT_SIZE * 2, undefined, DEFAULT_FONT.family, this.Global.Display.cursor);
        const row = new ItemLayout();
        const slider = new Slider(new ShapeButton(new Circle(styling.dotRadius), styling.dotColor), 5, this.store.values.teamSize);
        const value = new Label(slider.value, FONT_SIZE * 1.5, undefined, DEFAULT_FONT.family, this.Global.Display.cursor);
        slider.dotOffset.apply(slider.dot.width / 2, slider.dot.height / 2);
        slider.barColor.apply(styling.barColor);
        slider.barWidth = styling.barWidth;
        slider.barHeight = styling.barHeight;
        slider.barCornerRadius = styling.barCornerRadius;
        slider.onchange = () => value.text = this.store.values.teamSize = slider.value;
        row.gap = styling.rowGap;
        row.isColumn = false;
        row.push(slider, value);
        this.store.buttons.push(label, row);
    }
    #setupSubmitButton () {
        const { DEFAULT_FONT, FONT_SIZE } = this.Global.store;
        const { styling } = this.store;
        const button = new HexaButton(styling.dotRadius * 2, styling.barWidth * (1/4));
        const { width, height } = button.getBoundingBox();
        button.fontSize = FONT_SIZE;
        button.fontFamily = DEFAULT_FONT.family;
        button.originOffset.apply(-width / 2, height / 2);
        button.fillColor.apply(255, 255, 255, 1);
        button.fontColor.apply(0, 0, 0, 1);
        button.text = "Submit";
        button.onclick = () => this.#onsubmit();
        this.store.buttons.push(button);
    }
    #drawDebugOverlay () {
        const { cursor } = this.Global.Display;
        drawMenuItemRulers(cursor, this.store.buttons, true, true);
    }
    #closeMapButtons () {
        for (const button of this.store.mapButtons.children)
            button.close();
    }
    #onsubmit () {
        const { teamCount, teamSize, map } = this.store.values;
        if (teamCount >= 2 && teamSize >= 1 && map)
            this.Events.raiseEvent("SELECTED", { teamCount, teamSize, map });
    }

    onanimate () {
        const { cursor } = this.Global.Display;
        this.Interface.draw(cursor);
        if (this.Global.flags.DEBUG) this.#drawDebugOverlay();
    }
    onResize () {
        const { center } = this.Global.Display;
        const { buttons } = this.store;
        buttons.setPosition(center.x - (buttons.width / 2), center.y + (buttons.height / 2));
    }
    async ontick (delta) {
        let isAnimating = false;
        for (const button of this.store.mapButtons.children) {
            button.tick();
            isAnimating = isAnimating || button.isAnimating;
        }
        if (isAnimating) this.store.buttons.updateLayout();
    }
}
