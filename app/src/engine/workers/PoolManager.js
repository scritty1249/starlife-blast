import {
    Terrain,
    generateUUID,
    sortBlastGroups,
    BlastInterval,
    AmmoMap
} from "../core/Core.js";
import { CanvasCache } from "./pool/Core.js";
export class PoolManager {
    #pool;
    constructor(workerPool) {
        this.#pool = workerPool;
    }

    async drawTerrain (canvasID, terrainID) {
        await this.#pool.post(
            "DRAWTERRAIN",
            {
                canvas: canvasID,
                terrain: terrainID,
            },
            [],
            [canvasID, terrainID],
        );
        return;
    }
    async drawNewTerrain (terrain, canvasWidth, canvasHeight) {
        const uuid = generateUUID();
        const canvasID = `${uuid}_c`;
        const canvasJob = this.#pool.createCache(new CanvasCache(canvasWidth, canvasHeight, canvasID));
        const terrainPayload = terrain.Float32();
        await canvasJob;
        await this.#pool.post(
            "DRAWTERRAIN",
            {
                canvas: canvasID,
                terrain: terrainPayload,
            },
            terrainPayload.buffers,
            [canvasID],
        );
        await this.#pool.pullCache(canvasID, false);
        const cache = this.#pool.cache[canvasID];
        delete this.#pool.cache[canvasID];
        return cache;
    }
    // colliders are expected to all be Polygons or Cache IDs
    async traceAmmo (ammo, increment, limit, terrain, colliders) {
        const encodedTerrain = terrain?.isTerrain ? terrain.Float32() : terrain;
        const encodedColliders = colliders.map(collider =>
            collider?.isPolygon ? collider.Float32(collider.depth) : collider,
        );
        const buffers =
            encodedColliders
                .filter(c => typeof c !== "string")
                ?.map?.(({ buffers }) => buffers)
                ?.flat?.(1) || [];
        const caches = encodedColliders.filter(c => typeof c === "string");
        if (typeof encodedTerrain === "string") caches.push(encodedTerrain);
        else buffers.push(...encodedTerrain.buffers);
        const payload = {
            increment,
            limit,
            ammoImport: ammo.constructor.IMPORT,
            params: ammo.encode(),
            terrain: encodedTerrain,
            collisions: encodedColliders,
        };
        const landing = await this.#pool.post(
            "TRACEAMMO",
            payload,
            buffers,
            caches,
        );
        return AmmoMap.decode(landing);
    }
    // cuts are expected to all be Polygons or Cache IDs
    async cutTerrain (
        terrainID,
        cuts = [],
        pullCache = true,
        destID = undefined,
    ) {
        const dest = destID || terrainID;
        const encodedCuts = cuts.map(collider =>
            collider?.isPolygon ? collider.Float32(collider.depth) : collider,
        );
        const buffers =
            encodedCuts
                .filter(cut => typeof cut !== "string")
                ?.map?.(({ buffers }) => buffers)
                ?.flat?.(1) || [];
        const caches = encodedCuts.filter(cut => typeof cut === "string");
        caches.push(terrainID);
        if (dest !== terrainID && this.#pool.cacheAt(dest)) caches.push(dest);
        const payload = {
            dest,
            source: terrainID,
            cuts: encodedCuts,
            callback: pullCache,
        };
        const data = await this.#pool.post(
            "CUTTERRAIN",
            payload,
            buffers,
            caches,
        );
        return !pullCache || Terrain.fromObject(data.terrain);
    }
    async renderBlastIntervals (terrainID, planeSize, ...blasts) {
        // cuts blasts, and returns a Promise<Array> of image data, for each state of the terrain after the blasts (in order)
        // blast structure: { shape: Polygon, delay: Number (milliseconds), damage: Number }
        const jobID = generateUUID();
        if (blasts.length === 0) {
            const terrain = this.#pool
                .pullCache(terrainID, false)
                .then(() => this.#pool.cache[terrainID].terrain);
            return [new BlastInterval(0, await terrain)];
        } else if (blasts.length === 1) {
            const terrain = this.cutTerrain(terrainID, [
                blasts[0].shape.Polygon(1),
            ]);
            const canvasID = `${terrainID}_c0_${jobID}`;
            const canvasJob = this.#pool.createCache(
                new CanvasCache(planeSize.x, planeSize.y, canvasID),
            );
            const frame = terrain
                .then(() => canvasJob)
                .then(() => this.drawTerrain(canvasID, terrainID))
                .then(() => this.#pool.pullCache(canvasID, true))
                .then(() => this.#pool.cache[canvasID]);
            const delay = blasts[0].delay || 0;
            const intervals =  [new BlastInterval(
                delay,
                await terrain,
                await frame,
                blasts
            )];
            // cleanup
            this.destroyCache(canvasID);
            return intervals;
        } else {
            // group blasts that occur at the same time, draw these onto the same canvas
            const blastGroups = sortBlastGroups(blasts);
            // promises
            const cutJobs = [];
            const drawJobs = [];
            // temporary cache IDs
            const terrainIDs = [terrainID];
            blastGroups.forEach((_, i) =>
                terrainIDs.push(`${terrainID}_p${i}_${jobID}`),
            );
            const canvasIDs = Array.from(blastGroups, (_, i) => {
                const canvasID = `${terrainID}_c${i}_${jobID}`;
                const cache = new CanvasCache(
                    planeSize.x,
                    planeSize.y,
                    canvasID,
                );
                return this.#pool.createCache(cache).then(() => canvasID);
            });
            // load balanced cut operations
            for (let i = 0; i < blastGroups.length; i++) {
                const interval = blastGroups[i];
                const cuts = interval.map(({ shape }) => shape.Polygon(1));
                const prevTerrainID = terrainIDs[i];
                const currTerrainID = terrainIDs[i + 1];
                const currCanvasID = await canvasIDs[i];
                await this.cutTerrain(prevTerrainID, cuts, false, currTerrainID);
                drawJobs.push(
                    this.drawTerrain(currCanvasID, currTerrainID)
                        .then(() => this.#pool.pullCache(currCanvasID, false))
                        .then(() => this.#pool.cache[currCanvasID])
                );
                cutJobs.push(
                    this.#pool.pullCache(currTerrainID, true)
                        .then(() => this.#pool.cache[currTerrainID].terrain)
                );
                if (prevTerrainID !== terrainID)
                    this.destroyCache(prevTerrainID);
            }
            // wait for all jobs to finish
            const frames = await Promise.all(drawJobs);
            const terrains = await Promise.all(cutJobs);
            // apply final cut polygon to original cache
            await this.#pool.copyCache(
                await terrainIDs.at(-1),
                terrainID,
                false,
            );
            await this.updateCache(terrainID, true);
            // package object into easier to parse structure
            const intervals = Array.from(blastGroups, (group, i) => new BlastInterval(
                group[0].delay,
                terrains[i],
                frames[i],
                group
            ));
            // cleanup
            Promise.all(canvasIDs).then((ids) => Promise.all(ids.map((id) => this.destroyCache(id))));
            return intervals;
        }
    }
    async setCache(cache) {
        return await this.#pool.setCache(cache);
    }
    async fillCache(id, data) {
        return await this.#pool.fillCache(id, data);
    }
    async updateCache(id, clone = true) {
        await this.#pool.pullCache(id, clone);
    }
    async destroyCache(id) {
        delete this.#pool.cache[id];
        return await this.#pool.dropCache(id);
    }
    async hashCache(id) {
        return await this.#pool.hashCache(id);
    }
    terminate() {
        this.#pool.terminate();
    }

    get cache() {
        return this.#pool.cache;
    }
    get onload() {
        return this.#pool.onload;
    }
}
