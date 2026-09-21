import { Main, checkCanvasBlurSupport } from "$engine/runtime/Core.js";
import { loading } from "./events/loading.js";
import { notify } from "./events/notify.js";
import { DiscordApp } from "./discord.js";
import { ENDPOINT, getLobby } from "./api/api.js";

Object.defineProperty(window, "__CANVAS_BLUR_SUPPORTED", {
    value: checkCanvasBlurSupport(),
    writable: false,
    configurable: false,
    enumerable: true
});
const LOBBY_ID_PREFIX = "LOBBY_";
export const LOBBY_STATUS = {
    CLOSED: -1,
    WAITING: 0,
    ACTIVE: 1
};

export async function load () {
    const Discord = initDiscord();
    let userid;
    if (Discord?.isDiscordApp) {
        await Discord.onload;
        userid = Discord.user.id;
    } else {
        console.warn("!!! Discord embedded environment not found");
        notify("Unable to hook Discord environment. Application may fail unexpectedly.", -1, 7000);
        userid = "";
    }
    const main = new Main(userid, loading, notify);
    await main.onload;
    window._MAIN = main; // [!] for debug

    const URL_PARAMS = new URLSearchParams(window.location.search);
    const customID = URL_PARAMS.get("custom_id") || "";
    let phase;
    if (customID && customID.startsWith(LOBBY_ID_PREFIX)) {
        const lobbyid = customID.slice(LOBBY_ID_PREFIX.length);
        console.info(`Opening invite for lobby ${lobbyid}`);
        phase = await loadLobby(lobbyid, main, Discord);
    }
    if (!phase?.isPhase) {
        const { default: init } = await import("./game/create.js");
        phase = await init(main, Discord);
    }
    main.Events.raiseEvent("LOADING", {hide: true});
    if (phase?.isPhase) main.ActivePhase = phase;
    main.Display.canvas.focus();
    main.loop();
}

function initDiscord () {
    return window.location.hostname.endsWith(".discordsays.com")
        ? new DiscordApp(ENDPOINT + "/discord/auth", [
            "identify",
            "guilds",
            "applications.commands"
        ]) : {};
}

async function loadLobby (lobbyid, mainController, Discord) {
    try {
        if (lobbyid) {
            mainController.Events.raiseEvent("LOADING", {hide: false, message: `Fetching lobby`});
            const response = await getLobby(lobbyid, Discord.user.id);
            if (!response || !response.lobby) {
                mainController.Events.raiseEvent("NOTIFY", {severity: -1, message: `The requested lobby does not exist. ID: ${lobbyid}`});
                return;
            }
            const { lobby, host } = response;
            mainController.Events.raiseEvent("LOADING", {hide: false, message: `Loading lobby menu`});
            if (lobby && "state" in lobby) {
                if (lobby.state === 1) {
                    console.debug(`Opening round for lobby ${lobbyid}`);
                    const { default: init } = await import("./game/round.js");
                    return await init(mainController, Discord, lobby, lobbyid);
                } else if (lobby.state === 0) {
                    console.debug(`Opening join screen for lobby ${lobbyid}`);
                    const { default: init } = await import("./game/join.js");
                    return await init(mainController, Discord, lobby, lobbyid, host);
                } else if (lobby.state === -1) {
                    mainController.Events.raiseEvent("NOTIFY", {severity: -1, message: `The requested lobby is has been closed. ID: ${lobbyid}`, timeout: -1});
                }
            } else {
                console.error("Server returned malformed lobby payload");
                mainController.Events.raiseEvent("LOADING", {hide: false, message: `Corrupted lobby data`, error: true});
            }
        } else {
            mainController.Events.raiseEvent("NOTIFY", {severity: -2, message: `Game invite is invalid!`, timeout: -1});
            console.error("Invalid lobby ID");
        }
    } catch (err) {
        console.error(err);
        mainController.Events.raiseEvent("NOTIFY", {severity: -2, message: `Failed to load lobby. ID: ${lobbyid}`, timeout: 5000});
    }
}