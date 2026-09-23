import { lobbyHasPlayer, lobbyIsWaiting, getTerrainUrl, stageUpdate } from "@server/lib/lobby/manage.js";
import { CONNECTION_URL, CONNECTION_KEY, generateChannelID } from "@server/lib/supabase/client.js";
import * as Responses from "@server/lib/responses.js";

const DEV_PROD = process.env.NODE_ENV === "development";

export async function GET (request) {
    try {
        const { searchParams } = new URL(request.url);
        const lobbyid = searchParams.get("lobbyid");
        const playerid = searchParams.get("userid");
        const isParticipant = await lobbyHasPlayer(lobbyid, playerid);
        if (isParticipant) {
            const { url, ttl } = await getTerrainUrl(lobbyid);
            const realtimeID = generateChannelID(lobbyid);
            return Response.json({
                terrain: { url, ttl },
                websocket: {
                    url: CONNECTION_URL,
                    key: CONNECTION_KEY,
                    id: realtimeID + "_ROUND"
                }
            });
        } else {
            return new Response("Players must be in lobby.", {status: 403});
        }
    } catch (error) {
        return Responses.error(error);
    }
}

export async function POST (request) {
    try {
        const { userid: playerid, lobbyid, keep = false } = await request.json();
        const isParticipant = await lobbyHasPlayer(lobbyid, playerid);
        const isWaiting = await lobbyIsWaiting(lobbyid);
        if (isWaiting) {
            return new Response("Lobby must be started to stage updates", {status: 403});
        } else if (isParticipant) {
            const result = await stageUpdate(lobbyid, !keep);
            return Response.json(result);
        } else {
            return new Response("Players must be in lobby to participate", {status: 403});
        }
    } catch (error) {
        return Responses.error(error);
    }
}
