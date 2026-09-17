import {
    AnimationList,
    Animation,
    ShapeAnimation,
    Color,
    equals,
    Terrain,
    drawBlastAnimation,
    IconButton,
    Phase,
    ScreenButton,
    KeyMap,
    typeString,
    BlastImpact,
    ToggleIconButton,
    Icon,
    Random,
    Polygon,
    AmmoMap
} from "../../core/Core.js"

import { WorkerPool, PoolManager, TerrainCache, CanvasCache } from "../../workers/Core.js";
import { AmmoSelect } from "../menus/AmmoSelect.js";
import { AmmoTypeDetails } from "../utils/AmmoTypeDetails.js";
import { TurnRecorder } from "../utils/TurnRecorder.js";
import { HitpointMap } from "../../hitpoints/Core.js";
import { initLobby, WEB_WORKER_PATH } from "../utils.js";
import { AmmoPool } from "../../shared/AmmoPool.js";

import { drawCircle, drawLine, drawMarker, drawText, generateBitmapDownloadURL } from "../debug/draw.js"; // [!] all for debug overlay

const INPUT_MAP = new KeyMap({
    "esc": ["Escape"],
    "mv+": ["KeyW"],
    "mv-": ["KeyS"],
    "pan+": ["KeyD"],
    "pan-": ["KeyA"],
    "aim-": ["ArrowRight"], // counterclockwise
    "aim+": ["ArrowLeft"], // clockwise
    "shot+": ["ArrowUp"], // increment shot power
    "shot-": ["ArrowDown"], // deincrement shot power
    "shootActive": ["Space"],
    "shot1": ["Digit1"],
    "shot2": ["Digit2"],
    "shot3": ["Digit3"],
    "shot4": ["Digit4"],
    "shot5": ["Digit5"],
    "shot6": ["Digit6"],
    "shot7": ["Digit7"],
    "shot8": ["Digit8"],
    "shot9": ["Digit9"],
    "shot10": ["Digit0"],
    "debug+": ["ShiftLeft"],
    "replay": ["ShiftRight"],
});

const ALL_AMMO = [ // [!] placeholder
    "Basic",
    "Flower",
    "Digger",
    "Bouncer",
    "MegaBouncer",
    "GigaBouncer",
    "Pine",
    "Sniper",
    "Rapid",
    "Scatter",
    "MegaScatter",
    "GigaScatter"
];

const SHOT_TRACE_LIMIT = 30; // (seconds) will trigger a landing early if timeout is exceeded- however a landing will only be traced within this time frame so early landings shouldn't be happening... -KT
const AIM_SENSITIVITY = Math.PI / 180;
const POWER_SENSITIVITY = .005;
const PAN_SENSITIVITY = 5;
const MOVE_SPEED = 1;

