export const ENDPOINT = window.origin + "/api";

export const TERRAIN_BUCKET_ROUTING_PREFIX = "/terrain-bucket";

export async function getLobby (lobbyid, userid) {
    if (!lobbyid) return;
    const response = await fetch(ENDPOINT + `/lobby/info?lobbyid=${lobbyid}&userid=${userid}`);
    if (response.ok) {
        const { lobby = undefined, ishost: host = false, websocket = undefined } = await response.json();
        return { lobby, host, websocket };
    }
}

export async function getSignedLobbyData (lobbyid, userid) {
    if (!lobbyid || !userid) return;
    const response = await fetch(ENDPOINT + `/lobby/auth?lobbyid=${lobbyid}&userid=${userid}`);
    if (response.ok) {
        const payload = await response.json();
        return payload || undefined;
    }
}

export async function joinLobby (lobbyid, teamid, profile) {
    if (!lobbyid || !userid || !profile) return false;
    const response = await fetch(ENDPOINT + `/lobby/add`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            lobbyid, teamid, player: profile
        })
    });
    if (response.ok) {
        const { success = false } = await response.json();
        return success;
    }
    return false;
}

export async function stream (url) {
    const response = await fetch(url);
    if (!response.ok) throw new Error();
    const reader = response.body.getReader();
    const chunks = [];
    let length = 0;

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value); // Uint8Array view
        length += value.length;
    }

    const buffer = new ArrayBuffer(length);
    const view = new Uint8Array(buffer);

    let offset = 0;
    for (const chunk of chunks) {
        view.set(chunk, offset);
        offset += chunk.length;
    }
    return buffer;
}
