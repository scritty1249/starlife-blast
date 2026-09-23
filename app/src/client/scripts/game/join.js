import { ENDPOINT } from "../api/api.js";
import { LobbyEventListener } from "../websocket.js";

const RETRY_MIN_TIMEOUT_MS = 2000;

export default async function init (mainController, Discord, lobby, lobbyid, isHost, websocketPayload) {
    mainController.Events.raiseEvent("LOADING", {hide: false, message: `Loading participants`});
    const phase = await mainController.loadJoinPhase(lobby, isHost);
    const ws = new LobbyEventListener(websocketPayload.key, websocketPayload.id, Discord.user.id);
    phase.Events.addEventListener("JOIN", async ({team}) => {
        try {
            mainController.Events.raiseEvent("LOADING", {hide: false, message: "Joining lobby"});
            const userprofile = Discord.profiles.get(Discord.user.id);
            const success = await joinLobby({
                player: userprofile,
                teamid: team,
                lobbyid: lobbyid
            });
            mainController.Events.raiseEvent("LOADING", {hide: true});
            if (success) {
                console.info(`Lobby ${lobbyid} joined`);
                ws.send("JOINED", { player: userprofile, teamid: team });
                await phase.addNewPlayer(userprofile.avatar, team);
                mainController.Events.raiseEvent("NOTIFY", {severity: 1, message: "Joined lobby.", timeout: -1});
            } else {
                mainController.Events.raiseEvent("NOTIFY", {severity: -2, message: `Something went wrong while joining the lobby. Close the game and try again in ${(RETRY_MIN_TIMEOUT_MS / 1000).toFixed(1)}s.`, timeout: RETRY_MIN_TIMEOUT_MS + 500});
                setTimeout(() => phase.setJoinButtonVisibility(true), RETRY_MIN_TIMEOUT_MS);
            }
        } catch (err) {
            console.error(err);
            mainController.Events.raiseEvent("LOADING", {hide: false, message: "Fatal error", error: true});
        }
    }, { once: false });
    phase.Events.addEventListener("START", async () => {
        try {
            mainController.Events.raiseEvent("LOADING", {hide: false, message: "Starting lobby"});
            const success = await startLobby({
                hostid: Discord.user.id,
                lobbyid: lobbyid
            });
            mainController.Events.raiseEvent("LOADING", {hide: true});
            if (success) {
                console.info(`Lobby ${lobbyid} started`);
                ws.send("STARTED");
                ws.disconnect();
                Discord.closeApp("Lobby started");
            } else {
                mainController.Events.raiseEvent("NOTIFY", {severity: -1, message: "Failed to start lobby.", timeout: 1500});
                setTimeout(() => phase.setStartButtonVisibility(phase.isClientHost), 1500);
            }
        } catch (err) {
            console.error(err);
            mainController.Events.raiseEvent("LOADING", {hide: false, message: "Fatal error", error: true});
        }
    }, { once: false });
    ws.attach("JOINED", async (payload) => {
        console.debug("Recieved join event from peer: ", payload);
        const success = await phase.addNewPlayer(payload.player.avatar, payload.teamid);
    });
    ws.attach("STARTED", async () => {
        console.debug("Recieved start event from peer");
        ws.disconnect();
        Discord.closeApp("Lobby started");
    });
    ws.connect();
    mainController.Events.raiseEvent("LOADING", {hide: true});
    return phase;
}

async function joinLobby (payload) {
    const response = await fetch(ENDPOINT + "/lobby/add", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
    });
    if (response.ok) {
        const { success = false } = await response.json();
        return success;
    }
    return false;
}

async function startLobby (payload) {
    const response = await fetch(ENDPOINT + "/lobby/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
    });
    if (response.ok) {
        const { success = false } = await response.json();
        return success;
    }
    return false;
}
