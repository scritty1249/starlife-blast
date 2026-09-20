import { typeString } from "../utils/logging.js";
import { Model } from "../player/model/Model.js";
import { Profile } from "../player/Profile.js";
import { Metadata } from "../player/Metadata.js";
import { HitTotal } from "../player/HitTotal.js";
import { Actor } from "../player/Actor.js";
import { Vector } from "../math/Vector.js";

// [!] placeholder
import { Color } from "../math/Color.js";
const TEAM_COLOR = {
    ally: new Color(0, 0, 255),
    self: new Color(0, 255, 0),
    enemy: new Color(255, 0, 0)
};

// provides a View for parsing, interfacing with, and sending Lobby information
// [!] as the rest of the game's feature are added, this class will fill out more. Build around supporting it, even if it's sparse at the time of writing -KT
export class Lobby {
    // expects parsed JSON object
    static fromObject (lobbyJson) {
        try {
            return new Lobby(lobbyJson);
        } catch (error) {
            console.error(`[${typeString(this)}]: Failed to deocde and parse data\n\t`, tryStringify(lobbyJson) ?? lobbyJson);
            throw error;
        }
    }
    #Players = new Map(); // immutable
    #Teams = {}; // immutable
    #Avatars = new Set(); // immutable
    #NameRegistry = {}; // immutable
    #ModelTypes = new Set(); // immutable
    #AmmoTypes = new Set(); // mutable
    #order = new Array(); // immutable
    #teamsize = 1;
    turns = 0;
    constructor (lobbyJson) {
        this.#init(lobbyJson);
        this.#lock();
    }

