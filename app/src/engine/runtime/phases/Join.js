import {
    Phase,
    ItemLayout,
    Equigon,
    HexaButton,
    ALIGNMENT
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
        this.store.LobbyCache = {
            Teams: new Map()
        };
        this.flags.REQUEST_LOCK = false;
    }
    async #load () {
        await this.#loadLobby();
        this.#setupInterface();
    }
    async #loadLobby () {
        await this.Lobby.loadAvatarAssets(this.AssetPool, this.Global.constructor.AssetType.Image);
    }
    #setupInterface () {
        this.store.avatarTileClipShape = new Equigon(6, 64);
        this.store.teamElements = new Map();
        this.store.startButton = this.#createStartButton();
        this.store.leaveButton = this.#createLeaveButton();
        const layout = new ItemLayout();
        layout.isColumn = true;
        layout.ignoreHidden = true;
        this.store.teamLayouts = new ItemLayout();
        this.store.teamLayouts.axis.cross.align = ALIGNMENT.START;
        this.store.teamLayouts.gap = 20;
        for (const [ teamid, team ] of Object.entries(this.Lobby.Teams)) {
            const teamPlayers = new Map();
            const teamLayout = new ItemLayout();
            const iconLayout = new ItemLayout();
            teamLayout.ignoreHidden = true;
            teamLayout.gap = 5;
            iconLayout.gap = 10;
            for (const player of team) {
                const { userid, avatar: key } = player.data.profile;
                const avatar = this.#createPlayerIcon(key);
                avatar.userid = userid;
                iconLayout.push(avatar);
                teamPlayers.set(userid, key);
            }
            const joinButton = this.#createJoinButton(teamid);
            joinButton.hide = team.length >= this.Lobby.teamsize || teamPlayers.has(this.ClientPlayerID);
            teamLayout.push(iconLayout);
            teamLayout.push(joinButton);
            this.store.LobbyCache.Teams.set(teamid, teamPlayers);
            this.store.teamLayouts.push(teamLayout);
            this.store.teamElements.set(teamid, {
                avatars: iconLayout,
                join: joinButton
            });
        }
        layout.push(this.store.teamLayouts);
        layout.push(this.store.startButton);
        layout.push(this.store.leaveButton);
        this.Interface.insert()
            .push(layout)
            .fixed = true;
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
        const button = new HexaButton(64);
        const { width, height } = button.getBoundingBox();
        button.fontSize = FONT_SIZE;
        button.fontFamily = DEFAULT_FONT.family;
        button.originOffset.apply(-width / 2, height / 2);
        button.fillColor.apply(255, 255, 255, 1);
        button.fontColor.apply(0, 0, 0, 1);
        button.text = "Join";
        button.userData.lock = false;
        button.onclick = () => {
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
            this.#onstart();
        }
        button.hide = !this.isClientHost;
        return button;
    }
    #createLeaveButton () {
        const { DEFAULT_FONT, FONT_SIZE } = this.Global.store;
        const button = new HexaButton(20, 60);
        const { width, height } = button.getBoundingBox();
        button.fontSize = FONT_SIZE;
        button.fontFamily = DEFAULT_FONT.family;
        button.originOffset.apply(-width / 2, height / 2);
        button.fillColor.apply(200, 0, 0, 1);
        button.fontColor.apply(0, 0, 0, 1);
        button.text = "Leave Lobby";
        button.onclick = () => {
            this.#onleave();
        }
        button.hide = this.isClientHost;
        return button;
    }
    async #onjoin (teamid) {
        const event = this.getPlayerTeam(this.ClientPlayerID) === undefined ? "JOIN" : "DEFECT";
        this.Events.raiseEvent(event, { team: teamid });
    }
    async #onleave () {
        if (this.isClientHost) {
            console.warn("Cannot leave lobby. Client user is lobby host");
        } else if (!this.isClientInLobby) {
            console.warn("Cannot leave lobby. Client user is not in lobby");
        } else {
            this.Events.raiseEvent("LEAVE");
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
    // only removes from cache
    #removePlayerFromTeam (userid) {
        for (const players of this.store.LobbyCache.Teams.values()) {
            if (players.has(userid)) {
                players.delete(userid);
                return true;
            }
        }
        return false;
    }
    #isPlayerInLobbyCache (userid) {
        return this.store.LobbyCache.Teams.values().some((t) => t.has(userid));
    }
    async #computeLayoutBounds () {
        await this.store.lobbyElements.computeBounds(this.Global.Display.cursor);
    }

    // checks and sets
    setRequestLock () {
        const prev = this.flags.REQUEST_LOCK;
        this.flags.REQUEST_LOCK = true;
        return prev;
    }
    releaseRequestLock () {
        this.flags.REQUEST_LOCK = false;
    }
    isPlayerInLobby (userid, cache = true) {
        return cache
            ? this.#isPlayerInLobbyCache(userid)
            : this.Lobby.Players.has(userid);
    }
    getPlayerAvatar (userid) {
        for (const players of this.store.LobbyCache.Teams.values()) {
            if (players.has(userid))
                return players.get(userid);
        }
        return undefined;
    }
    getPlayerTeam (userid) {
        for (const [teamid, players] of this.store.LobbyCache.Teams) {
            if (players.has(userid)) {
                players.delete(userid);
                return teamid;
            }
        }
        return undefined;
    }
    onanimate () {
        const { cursor } = this.Global.Display;
        this.Interface.draw(cursor);
        if (this.Global.flags.DEBUG) this.#drawDebugOverlay();
    }
    onResize () {
        const { isPortrait, center } = this.Global.Display;
        const { lobbyElements, teamElements, teamLayouts } = this.store;
        const { bounding } = this.Camera.Viewbox;
        const notPortrait = !isPortrait;
        teamLayouts.isColumn = isPortrait;
        for (const teamLayout of teamLayouts.children)
            teamLayout.isColumn = notPortrait;
        for (const iconLayout of teamElements.values().map(({avatars}) => avatars))
            iconLayout.isColumn = notPortrait;
        lobbyElements.setPosition(center.x - (lobbyElements.width / 2), center.y + (lobbyElements.height / 2));
        bounding.left = bounding.right = notPortrait;
        bounding.top = bounding.bottom = isPortrait;
    }
    async computeLayout () {
        for (const [teamid, { avatars: icons, join: joinButton }] of this.store.teamElements) {
            const players = this.store.LobbyCache.Teams.get(teamid);
            const userids = Array.from(players.keys());
            joinButton.hide = players.size >= this.Lobby.teamsize || players.has(this.ClientPlayerID);
            if (players.size !== icons.length || !icons.every(({userid}, i) => userids[i] && userids[i] === userid)) {
                icons.clear();
                for (const [userid, avatarKey] of players) {
                    const avatar = this.#createPlayerIcon(avatarKey);
                    avatar.userid = userid;
                    icons.push(avatar);
                }
            }
        }
        await this.#computeLayoutBounds();
    }
    setJoinButtonVisibility (visible, triggerReflow = true) {
        const hide = !visible;
        for (const [teamid, { avatars, join: button }] of this.store.teamElements)
            if (hide) button.hide = true;
            else button.hide = this.store.LobbyCache.Teams.get(teamid).has(this.ClientPlayerID)
                || avatars.length >= this.Lobby.teamsize;
        if (triggerReflow) this.#computeLayoutBounds();
    }
    setStartButtonVisibility (visible, triggerReflow = true) {
        this.store.startButton.hide = !visible;
        if (triggerReflow) this.#computeLayoutBounds();
    }
    setLeaveButtonVisibility (visible, triggerReflow = true) {
        this.store.leaveButton.hide = !visible;
        if (triggerReflow) this.#computeLayoutBounds();
    }
    async addNewPlayer (userid, avatar, team) {
        if (this.store.LobbyCache.Teams.has(team)) {
            if (!this.AssetPool.has(avatar)) {
                this.AssetPool.add(avatar, [this.Global.constructor.AssetType.Image, undefined, avatar]);
                await this.AssetPool.onready(avatar);
            }
            if (this.#isPlayerInLobbyCache(userid))
                this.#removePlayerFromTeam(userid);
            this.store.LobbyCache.Teams.get(team).set(userid, avatar);
            await this.computeLayout();
            return true;
        } else {
            return false;
        }
    }
    async removePlayer (userid) {
        if (this.#isPlayerInLobbyCache(userid))
            this.#removePlayerFromTeam(userid);
        await this.computeLayout();
    }

    get Lobby () { return this.#Lobby }
    get ClientPlayerID () { return this.#ClientPlayerID }
    get isClientInLobby () { return this.isPlayerInLobby(this.ClientPlayerID, true) }
    get isClientHost () { return this.#isClientHost }
}