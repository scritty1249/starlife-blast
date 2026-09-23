import { ENDPOINT, TERRAIN_BUCKET_ROUTING_PREFIX, getSignedLobbyData, stream } from "../api/api.js";
import { LobbyEventListener } from "../websocket.js";

export default async function init (mainController, Discord, lobby, lobbyid) {
    mainController.Events.raiseEvent("LOADING", {hide: false, message: `Fetching data`});

    const lobbyData = await loadLobby(lobbyid, Discord.user.id);
    if (!lobbyData) return;
    const isAlone = Object.keys(lobby.players).length === 1;
    const turnDataBuffer = await getTurnData(lobbyData.terrain.url);
    if (!turnDataBuffer) return;
    mainController.Events.raiseEvent("LOADING", {hide: false, message: `Loading`});
    const phase = await mainController.loadRoundPhase(lobby, turnDataBuffer, lobbyid, !lobby.turns);
    let ws;
    if (!isAlone) {
        const { websocket } = lobbyData;
        ws = new LobbyEventListener(websocket.key, websocket.id, Discord.user.id);
    }
    let saveTurnLock = false;
    phase.Events.addEventListener("TURNENDED", async (changes) => {
        if (saveTurnLock) return;
        saveTurnLock = true;
        phase.isLaunchAllowed = false;
        mainController.Events.raiseEvent("NOTIFY", {severity: 0, message: "Saving turn..."});
        const { turns } = phase.Lobby;
        const success = await updateLobby(changes, lobbyid, Discord.user.id);
        if (success) {
            if (ws) ws.send("TURNENDED", { turns: turns + 1 });
            mainController.Events.raiseEvent("NOTIFY", {severity: 1, message: "Turn saved.", timeout: 2000});
        } else {
            mainController.Events.raiseEvent("NOTIFY", {severity: -2, message: "Failed to save turn! Relaunch activity and try again.", timeout: 5500});
        }
        phase.isLaunchAllowed = true;
        saveTurnLock = false;
    }, { once: !isAlone });
    if (ws) {
        ws.attach("TURNENDED", async (payload) => {
            console.debug("Recieved turn update from peer: ", payload?.turns);
            if (Number.isInteger(payload?.turns) && payload.turns > phase.Lobby.turns) {
                const ld = await loadLobby(lobbyid, Discord.user.id);
                if (!ld) return;
                const buffer = await getTurnData(ld.terrain.url);
                await phase.updateTurn(payload.turns, buffer);
            }
        });
        ws.addStateChangeListener(() => {
            console.debug("Lobby state changed");
            setPlayerOnlineStatus(ws.peers, phase.Players.values());
        });
        ws.connect();
        setPlayerOnlineStatus(ws.peers, phase.Players.values());
    }
    mainController.Events.raiseEvent("LOADING", {hide: true});
    return phase;
}

function setPlayerOnlineStatus (peers, players) {
    for (const player of players) {
        player.activeState = peers.has(player.id);
    }
}

async function loadLobby (lobbyid, userid) {
    return await getSignedLobbyData(lobbyid, userid);
}

async function getTurnData (src) {
    try {
        const url = new URL(src);
        const buffer = await stream(TERRAIN_BUCKET_ROUTING_PREFIX + url.pathname + url.search);
        return buffer;
    } catch (err) {
        console.error(err);
    }
}

async function updateLobby (changes, lobbyid, userid) {
    const staging = await fetch(ENDPOINT + "/lobby/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            lobbyid: lobbyid,
            userid: userid
        })
    });
    if (!staging.ok) {
        console.error("Failed to authenticate with staging endpoint");
        return false;
    }
    const { url: dest, token } = await staging.json();
    const url = new URL(dest);
    const blob = new Blob([changes.recording], { type: "application/octet-stream" });
    const uploadResponse = await fetch(TERRAIN_BUCKET_ROUTING_PREFIX + url.pathname + url.search, {
        method: "PUT",
        headers: { "Content-Type": "application/octet-stream" },
        body: blob
    });
    if (!uploadResponse.ok) {
        console.error("Failed upload round changes");
        return false;
    }
    const commit = await fetch(ENDPOINT + "/lobby/round/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            token: token,
            lobbyid: lobbyid,
            players: changes.players
        })
    });
    if (!commit.ok) {
        console.error("Failed to post update to commit endpoint");
        return false;
    }
    return true;
}
