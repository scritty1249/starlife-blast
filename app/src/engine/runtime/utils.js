import { Lobby } from "../core/Core.js";

export const WEB_WORKER_PATH = window.__WEB_WORKER_PATH;

export function initLobby (lobbyJson) {
    return Lobby.fromObject(lobbyJson);
}

export function checkCanvasBlurSupport () {
    let blurSupported = false;
    if (typeof window === "undefined") return blurSupported;
    const canvas = document.createElement("canvas");
    const ctx = canvas?.getContext?.("2d");
    if (ctx && ("filter" in ctx)) {
        try {
            canvas.width = 2;
            canvas.height = 1;
            ctx.filter = "blur(1px)";
            ctx.fillStyle = "#000000";
            ctx.fillRect(0, 0, 1, 1);
            const pixelData = ctx.getImageData(1, 0, 1, 1).data;
            blurSupported = pixelData[0] > 0
                || pixelData[1] > 0
                || pixelData[2] > 0
                || pixelData[3] > 0;
        } catch (e) {
            blurSupported = false;
        } finally {
            canvas.width = 0;
            canvas.height = 0;
        }
    }
    return blurSupported;
}