    #getAffiliation (clientUserID, otherUserID) {
        const client = this.Players.get(clientUserID);
        const other = this.Players.get(otherUserID);
        return clientUserID === otherUserID
            ? "self"
            : client?.data?.team === other?.data?.team
                ? "ally"
                : "enemy";
    }
    #getModelKey (player, affiliation) {
        return `${player.data.model}.${affiliation}`;
    }
    #getModelColor (affiliation) {
        return TEAM_COLOR[affiliation];
    }
    #getModelSource (player) {
        return `/assets/tank/${player.data.model}`;
    }
    #init (lobbyJson) {
        this.#populateTeams(lobbyJson.teams);
        this.#populatePlayers(Object.values(lobbyJson.players));
        this.#populateTurnOrder(lobbyJson.turnorder);
        this.turns = lobbyJson.turns;
        this.#teamsize = lobbyJson.teamsize;
    }
    #populateTurnOrder (order) {
        for (const id of order)
            this.#order.push(id);
    }
    #populateTeams (teams) {
        try {
            for (const teamid of teams)
                this.Teams[teamid] = [];
        } catch (error) {
            console.error(`[${typeString(this)}]: Failed to populate teams. Are all objects valid?`);
            throw error;
        }
    }
    #populatePlayers (players) {
        try {
            for (const player of players) {
                const { team, ammo, model } = player.data;
                const { userid, name, avatar } = player.data.profile;
                this.Avatars.add(avatar);
                this.ModelTypes.add(model);
                this.NameRegistry[userid] = name;
                this.Players.set(userid, player);
                if (team in this.Teams) this.Teams[team].push(player);
                else console.warn(`[${typeString(this)}]: Player ${userid} does not belong to a recognized team (${team})`);
                for (const a of ammo) this.AmmoTypes.add(a);
            }
        } catch (error) {
            console.error(`[${typeString(this)}]: Failed to populate players. Are all objects valid?`);
            throw error;
        }
    }
    #lock () {
        Object.freeze(this.#Teams);
        Object.freeze(this.#Avatars);
        Object.freeze(this.#Players);
        Object.freeze(this.#NameRegistry);
        Object.freeze(this.#ModelTypes);
        Object.freeze(this.#order);
    }

    async loadAssets (clientUserID, assetPool, ammoPool, assetTypes) {
        if (!this.Players.has(clientUserID)) throw new Error(`[${typeString(this)}]: Client UserID ${clientUserID} does not exist`);
        if (assetPool && !assetPool?.isAssetPool) console.warn(`[${typeString(this)}]: ${typeString(assetPool)} is not an AssetPool`);
        if (ammoPool && !ammoPool?.isAmmoPool) console.warn(`[${typeString(this)}]: ${typeString(ammoPool)} is not an AmmoPool`);
        const loadAssets = assetPool?.isAssetPool;
        const loadAmmo = ammoPool?.isAmmoPool;
        let modelPromises = Promise.resolve();
        let ammoPromises = Promise.resolve();
        let avatarPromises = Promise.resolve();
        if (loadAssets) {
            // player models
            const modelAccentColor = new Color(255, 0, 0).toString();
            const modelAccentTolerance = 254;
            modelPromises = this.loadModelAssets(assetPool, clientUserID, modelAccentColor, modelAccentTolerance);
            // player avatars
            avatarPromises = this.loadAvatarAssets(assetPool, assetTypes.Image);
        }
        if (loadAmmo) {
            // ammo imports
            ammoPromises = this.loadAmmoModules(ammoPool);
        }
        await ammoPromises;
        await modelPromises;
        await avatarPromises;
    }
    async loadAmmoModules (ammoPool) {
        const promises = [];
        for (const ammoType of this.AmmoTypes) {
            ammoPool.add(ammoType);
            promises.push(ammoPool.onready(ammoType));
        }
        return await Promise.all(promises);
    }
    async loadAvatarAssets (assetPool, imageAssetType) {
        const promises = [];
        for (const avatar of this.Avatars) {
            assetPool.add(avatar, [imageAssetType, undefined, avatar]);
            promises.push(assetPool.onready(avatar));
        }
        return await Promise.all(promises);
    }
    async loadModelAssets (assetPool, clientUserID, accentColor, accentTolerance = 254) {
        const color = accentColor.toString();
        const promises = [];
        for (const [ id, player ] of this.Players) {
            const affiliation = clientUserID ? this.#getAffiliation(clientUserID, id) : "self";
            const modelKey = this.#getModelKey(player, affiliation);
            const modelColor = this.#getModelColor(affiliation);
            const modelSource = this.#getModelSource(player);
            const { model } = player.data;
            if (!assetPool.has(modelKey)) {
                assetPool.add(
                    modelKey,
                    [(...args) => new Model(...args), undefined, model, modelSource, { [color]: modelColor }, accentTolerance]
                );
                promises.push(assetPool.onready(modelKey));
            }
        }
        return await Promise.all(promises);
    }
    generatePlayerActors (clientUserID, assetPool, actorMap, hitpointMap, terrain = undefined) {
        if (!this.Players.has(clientUserID)) throw new Error(`[${typeString(this)}]: Client UserID ${clientUserID} does not exist`);
        if (!assetPool?.isAssetPool) throw new Error(`[${typeString(this)}]: ${typeString(assetPool)} is not an AssetPool`);
        for (const [ id, player ] of this.Players) {
            const affiliation = this.#getAffiliation(clientUserID, id);
            const modelKey = this.#getModelKey(player, affiliation);
            const model = assetPool.get(modelKey).clone(false);
            const profile = new Profile(
                player.data.profile.name,
                assetPool.get(player.data.profile.avatar).clone(false),
                id
            );
            const metadata = new Metadata(model, profile, player.data.team, player.data.ammo);
            const hittotal = HitTotal.fromObject(player.hitpoints, hitpointMap);
            const actor = new Actor(metadata, hittotal);
            actor.onload.then(() => {
                actor.Mover.Terrain = terrain;
                const invalidMsg = `[${typeString(this)}]: Invalid position from object for player ${profile.name} (${id})`;
                if (player.position) {
                    const position = Vector.fromObject(player.position);
                    if (!(
                        !position.equals(0)
                        && actor.Mover.apply(position)
                    )) console.warn(invalidMsg);
                } else console.warn(invalidMsg);
                if (player.orientation) actor.orientation = player.orientation;
                actor.rotation = player.rotation ?? Math.PI;
                actor.Aimer.power = player.power ?? 1;
            });
            actorMap.set(id, actor);
        }
    }

    get isLobby () { return true }
    get Teams () { return this.#Teams }
    get Players () { return this.#Players }
    get AmmoTypes () { return this.#AmmoTypes }
    get Avatars () { return this.#Avatars }
    get ModelTypes () { return this.#ModelTypes }
    get NameRegistry () { return this.#NameRegistry }
    get ActivePlayerID () { return this.turnorder[this.turns % this.turnorder.length] }
    get allPlayersSpawned () { return this.Players.values().every((player) => player && "position" in player) }
    get teamsize () { return this.#teamsize }
    get turnorder () { return this.#order }
}

function tryStringify (obj) {
    try {
        return JSON.stringify(obj);
    } catch {
        return undefined;
    }
}