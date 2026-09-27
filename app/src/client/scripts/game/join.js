import { ENDPOINT, joinLobby } from "../api/api.js";
import { LobbyEventListener } from "../websocket.js";

const RETRY_MIN_TIMEOUT_MS = 2000;
let requestLock = false;

export default async function init (mainController, Discord, lobby, lobbyid, isHost, websocketPayload) {
    mainController.Events.raiseEvent("LOADING", {hide: false, message: `Loading participants`});
    const phase = await mainController.loadJoinPhase(lobby, isHost);
    const ws = new LobbyEventListener(websocketPayload.key, websocketPayload.id, Discord.user.id);
    const userprofile = Discord.profiles.get(Discord.user.id);
    phase.Events.addEventListener("JOIN", ({team}) => joinButtonHander(phase, lobbyid, team, userprofile, mainController.Events.raiseEvent, ws, true), { once: false });
    phase.Events.addEventListener("DEFECT", ({team}) => joinButtonHander(phase, lobbyid, team, userprofile, mainController.Events.raiseEvent, ws, false), { once: false });
    phase.Events.addEventListener("START", async () => {
        try {
            if (requestLock) {
                mainController.Events.raiseEvent("NOTIFY", {severity: 1, message: "Sending requests too fast! Please wait...", timeout: RETRY_MIN_TIMEOUT_MS});
                return;
            }
            requestLock = true;
            mainController.Events.raiseEvent("LOADING", {hide: false, message: "Starting lobby"});
            const success = await startLobby(lobbyid, Discord.user.id);
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
        } finally {
            requestLock = false;
        }
    }, { once: false });
    ws.attach("JOINED", async (payload) => {
        console.debug("Recieved join event from peer: ", payload);
        const success = await phase.addNewPlayer(payload.player.userid, payload.player.avatar, payload.teamid);
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

async function joinButtonHander (phase, lobbyid, teamid, userprofile, eventCallback, websocket, isNew = true) {
    const subjectStr = isNew ? "lobby" : "team";
    const successStr = isNew ? `Lobby ${lobbyid}` : `Team ${teamid}`;
    const errorStr = isNew ? `joining the lobby` : `changing teams`;
    const apiMethod = isNew ? joinLobby : changeTeam;
    const apiArg = isNew ? userprofile : userprofile.userid;
    try {
        if (requestLock) {
            eventCallback("NOTIFY", {severity: 1, message: "Sending requests too fast! Please wait...", timeout: RETRY_MIN_TIMEOUT_MS});
            return;
        }
        requestLock = true;
        eventCallback("LOADING", {hide: false, message: `Joining ${subjectStr}`});
        const success = await apiMethod(lobbyid, teamid, apiArg);
        eventCallback("LOADING", {hide: true});
        if (success) {
            console.info(`${successStr} joined`);
            websocket.send("JOINED", { player: userprofile, teamid: team });
            await phase.addNewPlayer(userprofile.userid, userprofile.avatar, teamid);
            eventCallback("NOTIFY", {severity: 1, message: `Joined ${subjectStr}.`, timeout: -1});
        } else {
            eventCallback("NOTIFY", {severity: -2, message: `Something went wrong while ${errorStr}. Close the activity and try again in ${(RETRY_MIN_TIMEOUT_MS / 1000).toFixed(1)}s.`, timeout: RETRY_MIN_TIMEOUT_MS + 500});
            setTimeout(() => phase.setJoinButtonVisibility(true), RETRY_MIN_TIMEOUT_MS);
        }
    } catch (err) {
        console.error(err);
        eventCallback("LOADING", {hide: false, message: "Fatal error", error: true});
        ws.disconnect();
    } finally {
        requestLock = false;
    }
}

async function startLobby (lobbyid, hostid) {
    const response = await fetch(ENDPOINT + "/lobby/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({lobbyid, hostid}),
    });
    if (response.ok) {
        const { success = false } = await response.json();
        return success;
    }
    return false;
}

async function changeTeam (lobbyid, teamid, userid) {
    const response = await fetch(ENDPOINT + "/lobby/team/change", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({lobbyid, userid, teamid}),
    });
    if (response.ok) {
        const { success = false } = await response.json();
        return success;
    }
    return false;
}