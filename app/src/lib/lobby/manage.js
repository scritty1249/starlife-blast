import * as BLOB from "../storage/blob.js";
import * as KV from "../storage/kv.js";
import { Snowflake } from "../snowflake.js";
import { STATUS } from "./properties.js";
import { createPlayer } from "./player.js";
import { generateToken } from "../token.js";

const SNOWFLAKE = new Snowflake(0);
const STAGING_TTL = 60; // seconds
const DOWNLOAD_TTL = 180; // seconds

export function generateTerrainPath (lobbyid) {
    return `terrain/lobbies/${lobbyid}/terrain.bin`;
}

function generateStagedTerrainPath (lobbyid, token) {
    return `terrain/staging/${lobbyid}/terrain-${token}.bin`;
}

function generateMapPath (mapid) {
    return `terrain/MASTER/${mapid}.bin`;
}

function sortTurnOrder (players) {
    const teams = Object.entries(players).reduce((groups, [id, player]) => {
        const team = player.data?.team || "0";
        if (!groups[team]) {
            groups[team] = [];
        }
        groups[team].push(id);
        return groups;
    }, {});
    const teamNames = Object.keys(teams).sort();
    teamNames.forEach((team) => teams[team].sort());
    const turnOrder = [];
    let doSort = true;
    let round = 0;
    while (doSort) {
        doSort = false;
        for (const teamName of teamNames) {
            const roster = teams[teamName];
            if (roster.length > 0) {
                const player = roster.shift(); 
                turnOrder.push(player);
                doSort = true; 
            }
        }
        round++;
    }
    return turnOrder;
}

async function generateTurnOrder (lobbyid) {
    const players = (await KV.get(lobbyid, "players"))?.players ?? {};
    const turnOrder = sortTurnOrder(players);
    return turnOrder || [];
}

export async function lobbyHasPlayer (lobbyid, playerid) {
    if (!lobbyid || !playerid) return null;
    return await KV.exists(lobbyid, `players.${playerid}`)
}

export async function lobbyIsWaiting (lobbyid) {
    if (!lobbyid) return null;
    return (await KV.get(lobbyid, "state"))?.state === STATUS.WAITING;
}

export async function startLobby (lobbyid, hostid) {
    if (!lobbyid || !hostid) return null;
    const order = await generateTurnOrder(lobbyid);
    const result = await KV.startLobby(lobbyid, hostid, order);
    return Boolean(result);
}

export async function startFullLobby (lobbyid) {
    if (!lobbyid) return null;
    const order = await generateTurnOrder(lobbyid);
    const result = await KV.startFullLobby(lobbyid, order);
    return Boolean(result);
}

export async function isLobbyFull (lobbyid) {
    if (!lobbyid) return null;
    const result = await KV.isLobbyFull(lobbyid);
    return Boolean(result);
}

export async function closeLobby (lobbyid) {
    if (!lobbyid) return null;
    const result = await KV.closeLobby(lobbyid);
    return Boolean(result);
}

export async function exportLobby (lobbyid, hostid = undefined) {
    if (!lobbyid) return null;
    const lobby = await KV.get(lobbyid);
    if (!lobby) return null;
    const teams = Array.from(Object.keys(lobby.team_inc));
    return {
        ishost: hostid && hostid === lobby.host_player,
        lobby: {
            players: lobby.players,
            state: lobby.state,
            turns: lobby.turn_count,
            teams: teams,
            teamsize: lobby.team_size,
            channelid: lobby.channelid,
            turnorder: lobby.player_order || []
        }
    }
}

export async function getTerrainUrl (lobbyid) {
    const key = generateTerrainPath(lobbyid);
    const expires = Math.floor(Date.now() / 1000) + DOWNLOAD_TTL;
    const url = await BLOB.downloadUrl(key, DOWNLOAD_TTL);
    return {
        url,
        ttl: expires - Math.ceil(Date.now() / 1000)
    };
}

export async function addPlayer (lobbyid, playerProfile, team) {
    if (!lobbyid || !team || !playerProfile?.userid) return false;
    const playerInstance = createPlayer(playerProfile.userid, playerProfile.name, playerProfile.avatar, team);
    const result = await KV.addPlayer(lobbyid, team, playerInstance);
    return Boolean(result);
}

