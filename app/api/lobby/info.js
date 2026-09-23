import { exportLobby } from "@server/lib/lobby/manage.js";
import { CONNECTION_URL, CONNECTION_KEY, generateChannelID } from "@server/lib/supabase/client.js";
import * as Responses from "@server/lib/responses.js";

const DEV_PROD = process.env.NODE_ENV === "development";

export async function GET (request) {
    try {
        const { searchParams } = new URL(request.url);
        const lobbyid = searchParams.get("lobbyid");
        const hostid = searchParams.get("userid") ?? undefined;
        const { lobby, ishost } = await exportLobby(lobbyid, hostid);
        const realtimeID = generateChannelID(lobbyid);
        return Response.json({
            lobby: lobby,
            ishost: ishost,
            websocket: {
                url: CONNECTION_URL,
                key: CONNECTION_KEY,
                id: realtimeID + "_LIMBO"
            }
        });
    } catch (error) {
        return Responses.error(error);
    }
}
