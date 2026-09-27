import { printError } from "./main.js";

const DEV_FLAG = process.env.NODE_ENV === "development" || process.env.DEV_FLAG;

export function error (err) {
    printError(err);
    const message = DEV_FLAG ? err?.message : "Internal server error";
    return Response.json({error: message}, {status: 500, statusText: "Internal server error"});
}

export function invalid () {
    return Response.json({error: "Invalid or missing request content"}, { status: 422 });
}
