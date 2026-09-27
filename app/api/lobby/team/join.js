import { lobbyIsWaiting, addPlayer, startFullLobby } from "@server/lib/lobby/manage.js";
import * as Responses from "@server/lib/responses.js";

const DEV_PROD = process.env.NODE_ENV === "development";

export async function POST (request) {
    try {
        const { player, lobbyid, teamid } = await request.json();
        const isWaiting = await lobbyIsWaiting(lobbyid);
        if (isWaiting) {
            const success = await addPlayer(lobbyid, player, teamid);
            if (success) {
                const started = await startFullLobby(lobbyid);
                if (!started) console.warn(`Capacity for lobby ${lobbyid} filled, but failed to start automatically.`);
            }
            return Response.json({ success });
        } else {
            return new Response("Cannot join an active lobby.", {status: 403, statusText: "Cannot join an active lobby."});
        }
    } catch (error) {
        return Responses.error(error);
    }
}
