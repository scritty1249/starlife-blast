import { createLobby } from "@server/lib/lobby/manage.js";
import * as Responses from "@server/lib/responses.js";

export async function POST (request) {
    try {
        const { player, mapid, channelid, teamsize, teamcount } = await request.json();
        const lobbyid = await createLobby(player, channelid, mapid, teamsize, teamcount);
        return Response.json({ lobbyid });
    } catch (error) {
        return Responses.error(error);
    }
}
