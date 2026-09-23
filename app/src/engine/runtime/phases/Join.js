import {
    Phase,
    ItemLayout,
    Equigon,
    HexaButton
} from "../../core/Core.js";
import { AvatarTileIcon } from "../selections/AvatarTileIcon.js";
import { initLobby } from "../utils.js";
import { drawMenuItemRulers } from "../debug/draw.js";

export class Join extends Phase {
    #ClientPlayerID;
    #Lobby;
    #isClientHost;
    constructor (mainController, playerID, lobbyData, isHost = false) {
        super(mainController);
        this.#ClientPlayerID = playerID;
        this.#isClientHost = isHost;
        this.#Lobby = initLobby(lobbyData);
        this.#init();
        this.#load()
            .then(() => this.onResize())
            .then(() => this.resolveLoad())
            .catch((err) => this.rejectLoad(err));
    }

    #init () {
        this.Plane.max.apply(1000, 1000);
    }
    async #load () {
        await this.#loadLobby();
        this.#setupInterface();
    }
    async #loadLobby () {
        await this.Lobby.loadAvatarAssets(this.AssetPool, this.Global.constructor.AssetType.Image);
    }
    #setupInterface () {
        const { isClientInLobby } = this;
        this.store.avatarTileClipShape = new Equigon(6, 64);
        this.store.iconLayouts = [];
        this.store.joinButtons = [];
        this.store.startButton = this.#createStartButton();
        const layout = new ItemLayout();
        layout.isColumn = true;
        this.store.teamLayouts = new ItemLayout();
        this.store.teamLayouts.gap = 20;
        for (const [ teamid, team ] of Object.entries(this.Lobby.Teams)) {
            const teamLayout = new ItemLayout();
            const iconLayout = new ItemLayout();
            teamLayout.gap = 5;
            iconLayout.gap = 10;
            for (const player of team) {
                const { avatar: key } = player.data.profile;
                const avatar = this.#createPlayerIcon(key);
                iconLayout.push(avatar);
            }
            teamLayout.push(iconLayout);
            if (team.length < this.Lobby.teamsize) {
                const joinButton = this.#createJoinButton(teamid);
                joinButton.hide = isClientInLobby;
                teamLayout.push(joinButton);
                this.store.joinButtons.push(joinButton);
            }
            this.store.iconLayouts.push(iconLayout);
            this.store.teamLayouts.push(teamLayout);
        }
        layout.push(this.store.teamLayouts);
        layout.push(this.store.startButton);
        this.Interface.insert()
            .push(layout)
            .fixed = true;
        if (isClientInLobby) {
            this.setJoinButtonVisibility(false);
            // [!] TODO: add leave button
        }
        this.store.lobbyElements = layout;
    }
    #createPlayerIcon (avatarKey) {
        const image = this.AssetPool.get(avatarKey).clone(false);
        const shape = this.store.avatarTileClipShape;
        image.width = shape.length * 2;
        return new AvatarTileIcon(image, shape);
    }
    #createJoinButton (teamid) {
        const { DEFAULT_FONT, FONT_SIZE } = this.Global.store;
        const button = new HexaButton(20, 60);
        const { width, height } = button.getBoundingBox();
        button.fontSize = FONT_SIZE;
        button.fontFamily = DEFAULT_FONT.family;
        button.originOffset.apply(-width / 2, height / 2);
        button.fillColor.apply(255, 255, 255, 1);
        button.fontColor.apply(0, 0, 0, 1);
        button.text = "Join";
        button.onclick = () => {
            this.setJoinButtonVisibility(false);
            this.#onjoin(teamid);
        }
        return button;
    }
    #createStartButton () {
        const { DEFAULT_FONT, FONT_SIZE } = this.Global.store;
        const button = new HexaButton(20, 60);
        const { width, height } = button.getBoundingBox();
        button.fontSize = FONT_SIZE;
        button.fontFamily = DEFAULT_FONT.family;
        button.originOffset.apply(-width / 2, height / 2);
        button.fillColor.apply(255, 255, 255, 1);
        button.fontColor.apply(0, 0, 0, 1);
        button.text = "Start";
        button.onclick = () => {
            this.setStartButtonVisibility(false);
            this.#onstart();
        }
        button.hide = !this.isClientHost;
        return button;
    }
    #onjoin (teamid) {
        if (this.isClientInLobby) {
            console.info("Cannot join lobby. Already a participant");
        } else {
            this.Events.raiseEvent("JOIN", { team: teamid });
        }
    }
    #onstart () {
        if (this.isClientHost) {
            this.Events.raiseEvent("START");
        } else {
            console.info("Cannot start lobby. Client user is not lobby host");
        }
    }
    #drawDebugOverlay () {
        const { cursor } = this.Global.Display;
        drawMenuItemRulers(cursor, this.store.lobbyElements, true, true);
    }

    onanimate () {
        const { cursor } = this.Global.Display;
        this.Interface.draw(cursor);
        if (this.Global.flags.DEBUG) this.#drawDebugOverlay();
    }
    onResize () {
        const { isPortrait, center } = this.Global.Display;
        const { lobbyElements, iconLayouts, teamLayouts } = this.store;
        const { bounding } = this.Camera.Viewbox;
        teamLayouts.isColumn = isPortrait;
        for (const iconLayout of iconLayouts) {
            iconLayout.isColumn = !isPortrait;
        }
        lobbyElements.setPosition(center.x - (lobbyElements.width / 2), center.y + (lobbyElements.height / 2));
        bounding.left = bounding.right = !isPortrait;
        bounding.top = bounding.bottom = isPortrait;
    }
    setJoinButtonVisibility (visible) {
        const hide = !visible;
        for (const button of this.store.joinButtons)
            button.hide = hide;
    }
    setStartButtonVisibility (visible) {
        this.store.startButton.hide = !visible;
    }

    get Lobby () { return this.#Lobby }
    get ClientPlayerID () { return this.#ClientPlayerID }
    get isClientInLobby () { return this.Lobby.Players.has(this.ClientPlayerID) }
    get isClientHost () { return this.#isClientHost }
}