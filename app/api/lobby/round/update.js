import { verifyToken, commitUpdate } from "@server/lib/lobby/manage.js";
import * as Responses from "@server/lib/responses.js";

export async function POST (request) {
    try {
        const { token, lobbyid, players = {} } = await request.json();
        const now = Date.now() / 1000;
        if (await verifyToken(lobbyid, token, now)) {
            await commitUpdate(lobbyid, token, players);
            return new Response();
        } else {
            return new Response("Invalid token", {status: 403});
        }
    } catch (error) {
        return Responses.error(error);
    }
}
