import {
    Loop,
    AppCanvas,
    FrameCounter,
    Interval,
    InputListener,
    AudioContext,
    LoadFont,
    LoadImage,
    EditableImage,
    Spritesheet,
    typeString,
    equals
} from "../core/Core.js";


export class Main extends Loop {
    static SETTINGS = {
        CLICK_DURATION_MS: 90,
        TICKSPEED: 10, // milliseconds, must be lower than framerate
        FPS: 60,
        NOTIF_DURATION_MS: 3000
    };
    static #AudioCtx;
    static #AssetType = {
        Sprite: (...args) => new Spritesheet(...args),
        Image: (...args) => new LoadImage(...args),
        Font: (...args) => new LoadFont(...args),
        EditableImage: (...args) => new EditableImage(...args),
        Audio: undefined
    };
    static #loadAudioContext () {
        this.#AudioCtx = new AudioContext();
        this.#AssetType.Audio = (...args) => this.#AudioCtx.Source(...args);
    }
    static get AssetType () { return this.#AssetType }
    #Phases = {
        Create: undefined,
        Join: undefined,
        Loadout: undefined,
        Round: undefined
    };
    #Display;
    #Input;
    #FrameCounter;
    #FrameInterval;
    #TickInterval;
    #loadingCallback;
    #notifyCallback;
    #ActivePhase;
    #clientUserID;
    constructor (clientUserID, loadingCallbackFn, notifyCallbackFn) {
        // load a context if one doesn't exist already
        if (!Main.#AudioCtx) Main.#loadAudioContext();
        super(Main.#AudioCtx);
        this.#clientUserID = clientUserID;
        this.#init(loadingCallbackFn, notifyCallbackFn);
        this.#initAssetTable();
        this.#load()
            .then(() => this.#setupEvents())
            .then(() => this.resolveLoad(this))
            .catch((error) => this.rejectLoad(error));
    }

    #init (loadingCallback, notifyCallbackFn) {
        this.#loadingCallback = loadingCallback;
        this.#notifyCallback = notifyCallbackFn;
        this.#Display = new AppCanvas(window.appCanvas, window, Main.COORDINATE_PLANE_SIZE);
        this.#FrameCounter = new FrameCounter(30);
        this.#FrameInterval = new Interval(1000 / this.constructor.SETTINGS.FPS);
        this.#TickInterval = new Interval(this.constructor.SETTINGS.TICKSPEED);
        this.#Input = new InputListener(this.Display, this.constructor.SETTINGS.CLICK_DURATION_MS, {}, {});
        this.flags.DEBUG = false;
    }
    #initAssetTable () {
        const { AssetType } = Main;
        const { AssetTable } = this;
        // Images
        AssetTable.moveBtn = [AssetType.Image, undefined, "/assets/interface/buttons/move-button.png"];
        AssetTable.selectBtn = [AssetType.Image, undefined, "/assets/interface/buttons/select-button.png"];
        AssetTable.fireBtn = [AssetType.Image, undefined, "/assets/interface/buttons/fire-button.png"];
        AssetTable.replayBtn = [AssetType.Image, undefined, "/assets/interface/buttons/replay-button.png"];
        AssetTable.skipBtn = [AssetType.Image, undefined, "/assets/interface/buttons/replay-button.png"]; // [!] placeholder
        AssetTable.hideActiveBtn = [AssetType.Image, undefined, "/assets/interface/buttons/hide-button-active.png"];
        AssetTable.hideInactiveBtn = [AssetType.Image, undefined, "/assets/interface/buttons/hide-button-inactive.png"];
        // Audio
        AssetTable.fire = [AssetType.Audio, undefined, "fire", "/assets/sfx/fire.mp3"];
        AssetTable.blast = [AssetType.Audio, undefined, "blast", "/assets/sfx/blast.mp3"];
        AssetTable.bouncer = [AssetType.Audio, undefined, "bouncer", "/assets/sfx/bouncer-collision.wav"];
        AssetTable.tilePing = [AssetType.Audio, undefined, "tilePing", "/assets/sfx/tile-ping.mp3"];
        AssetTable.tileSelect = [AssetType.Audio, undefined, "tileSelect", "/assets/sfx/tile-select.mp3"];
        // Fonts
        AssetTable.defaultFont = [AssetType.Font, undefined, "Michroma", "/assets/interface/fonts/Michroma/Michroma-Regular.ttf"];
        AssetTable.altFont = [AssetType.Font, undefined, "Lexend", "/assets/interface/fonts/Lexend/Lexend-VariableFont_wght.ttf"];
        // Spritesheets
        AssetTable.muzzleFlash = [AssetType.Sprite,
            function (vfx) { vfx.origin.apply(vfx.rawSize.x / 2, vfx.rawSize.y) },
            "/assets/blast/muzzleflash_ss_140x162.png", 140, 162, 25];
        AssetTable.explosion = [AssetType.Sprite,
            function (vfx) {
                vfx.width = 600;
                vfx.origin.apply(
                    vfx.rawSize.x * .5,
                    vfx.rawSize.y * .75
                );
            },
            "/assets/blast/explosion_ss_512x512.png", 512, 512, 25];
    }
    async #load () {
        const defualtFontKey = "altFont";
        this.loadAsset("defaultFont");
        this.loadAsset("altFont");
        await this.AssetPool.onload;
        this.store.DEFAULT_FONT = this.AssetPool.get(defualtFontKey);
        this.store.FONT_SIZE = parseFloat(window.getComputedStyle(document.documentElement).fontSize);
    }
    #setupEvents () {
        this.Events.addEventListener("LOADING", (data) => this.#loadingCallback?.(data));
        this.Events.addEventListener("NOTIFY", ({message = "", severity = 0, timeout = Main.SETTINGS.NOTIF_DURATION_MS}) => {
            let log = console.info;
            if (severity === -2)
                log = console.error;
            else if (severity === -1)
                log = console.warn;
            else if (severity === 1)
                log = console.log;
            log(`NOTIFY: ${message}`);
            this.#notifyCallback?.(message, severity, timeout);
        });
    }
    #drawFramerate () {
        const { cursor, size } = this.Display;
        cursor.save();
        cursor.fixed = true;
        cursor.textBaseline = "top";
        cursor.textAlign = "end";
        cursor.fillStyle = "red";
        cursor.font = `24px ${this.store.DEFAULT_FONT.family}`;
        cursor.fillText(this.FrameCounter.fps, size.x - 10, size.y - 10);
        cursor.restore();
    }

    async loadCreatePhase (maps) {
        const { Create } = await import("./phases/Create.js");
        const phase = new Create(this, maps);
        await phase.onload;
        this.Phases.Create = phase;
        return phase;
    }
    async loadRoundPhase (lobbyData, turnData, lobbyid, firstTurn) {
        const { Round } = await import("./phases/Round.js");
        const phase = new Round(this, this.clientID, lobbyData, turnData, lobbyid, firstTurn);
        await phase.onload;
        this.Phases.Round = phase;
        return phase;
    }
    async loadJoinPhase (lobbyData, isHost = false) {
        const { Join } = await import("./phases/Join.js");
        const phase = new Join(this, this.clientID, lobbyData, isHost);
        await phase.onload;
        this.Phases.Join = phase;
        return phase;
    }
    async loadLoadoutPhase () {
        const { Loadout } = await import("./phases/Loadout.js");
        const phase = new Loadout(this);
        await phase.onload;
        this.Phases.Loadout = phase;
        return phase;
    }
    async loop () {
        this.tick()
            .catch((err) => this.raiseCrashEvent(err));
        super.loop();
    }
    async tick () {
        if (this.state === this.constructor.STATES.Ready) {
            const drawFrame = this.FrameInterval.ready;
            if (this.ActivePhase?.state === this.constructor.STATES.Ready) {
                if (this.TickInterval.ready)
                    await this.ActivePhase?.tick?.(this.TickInterval.lastDelta);
                if (drawFrame)
                    this.ActivePhase?.animate?.(true);
            } else if (drawFrame) {
                this.Display.cursor.clear();
            }
            if (drawFrame) {
                if (this.flags.DEBUG) {
                    this.#drawFramerate();
                }
                this.FrameCounter.update();
            }
        }
    }

    get Display () { return this.#Display }
    get Input () { return this.#Input }
    get FrameCounter () { return this.#FrameCounter }
    get FrameInterval () { return this.#FrameInterval }
    get TickInterval () { return this.#TickInterval }
    get Phases () { return this.#Phases }
    get ActivePhase () { return this.#ActivePhase }
    set ActivePhase (phase) {
        if (!phase.isPhase) throw new Error(`[${typeString(this)}]: Expected Phase, got ${typeString(phase)}`);
        if (this.ActivePhase?.isPhase) this.ActivePhase.reset();
        this.#ActivePhase = phase;
        this.Input.pointer.callbacks = phase.Interface;
        this.Display.cursor.planeSize.apply(phase.Plane.size);
        phase.start();
        return phase;
    }
    get clientID () { return this.#clientUserID }
}
