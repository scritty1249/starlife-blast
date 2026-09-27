import { startLobby } from "@server/lib/lobby/manage.js";
import * as Responses from "@server/lib/responses.js";

export async function POST (request) {
    try {
        const { hostid, lobbyid } = await request.json();
        const success = await startLobby(lobbyid, hostid);
        if (success) {
            return Response.json({ success });
        } else {
            return success === null
                ? new Response("Conditions not met to start lobby.", {status: 403})
                : Response.json({error: "Failed to start lobby - database error"}, {status: 500});
        }
    } catch (error) {
        return Responses.error(error);
    }
}