export async function removePlayer (lobbyid, userid) {
    if (!lobbyid || !userid) return false;
    const result = await KV.removePlayer(lobbyid, userid);
    return Boolean(result);
}

export async function changePlayerTeam (lobbyid, userid, team) {
    if (!lobbyid || !team || !userid) return false;
    const result = await KV.changePlayerTeam(lobbyid, userid, team);
    return Boolean(result);
}

export async function createLobby (playerProfile, channelid, mapid, teamsize, teamcount) {
    const teamCount = teamcount > 1 ? teamcount : 2;
    const teamSize = teamsize || 1;
    const lobbyid = SNOWFLAKE.generate();
    const teamsMap = {};
    for (let i = 0; i < teamCount; i++) {
        teamsMap[i.toString()] = i ? 0 : 1;
    }
    const playerInstance = createPlayer(playerProfile.userid, playerProfile.name, playerProfile.avatar, "0");
    const terrainPath = generateTerrainPath(lobbyid);
    const mapPath = generateMapPath(mapid);
    const res = BLOB.copy(mapPath, terrainPath);
    const result = KV.create(lobbyid, {
        state: STATUS.WAITING,
        players: { [playerProfile.userid]: playerInstance },
        terrain: terrainPath,
        team_size: teamSize,
        team_count: teamCount,
        channelid: channelid,
        // internal use
        host_player: playerProfile.userid,
        team_inc: teamsMap,
        player_limit: teamSize * teamCount,
        update_token: "",
        update_expires: -1, // seconds
        turn_count: 0
    });
    if (await result === null) throw new Error("Failed to create lobby");
    await res;
    console.info("Created lobby " + lobbyid);
    return lobbyid;
}

export async function deleteLobby (lobbyid) {
    try {
        const terrainPath = generateTerrainPath(lobbyid);
        await Promise.all([
            KV.remove(lobbyid),
            BLOB.remove(terrainPath)
        ]);
        console.info("Deleted lobby " + lobbyid);
        return true;
    } catch (error) {
        console.error("Failed to delete lobby " + lobbyid)
        return false;
    }
}

// part 1 of atomic operation
// stage terrain update, drop changes if part 2 of operation is not completed in time
export async function stageUpdate (lobbyid, terrainchanged) {
    const token = generateToken();
    const ttlms = Date.now() + (STAGING_TTL * 1000);
    const ttl = Math.floor(ttlms / 1000);
    const result = { token };
    let update;
    if (terrainchanged) {
        const stagedPath = generateStagedTerrainPath(lobbyid, token);
        const url = await BLOB.uploadUrl(stagedPath, STAGING_TTL);
        await KV.update(lobbyid,
            "update_token", token,
            "update_expires", ttl
        );
        result.url = url;
    } else {
        await KV.update(lobbyid,
            "update_token", token,
            "update_expires", -1
        );
    }
    const remainingTtl = Math.floor((ttlms - Date.now()) / 1000);
    result.ttl = remainingTtl;
    if (remainingTtl <= 0) {
        console.warn(`Returning a staging TTL of ${remainingTtl}. Is staging duration limit too small?`);
    }
    return result;
}

// part 2 of atomic update
// commit changes in S3 Bucket, then upload player details to DynamoDB
export async function commitUpdate (lobbyid, token, players) {
    if (!lobbyid || !token || !players) return [false, false];
    const jobs = [];
    // commit staged terrain in s3 bucket ASAP, before it expires
    const stagedPath = generateStagedTerrainPath(lobbyid, token);
    const terrainPath = generateTerrainPath(lobbyid);
    if (await BLOB.exists(stagedPath))
        jobs.push(BLOB.copy(stagedPath, terrainPath));
    jobs.push(KV.commitLobbyTurn(lobbyid, players));
    await Promise.all(jobs);
}

// now expected in seconds
export async function verifyToken (lobbyid, token, now) {
    const { update_token, update_expires } = await KV.get(lobbyid, "update_token", "update_expires");
    return update_token === token && now <= update_expires;
}
