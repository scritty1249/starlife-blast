import { lobbyIsWaiting, removePlayer } from "@server/lib/lobby/manage.js";
import * as Responses from "@server/lib/responses.js";

export async function POST (request) {
    try {
        const { userid, lobbyid } = await request.json();
        const isWaiting = await lobbyIsWaiting(lobbyid);
        if (isWaiting) {
            const success = await removePlayer(lobbyid, userid);
            return Response.json({ success });
        } else {
            return new Response("Cannot leave an active lobby.", {status: 403, statusText: "Cannot join an active lobby."});
        }
    } catch (error) {
        return Responses.error(error);
    }
}