export class Round extends Phase {
    static MENU_BACKGROUND_TINT = new Color(0, 0, 0, .7);
    static WEB_WORKER_PATH = WEB_WORKER_PATH;
    #AmmoPool = new AmmoPool();
    #Players = new Map();
    #Lobby;
    #LobbyID;
    #ClientPlayerID; // id of client player
    #Threaded;
    #Terrain;
    #Random;
    #Animations = {
        Main: new AnimationList()
    };
    constructor (mainController, playerID, lobbyData, turnData, lobbyid, firstTurn = false) {
        super(mainController);
        this.#LobbyID = lobbyid;
        this.#Random = new Random(Random.seedString(lobbyid));
        this.#Lobby = initLobby(lobbyData);
        let recording;
        if (firstTurn) {
            this.#Terrain = new Terrain(Polygon.unpack(turnData));
        } else {
            recording = TurnRecorder.process(turnData).recording;
            this.#Terrain = recording.start.terrain.clone(true);
        }
        // [!] testing
        this.Terrain.apply(undefined, {
            edgeColor: new Color("#00e8f0"),
            fillColor: new Color("#0098eb")
        });
        this.Plane.max.apply(this.Terrain.polygon.getBoundingBox().width, this.Terrain.polygon.getBoundingBox().height * 2);

        this.#load(playerID)
            .then(() => this.#init())
            .then(async () => {
                const { replayButton } = this.store.overlayItems;
                if (recording) {
                    // play previous turn animation
                    await this.renderRecording(recording);
                    this.store.recording.before = recording;
                    replayButton.hide = false;
                } else {
                    // setup first turn of the lobby
                    distributePlayers(this.Plane, Array.from(this.Players.values()), this.Random, 100);
                    replayButton.hide = true;
                }
            })
            .then(() => this.resolveLoad())
            .catch((error) => this.rejectLoad(error));
    }

    #init () {
        this.store.MIN_SIZE = this.Global.Display.size.div(5);
        this.store.ammo = {
            tracer: undefined,
            current: undefined,
            selected: undefined,
            map: undefined,
            types: undefined,
            impacts: [],
            debug: {
                legend: undefined,
                blasts: [],
                collisions: [],
            }            
        };
        // save to be replayed or exported
        this.store.recording = {
            current: undefined,
            previous: undefined,
            before: undefined
        };
        this.store.turnBefore = undefined;
        this.flags.turnEnded = false;
        this.flags.replaying = false;

        this.Camera.Viewbox.bounding.top = false;
        this.#setupSFX();
        this.#setupInterface();
        this.Menus.set("Ammo", new AmmoSelect(this, this.#createAmmoSelections()));
        this.Menus.get("Ammo").Events.addEventListener("CLOSE", ({selection}) => {
            if (!selection?.isAmmoTypeDetails) return;
            this.store.ammo.selected = selection.id;
            this.store.overlayItems.launchButton.text = selection.name;
            if (this.store.overlayItems.hideButton.active)
                this.store.overlayItems.launchButton.hide = false;
            else
                this.store.overlayItems.launchButton.userData.lastHideState = false;
        })
    }
    async #load (playerID) {
        const waitPromises = [
            this.#setupThreads(),
            this.#loadLobby(playerID),
            this.#loadSFX(),
            this.loadGlobalAsset("muzzleFlash"),
            this.loadGlobalAsset("moveBtn"),
            this.loadGlobalAsset("selectBtn"),
            this.loadGlobalAsset("fireBtn"),
            this.loadGlobalAsset("replayBtn"),
            this.loadGlobalAsset("hideActiveBtn"),
            this.loadGlobalAsset("hideInactiveBtn"),
        ];
        await Promise.all(waitPromises);
    }
    async #loadLobby (playerID) {
        this.#ClientPlayerID = playerID;
        await this.Lobby.loadAssets(
            this.#ClientPlayerID,
            this.AssetPool,
            this.AmmoPool,
            this.Global.constructor.AssetType
        );
        this.Lobby.generatePlayerActors(this.#ClientPlayerID, this.AssetPool, this.Players, HitpointMap, this.Terrain);
        await Promise.all(this.Players.values().map(({onload}) => onload));
    }
    async #loadSFX () {
        await Promise.all([
            this.loadGlobalAsset("blast"),
            this.loadGlobalAsset("fire"),
            this.loadGlobalAsset("bouncer"),
        ]);
    }
    #createAmmoSelections () {
        return Array.from(this.Lobby.AmmoTypes, (ammoType) => {
            const ammo = this.AmmoPool.get(ammoType);
            const selection = new AmmoTypeDetails(ammo.NAME, ammo.IMPORT, ); // [!] needs icon
            const { glowColor, borderColor, fillColor, fontColor } = selection;
            borderColor.apply(ammo.mainColor);
            fontColor.apply(glowColor.apply(ammo.glowColor));
            fillColor.apply(0, 0, 0, .6);
            return selection;
        });
    }
    async #setupThreads () {
        const pool = new WorkerPool(new URL(this.constructor.WEB_WORKER_PATH, window.location.origin), 4, 3);
        await pool.onload;
        this.#Threaded = new PoolManager(pool);
        this.store.cacheKey = {
            terrain: "lastTerrainState",
            background: "backgroundCanvas"
        };
        const terrain = new TerrainCache(this.Terrain, this.store.cacheKey.terrain);
        const background = new CanvasCache(this.Plane.width, this.Plane.height, this.store.cacheKey.background);
        await Promise.all([
            this.Threaded.setCache(background),
            this.Threaded.setCache(terrain)
        ]);
        await this.Threaded.drawTerrain(this.store.cacheKey.background, this.store.cacheKey.terrain);
        await this.Threaded.updateCache(this.store.cacheKey.background, true);
    }
    #setupInterface () {
        // panning/zoom controls
        const underButton = new ScreenButton(this.Global.Display);
        underButton.ondrag = (point, origin, delta, isTouch) => {
            this.Camera.unlock();
            this.Camera.offsetPosition(delta
                .mul(-PAN_SENSITIVITY)
                .div(this.Camera.Viewbox.canvasScale, true)
            );
        }
        underButton.onscroll = (point, delta, isTouch) => {
            const hasDeltaX = !equals(delta.x, 0);
            const hasDeltaY = !equals(delta.y, 0);
            if (!isTouch && hasDeltaX) {
                this.Camera.unlock();
                this.Camera.offsetPosition(delta.x * PAN_SENSITIVITY);
            }
            if (hasDeltaY) {
                const { size } = this.Global.Display;
                this.Camera.clearTargetSize();
                const scale = 1 / ((size.y - delta.y) / size.y);
                this.Camera.Viewbox.applyScale(scale);
            }
        }
        // UI
        const moveImg = this.AssetPool.get("moveBtn"); // left-facing
        const selectImg = this.AssetPool.get("selectBtn");
        const fireImg = this.AssetPool.get("fireBtn");
        const replayImg = this.AssetPool.get("replayBtn");
        const hideActiveImg = this.AssetPool.get("hideActiveBtn");
        const hideInactiveImg = this.AssetPool.get("hideInactiveBtn");
        const moveLeftBtn = new IconButton(new Icon(moveImg.clone(false)));
        const moveRightBtn = new IconButton(new Icon(moveImg.clone(false)));
        moveRightBtn.icon.source.scale.apply(-1, 1);
        moveRightBtn.icon.source.origin.apply(moveImg.rawSize.x, 0);
        const launchButton = new IconButton(new Icon(fireImg.clone(false)));
        const selectButton = new IconButton(new Icon(selectImg.clone(false)));
        const replayButton = new IconButton(new Icon(replayImg.clone(false)));
        const hideButton = new ToggleIconButton(new Icon(hideActiveImg.clone(false)), new Icon(hideInactiveImg.clone(false)));
        hideButton.userData.isHideButton = true;

        const { Mover } = this.ClientPlayer;
        const { store, flags } = this;
        moveLeftBtn.onclick = moveLeftBtn.onhold = () => {
            if (this.isClientActionAllowed) {
                Mover.move(-MOVE_SPEED);
                this.trackClientPlayer();
            }
        };
        moveRightBtn.onclick = moveRightBtn.onhold = () => {
            if (this.isClientActionAllowed) {
                Mover.move(MOVE_SPEED);
                this.trackClientPlayer();
            }
        };
        launchButton.onclick = () => {
            if (this.isClientActionAllowed && this.isAmmoSelected)
                this.launchAmmo();
        };
        selectButton.onclick = () => {
            if (this.isClientActionAllowed)
                this.Menus.get("Ammo").open();
        };
        replayButton.onclick = () => {
            const { previous: recording } = store.recording;
            if (!this.isPlaybackRunning && recording?.isTurnRecording) {
                if (hideButton.active)
                    replayButton.hide = true;
                else
                    replayButton.userData.lastHideState = true;
                flags.replaying = true;
                this.loadRecording(recording)
                    .then(({player, ammo, impacts}) => this.playRecording(recording, ammo, player, impacts));
            }
        };
        hideButton.onclick = () => {
            if (hideButton.active) {
                for (const item of Object.values(this.store.overlayItems)) {
                    if (item.userData?.isHideButton) continue;
                    item.userData.lastHideState = !!item.hide;
                    item.hide = true;
                }
            } else {
                for (const item of Object.values(this.store.overlayItems)) {
                    if (item.isHideButton) continue;
                    item.hide = item.userData.lastHideState;
                }
            }
            hideButton.toggle();
        }

        launchButton.hide = true;
        this.store.overlayItems = {
            moveLeftBtn,
            moveRightBtn,
            launchButton,
            selectButton,
            replayButton,
            hideButton
        };
        this.Interface.insert()
            .push(underButton)
            .fixed = true;
        // player Aimer
        this.Interface.insert()
            .push(this.ClientPlayer.Aimer)
            .fixed = false;
        // overlay buttons
        this.Interface.insert()
            .push(...Object.values(this.store.overlayItems))
            .fixed = true;
        this.resizeOverlay();
    }
    #setupSFX () {
        const { AmmoPool, Audio, AssetPool } = this;

        Audio.Layer.ammo = Audio.Player.Layer();
        Audio.Layer.ammo.volume = 0.6;
        Audio.Layer.blast = Audio.Player.Layer();
        Audio.Layer.blast.volume = 0.55;
        Audio.Player.volume = 0.35;

        const bounceSFXAmmoTypes = ["Bouncer", "MegaBouncer"];
        const bounceSFXSource = AssetPool.get("bouncer");
        const bounceSFXCallback = function () {
            Audio.Layer.ammo.add(bounceSFXSource.Instance().play(), true);
        }
        for (const ammoType of bounceSFXAmmoTypes) {
            if (AmmoPool.has(ammoType))
                AmmoPool.get(ammoType).SFX.bounce = bounceSFXCallback;
        }
    }
    #setAmmo (ammoType, map) {
        const { ammo } = this.store;
        ammo.current = ammoType;
        ammo.map = map;
        ammo.tracer = ammoType.getTracer();
        ammo.debug.legend = map.legend; // [!] redundant
        ammo.debug.blasts = Array.from(map.blasts);
        ammo.debug.collisions = [];
        for (const multishotLegend of ammo.debug.legend.stages)
            for (const shotLegend of multishotLegend)
                for (const collision of shotLegend.collisions)
                    ammo.debug.collisions.push(collision);
    }
    #unsetAmmo () {
        const { ammo } = this.store;
        ammo.current = undefined;
        ammo.map = undefined;
        ammo.impacts = [];
        delete this.Animations.blasts;
    }
    #createLaunchCallback () {
        const self = this;
        // gets bound to Shot
        return function () {
            const { Puppet, Aimer } = self.ClientPlayer;
            const blastSizes = this.userData.hitbox
                ?.filter((blast) => blast?.shape?.isCircle)
                ?.map(({shape}) => shape.radii.length * 2) || [1];
            const blastAverageSize = blastSizes.reduce((a, b) => a + b) / blastSizes.length;
            const blastMagnitude = blastAverageSize / Math.max(Puppet.width, Puppet.height);
            const muzzleFlashSize = (blastMagnitude * 400) * (Aimer.power**3);
            const muzzleFlash = createMuzzleFlashAnimation(
                self.ClientPlayer,
                self.AssetPool.get("muzzleFlash").clone(),
                muzzleFlashSize
            );
            self.Animations.Main.push(muzzleFlash);
            muzzleFlash.play();
            self.Audio.Player.add(self.AssetPool.get("fire").Instance().play(), true);
        }
    }
    #onPlayerDeath (player) {
        const deathExplosion = createPlayerDeathAnimation(
            player,
            this.AssetPool.get("explosion").clone()
        );
        this.Animations.Main.push(deathExplosion);
        deathExplosion.play();
    }
    #createBlastImpact (roundState) {
        const { AssetPool } = this;
        const { Context, Layer } = this.Audio;
        // bundle callbacks with data to call later
        const impact = new BlastImpact(
            Context,
            Layer.blast,
            AssetPool.get("blast"),
            roundState.interval,
            createBlastAnimation
        );
        impact.ontrigger.then(({
            animations, frame, combinedbbox
        }) => {
            if (frame)
                this.Threaded.cache[this.store.cacheKey.background] = frame;
            animations.play();
            if (roundState.terrain?.isTerrain)
                this.updateTerrain(roundState.terrain);
            for (const deadPlayerID of roundState.applyActors(this.Players)) {
                this.#onPlayerDeath(this.Players.get(deadPlayerID));
            }
            if (this.Camera.targets)
                this.Camera.track(combinedbbox);
        });
        return impact;
    }

    async ontick (delta) {
        if (this.store.ammo.current) {
            if (this.updateAmmoTick(delta)) {
                console.info(`[${typeString(this)}]: Turn playback finished`);
                if (!this.flags.replaying && this.Lobby.Players.size > 1) this.endTurn();
                this.endRecording();
                setTimeout(() => this.setTurn(this.isClientTurn), 1000);
            }
        }
        if (this.flags.isTurn && !this.flags.turnEnded) {
            // disable Aimer if it covers enough of the screen
            const AimerIsLarge = this.Camera.Viewbox.size.max() / 2 <= this.ClientPlayer.Aimer.radius * 2;
            let AimerIsCenter = this.ClientPlayer.Aimer.isOver(this.Camera.Viewbox.toGlobal(this.Global.Display.getBoundingBox().center));
            if (this.ClientPlayer.Aimer.hide) AimerIsCenter = !AimerIsCenter;
            this.ClientPlayer.Aimer.hide = AimerIsLarge && AimerIsCenter;
        }
        this.handleInput();
    }
    async updateTurn (turnCount, turnData) {
        this.Global.Events.raiseEvent("LOADING", {hide: false});
        this.store.recording.before = TurnRecorder.process(turnData).recording;
        await this.renderRecording(this.store.recording.before);
        this.Lobby.turns = turnCount;
        this.unendTurn();
        this.Global.Events.raiseEvent("LOADING", {hide: true});
        this.start();
    }
    start () {
        new Promise(async (resolve, reject) => {
            const { before: recording } = this.store.recording;
            this.setTurn(this.isClientTurn);
            if (recording?.isTurnRecording) {
                this.Global.Events.raiseEvent("LOADING", {hide: false});
                if (recording.length)
                    this.displayState(recording.start);
                const { player, ammo, impacts } = await this.loadRecording(recording);
                this.Global.Events.raiseEvent("LOADING", {hide: true});
                setTimeout(async () => {
                    this.flags.replaying = true;
                    await this.playRecording(recording, ammo, player, impacts, false);
                    resolve();
                }, 500);
            }
        }).finally(() => {
            super.start();
        });
    }
    onanimate () {
        const { Camera, Animations, Interface, Players, flags, store } = this;
        const { cursor } = this.Global.Display;
        Camera.update();
        if (Camera.Viewbox.size.lengthSquared < store.MIN_SIZE.lengthSquared) {
            Camera.Viewbox.applySize(store.MIN_SIZE);
        }
        if (flags.isTurn) Interface.draw(cursor, 0, 2);
        Camera.Viewbox.setCursor(cursor, true);
        for (const player of Players.values())
            if (!player.isDead) player.drawModel(cursor);
        cursor.restore();
        this.drawBackground();
        Camera.Viewbox.setCursor(cursor, true);
        if (store.ammo.tracer) store.ammo.tracer.draw(cursor);
        if (store.ammo.current && store.ammo.current.time > 0)
            store.ammo.current.draw(cursor);
        Animations.Main.update(cursor);
        for (const player of Players.values())
            player.drawOverlay(cursor, player.id === this.#ClientPlayerID, flags.isTurn);
        cursor.restore();
        if (flags.isTurn) Interface.draw(cursor, 2);
        if (this.Global.flags.DEBUG) this.drawDebugOverlay();
    }
    onResize () {
        this.store.MIN_SIZE = this.Global.Display.size.div(5);
        this.resizeOverlay();
        this.setTurn(this.flags.isTurn);
        super.onResize();
    }
    resizeOverlay () {
        const { Display } = this.Global;
        const { size } = Display;
        const {
            moveLeftBtn,
            moveRightBtn,
            launchButton,
            selectButton,
            replayButton,
            hideButton
        } = this.store.overlayItems;
        const padding = size.min() / 20;
        const targetWidth = size.x / 10
        moveRightBtn.icon.source.width
            = moveLeftBtn.icon.source.width
            = launchButton.icon.source.width
            = selectButton.icon.source.width
            = Math.min(250, targetWidth);
        replayButton.icon.source.width
            = hideButton.activeIcon.source.width
            = hideButton.inactiveIcon.source.width
            = Math.min(100, targetWidth);

        const baselineY = moveRightBtn.height + padding;
        if (Display.isPortrait) {
            moveLeftBtn.setPosition(
                padding,
                baselineY
            );
            moveRightBtn.setPosition(
                size.x - (moveRightBtn.width + padding),
                baselineY
            );
            launchButton.setPosition(
                (size.x / 2) - (padding / 2) - launchButton.width,
                baselineY
            );
            selectButton.setPosition(
                (size.x / 2) + (padding / 2),
                baselineY
            );
        } else {
            selectButton.setPosition(
                padding,
                baselineY
            );
            launchButton.setPosition(
                moveLeftBtn.width + padding + padding,
                baselineY
            );
            moveRightBtn.setPosition(
                size.x - (selectButton.width + padding),
                baselineY
            );
            moveLeftBtn.setPosition(
                size.x - (selectButton.width + launchButton.width + padding + padding),
                baselineY
            );
        }
        replayButton.setPosition(
            size.x - (replayButton.width + padding),
            size.y - padding
        );
        hideButton.setPosition(
            padding,
            size.y - padding
        );
    }
    drawDebugOverlay () {
        const { ClientPlayer, Terrain, Interface, store, flags } = this;
        const { Input, Display } = this.Global;
        const { Viewbox } = this.Camera;
        const { cursor } = Display;
        const displaySize = Display.size;
        // draw any holes in terrain
        Viewbox.setCursor(cursor, true);

        // terrain outline
        cursor.save();
        cursor.strokeStyle = "blue";
        cursor.lineWidth = 3;
        Terrain.polygon.draw(cursor, true);
        cursor.stroke();
        cursor.restore();

        // terrain holes
        cursor.save();
        cursor.strokeStyle = "yellow";
        cursor.lineWidth = 2;
        for (const hole of Terrain.polygon.holes) {
            cursor.save();
            hole.draw(cursor);
            cursor.stroke();
            cursor.restore();
        }
        cursor.restore();

        // player hitboxes
        cursor.save();
        cursor.strokeStyle = "red";
        cursor.lineWidth = 2;
        for (const { Puppet } of this.Players.values()) {
            cursor.save();
            Puppet.getHitbox()
                .draw(cursor, true);
            cursor.stroke();
            cursor.restore();
        }
        cursor.restore();

        // draw collision details
        if (store.ammo.debug.legend?.stages) {
            if (store.ammo.debug.collisions) {
                const _lineLength = 35;
                const red = new Color(255, 0, 0, .5)
                    .toString();
                const green = new Color(0, 255, 0, .5)
                    .toString();
                const blue = new Color(0, 0, 255, .5)
                    .toString();
                store.ammo.debug.collisions.forEach(({position, point, rebound, velocity, normal}) => {
                    drawCircle(cursor, position, 3, blue); // shot position during collision
                    drawLine(cursor, point, point.add(normal.normalize().mul(_lineLength)), 2, green); // normal
                    drawLine(cursor, point, point.add(velocity.normalize().mul(_lineLength)), 2, blue); // direction (incoming)
                    if (rebound.length) drawLine(cursor, position, position.add(rebound.normalize().mul(_lineLength)), 2, red); // reflection
                });
            }
            // draw blasts
            if (store.ammo.debug.blasts?.length) {
                const c = new Color(255, 165, 0, .15);
                cursor.save();
                cursor.fillStyle = c.toString();
                for (const { shape } of store.ammo.debug.blasts) {
                    shape.draw(cursor, true);
                    cursor.fill();
                }
                cursor.restore();
                c.a = 1;
                for (const { position } of store.ammo.debug.blasts) {
                    drawCircle(cursor, position, 3, c.toString());
                }
            }
        }

        // draw UI button areas
        cursor.restore();
        cursor.save();
        cursor.fixed = true;
        cursor.strokeStyle = "red";
        cursor.lineWidth = 2;
        for (const item of Object.values(this.store.overlayItems)) {
            cursor.save();
            item.getBoundingBox?.()?.draw?.(cursor);
            cursor.stroke();
            cursor.restore();
        }
        cursor.restore();
    }
    trackClientPlayer (breadthScale = 10) {
        const { Camera } = this;
        const { Puppet } = this.ClientPlayer;
        Camera.track(Puppet.position);
        const size = Puppet.getBoundingBox().size.mul(breadthScale);
        Camera.setTargetSize(size.x, size.y, true);
        Camera.track(Puppet.position);
    }
    updateAmmoTick (delta = 0) {
        const { Animations } = this;
        const { ammo } = this.store;
        const blastAnimationsFinished = (!Animations.blasts || Animations.blasts.ended);
        // trigger blast animations
        for (const impact of ammo.impacts) {
            if (impact.triggered) continue;
            if (impact.time <= ammo.current.time) impact.play();
        }
        // update projectile
        ammo.current.update(delta / 1000);
        // are we done with projectile?
        const endProjectileEarly =
            (ammo.current.time >= SHOT_TRACE_LIMIT) // time out shots even if a landing exists
            || ((!ammo.map.finished || Animations.blasts.ended)
                // time out early if theres no landing and it flew offscreen
                //  or if all the blasts are done, and it flew offscreen
                && !ammo.current.isInsideDisplay);
        const isTimedout =
            !(ammo.map.finished && ammo.current.time >= ammo.map.time - Number.EPSILON)
            && endProjectileEarly;

        if (endProjectileEarly) {
            if (!blastAnimationsFinished) {
                // play any paused blast animations prematurely
                // shouldn't restart already playing animations
                Animations.blasts?.play?.();
            }
            if (this.Global.flags.DEBUG) {
                if (isTimedout) console.info(`[${typeString(this)}]: Shot timed out`);
                else console.info(`[${typeString(this)}]: Shot forcefully ended early`);
            }
            ammo.current = undefined;
        }
        // [!] boolean logic here could be written better -KT
        const playbackFinished = Animations.blasts?.ended
            || (!Animations.blasts && isTimedout);
        return playbackFinished;
    }
    drawMenuBackground () {
        const { cursor, size } = this.Global.Display;
        const { Viewbox } = this.Camera;
        const { MENU_BACKGROUND_TINT } = this.constructor;
        cursor.save();
        cursor.filter = "blur(10px)";
        Viewbox.setCursor(cursor, true);
        for (const { Puppet, isDead } of this.Players.values())
            if (!isDead) Puppet.draw(cursor);
        cursor.restore();
        this.drawBackground();
        Viewbox.setCursor(cursor, true);
        if (this.store.ammo.current && this.store.ammo.current.time > 0)
            this.store.ammo.current.draw(cursor);
        cursor.restore();
        cursor.fillStyle = MENU_BACKGROUND_TINT.toRGBA();
        cursor.rect(0, 0, size.x, size.y);
        cursor.fill();
        cursor.restore();
    }
    drawBackground () {
        const img = this.Threaded.cache[this.store.cacheKey.background].canvas;
        const { cursor, size } = this.Global.Display;
        const { Viewbox } = this.Camera;
        cursor.drawImageSafe(
            img,
            Viewbox.min.x, cursor.normalizeY(Viewbox.max.y),
            Viewbox.width, Viewbox.height,
            0, 0,
            size.x, size.y,
        );
    }
    handleInput () {
        const { ClientPlayer, Global } = this;
        const { keyboard, pointer } = Global.Input;
        if (INPUT_MAP.isActive(keyboard, "esc")) {
            // pause menu logic
        }
        if (!INPUT_MAP.isActive(keyboard, "debug+")) {
            if (INPUT_MAP.isActive(keyboard, "pan+")) {
                this.Camera.untrackAll();
                this.Camera.offsetPosition(PAN_SENSITIVITY);
                
            }
            if (INPUT_MAP.isActive(keyboard, "pan-")) {
                this.Camera.untrackAll();
                this.Camera.offsetPosition(-PAN_SENSITIVITY);
            }
        }
        if (this.isClientActionAllowed) {
            // [!] most pointer logic handled by callbacks

            // keyboard
            if (!INPUT_MAP.isActive(keyboard, "debug+")) {
                if (this.isAmmoSelected) {
                    if (INPUT_MAP.isActive(keyboard, "shootActive"))
                        this.launchAmmo();
                }
                ClientPlayer.Puppet.position.round(1/Global.constructor.SETTINGS.RESOLUTION);
                if (INPUT_MAP.isActive(keyboard, "mv+")) {
                    ClientPlayer.Mover.move(MOVE_SPEED);
                    if (!pointer.isActive)
                        this.trackClientPlayer();
                }
                if (INPUT_MAP.isActive(keyboard, "mv-")) {
                    ClientPlayer.Mover.move(-MOVE_SPEED);
                    if (!pointer.isActive)
                        this.trackClientPlayer();
                }
                if (INPUT_MAP.isActive(keyboard, "shot+")) {
                    ClientPlayer.Aimer.power += POWER_SENSITIVITY;
                }
                if (INPUT_MAP.isActive(keyboard, "shot-")) {
                    ClientPlayer.Aimer.power -= POWER_SENSITIVITY;
                }
                if (INPUT_MAP.isActive(keyboard, "aim+")) {
                    ClientPlayer.Aimer.rotation += AIM_SENSITIVITY;
                }
                if (INPUT_MAP.isActive(keyboard, "aim-")) {
                    ClientPlayer.Aimer.rotation -= AIM_SENSITIVITY;
                }
            }
        } else {
            // only handle input related to menus (main menu, settings, exit button, etc.) - KT
            if (pointer.isActive) {
                if (pointer.isHolding)
                    this.Interface
                        .slice(0, 0) // only parse inputs for specific layers with the menu buttons (currently not implemented)
                        .onhold(pointer.position);
            }
        }
    }
    updateTerrain (terrain) {
        if (this.Terrain.hash !== terrain.hash)
            this.Terrain.apply(terrain.polygon);
    }
    createPlayerColliders () {
        const colliders = [];
        const selfTeam = this.ClientPlayer.Metadata.team;
        for (const player of this.Players.values()) {
            if (player.isDead) continue;
            colliders.push(player.getCollider(player.id === this.#ClientPlayerID, player.Metadata.team === selfTeam));
        }
        return colliders;
    }
    setTurn (bool) {
        this.Camera.unlock();
        if (bool) {
            this.Camera.lerpFactor = 0.2;
            this.trackClientPlayer();
        } else {
            this.Camera.lerpFactor = 0.12;
        }
        this.ClientPlayer.Aimer.hide = !bool && !this.flags.turnEnded;
        this.flags.isTurn = bool;
    }
    endTurn () {
        if (this.flags.turnEnded) return;
        this.flags.turnEnded = true;
        
        const { overlayItems } = this.store;
        this.ClientPlayer.Aimer.hide
            = overlayItems.hideButton.hide
            = overlayItems.moveLeftBtn.hide
            = overlayItems.moveRightBtn.hide
            = overlayItems.launchButton.hide
            = overlayItems.selectButton.hide
            = true;
    }
    // call when saving turn fails
    unendTurn () {
        if (!this.flags.turnEnded) return;
        this.flags.turnEnded = false;
        
        const { overlayItems } = this.store;
        this.ClientPlayer.Aimer.hide
            = overlayItems.hideButton.hide
            = overlayItems.moveLeftBtn.hide
            = overlayItems.moveRightBtn.hide
            = overlayItems.launchButton.hide
            = overlayItems.selectButton.hide
            = false;
    }
    endRecording () {
        const { recording } = this.store;
        if (recording.current?.isTurnRecording) {
            recording.previous = recording.current;
            recording.current = undefined;
        }
        this.#unsetAmmo();
        if (this.store.overlayItems.hideButton.active)
            this.store.overlayItems.replayButton.hide = false;
        else
            this.store.overlayItems.replayButton.userData.lastHideState = false;
        this.flags.replaying = false;
    }
    // expects recording to already be rendered
    async loadRecording (recording) {
        this.setTurn(false);
        const impacts = recording.states.map((state) => this.#createBlastImpact(state));
        const type = await this.loadAmmoType(recording.ammoJson.import);
        const ammo = type.decode(...recording.ammoJson.params);
        ammo.decodeTransferData(recording.ammoJson.transfer);
        ammo.traceLegend(recording.ammoMap.legend);
        const activePlayer = this.Players.get(recording.ActivePlayerID);
        console.info(`[${typeString(this)}]: Turn recording loaded`);
        return {
            player: activePlayer,
            ammo: ammo,
            impacts: impacts
        };
    }
    // modifies visually
    // mutates player actors
    displayState (state) {
        // [!] doesn't update cache
        for (const player of this.Players.values())
            if (player.id in state.actors)
                player.setState(state.actors[player.id]);
        if (state.frame)
            this.Threaded.cache[this.store.cacheKey.background] = state.frame;
    }
    async playRecording (recording, ammo, activePlayer, blastImpacts, setup = true) {
        this.Global.Events.raiseEvent("LOADING", {hide: false});
        if (recording.length) {
            const { start, end } = recording;
            if (this.Terrain.hash !== start.terrain.hash)
                this.updateTerrain(start.terrain, false);
            if (setup)
                this.displayState(start);
            if (end.terrain)
                await this.Threaded.setCache(new TerrainCache(end.terrain, this.store.cacheKey.terrain));
        }
        this.Animations.blasts = new AnimationList();
        this.store.ammo.impacts = [];
        for (const impact of blastImpacts) {
            this.Animations.blasts.push(...impact.Animations);
            this.store.ammo.impacts.push(impact);
        }
        this.Animations.Main.push(...this.Animations.blasts);
        ammo.displayBoundingBox = this.Camera.Viewbox;
        this.Global.Events.raiseEvent("LOADING", {hide: true});
        this.#setAmmo(ammo, recording.ammoMap);
        this.store.recording.current = recording;
        this.Camera.track(ammo.getBoundingBox(true, false, true));
        if (activePlayer?.isActor) this.Camera.track(activePlayer.Puppet.getBoundingBox());
        console.info(`[${typeString(this)}]: Playing turn recording`);
    }
    async renderRecording (recording) {
        const renderJobs = [];
        const { width, height } = this.Plane;
        for (const interval of recording.intervals) {
            if (interval.terrain?.isTerrain && !interval.frame) {
                interval.terrain.applyOptions(this.Terrain);
                renderJobs.push(this.Threaded.drawNewTerrain(interval.terrain, width, height)
                    .then((frame) => interval.frame = frame));
            }
        }
        await Promise.all(renderJobs);
    }
    async createAmmo (playerActor, ammoType) {
        const type = await this.loadAmmoType(ammoType);
        const ammo = new type(...playerActor.getLaunchParameters(this.Terrain));
        ammo.colliders.push(this.Terrain.polygon);
        ammo.launchCallback = this.#createLaunchCallback();
        return ammo;
    }
    async loadAmmoType (ammoType) {
        if (!this.AmmoPool.has(ammoType))
            this.AmmoPool.add(ammoType);
        return await this.AmmoPool.onready(ammoType);
    }
    async createTurnRecording (activePlayerID, ammoType) {
        const { DEBUG } = this.Global.flags;
        const TICKSPEED = this.Global.TickInterval.interval;
        const ammo = await this.createAmmo(this.Players.get(activePlayerID), ammoType);
        let waitStart = performance.now();
        console.info(`[${typeString(this)}]: Tracing shot (${ammoType})`);
        this.Global.Events.raiseEvent("LOADING", {hide: false, message: "loading turn (tracing)"});
        const map = await this.Threaded.traceAmmo(
            ammo,
            TICKSPEED / 1000,
            SHOT_TRACE_LIMIT,
            this.store.cacheKey.terrain,
            this.createPlayerColliders()
        );
        if (DEBUG)
            console.info(`[${typeString(this)}]: Shot trace finished in ${(performance.now() - waitStart) / 1000}s`);
        waitStart = performance.now();
        console.info(`[${typeString(this)}]: Rendering shot collisions`);
        this.Global.Events.raiseEvent("LOADING", {hide: false, message: "loading turn (rendering)"});
        const intervals = await this.Threaded.renderBlastIntervals(this.store.cacheKey.terrain, this.Plane.size, ...map.blasts);
        const Recorder = TurnRecorder.create(
            this.#Threaded.cache[this.store.cacheKey.background],
            this.Players,
            this.Terrain.clone(true)
        );
        this.Global.Events.raiseEvent("LOADING", {hide: false, message: "loading turn (recording)"});
        const recording = Recorder.record(
            activePlayerID,
            ammo.clone(true),
            map,
            intervals,
            TICKSPEED
        );
        if (DEBUG)
            console.info(`[${typeString(this)}]: Collision map computed in ${(performance.now() - waitStart) / 1000}s`);
        this.Global.Events.raiseEvent("LOADING", {hide: true});
        return recording;
    }
    async launchAmmo () {
        try {
            const { hideButton, replayButton } = this.store.overlayItems;
            this.setTurn(false);
            this.animate(true); // draw one last frame so the game doesn't look like it just froze
            this.Global.Events.raiseEvent("LOADING", {hide: false, message: "loading turn"});
            const recording = await this.createTurnRecording(this.#ClientPlayerID, this.store.ammo.selected);
            this.Events.raiseEvent("TURNENDED", this.export(recording));
            const { player, ammo, impacts } = await this.loadRecording(recording);
            this.Global.Events.raiseEvent("LOADING", {hide: true});
            if (hideButton.active) replayButton.hide = true;
            else replayButton.userData.lastHideState = true;
            await this.playRecording(recording, ammo, player, impacts, false);
        } catch (err) {
            console.error(`[${typeString(this)}]: Projectile trace error`);
            this.Global.Events.raiseEvent("NOTIFY", {severity: -1, message: "An error occured while playing your turn. Relaunch the activity and try again.", timeout: -1});
            this.Global.Events.raiseEvent("LOADING", {hide: true});
            throw err;
        }
    }
    export (recording) {
        let players = {};
        if (recording.length) {
            const changes = recording.end.difference(recording.start);
            players = changes.captureAffectedActors(this.Players);
        }
        return {
            recording: recording.pack(),
            players: players
        };
    }

    get AmmoPool () { return this.#AmmoPool }
    get Lobby () { return this.#Lobby }
    get ClientPlayer () { return this.Players.get(this.#ClientPlayerID) }
    get ActivePlayer () { return this.Players.get(this.Lobby.ActivePlayerID) }
    get Players () { return this.#Players }
    get Threaded () { return this.#Threaded }
    get Terrain () { return this.#Terrain }
    get Animations () { return this.#Animations }
    get Random () { return this.#Random }
    get isPlaybackRunning () { return !!this.store.recording.current }
    get isAmmoSelected () { return !this.store.ammo.current && !!this.store.ammo.selected }
    get isClientTurn () { return this.Lobby.Players.size === 1 || (this.Lobby.ActivePlayerID === this.#ClientPlayerID && !this.flags.turnEnded) }
    get isClientActionAllowed () { return !this.isPlaybackRunning && this.isClientTurn }
}

function createMuzzleFlashAnimation (playerActor, spritesheet, width) {
    spritesheet.width = width;
    spritesheet.rotation = playerActor.Aimer.rotation + Math.PI;
    const animation = new Animation(
        playerActor.Puppet.barrelPosition,
        spritesheet,
        spritesheet.framerate
    );
    animation.speed = 2.3;
    return animation;
}

function createBlastAnimation (blast) {
    const animation = new ShapeAnimation(
        blast.shape.clone(),
        .6,
        25,
        drawBlastAnimation,
        [new Color(255, 255, 255, 1), 2]
    );
    animation.speed = 1.25;
    return animation;
}

function createPlayerDeathAnimation (playerActor, spritesheet) {
    const { Puppet } = playerActor;
    spritesheet.rotation = Puppet.rotation.body;
    return new Animation(
        Puppet.relativePosition,
        spritesheet,
        spritesheet.framerate
    );
}

// [!] recursion limit applies per-player
function distributePlayers (bbox, players, random, recursionLimit = 1000) {
    const min = bbox.min.x + (bbox.width / 10);
    const max = bbox.max.x - min;
    const spacing = (bbox.width / players.length);
    const range = (max - min) / spacing; 
    const spots = new Set();
    for (const { Aimer, Mover } of players) {
        let x;
        let added = false;
        let i = 0;
        while (i < recursionLimit) {
            x = (Math.floor(random.random() * (range + 1)) * spacing) + min;
            if (!spots.has(x) && Mover.apply(x, bbox.max.y + 1)) {
                spots.add(x);
                added = true;
                break;
            }
            i++;
        }
        if (!added && i >= recursionLimit) throw new Error("Recusion limit reached while distributing players. Is terrain invalid?");
        if (added) Aimer.update(players[0].Puppet.position.add({x: 0, y: bbox.max.y})); // aim straight up and set power to 100% (1)
    }
}
