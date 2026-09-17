import { Vector } from "../math/Vector.js";
import { Mover } from "../player/round/Mover.js";
import { Properties } from "./collision/Properties.js";
import { AmmoLegend } from "./AmmoLegend.js";
import { Blast } from "./blast/Blast.js";

export class AmmoMap {
    static trace (
        ammoType, // constructor
        params, // Array
        increment, // Float
        limit, // Float
        terrain, // Terrain
        collisions // [...Polygon]
    ) {
        const ammo = ammoType.decode(...params);
        // expose and seperate polygons to use in trace loop
        const terrainPoly = terrain.polygon;
        const playerPolys = collisions.filter(({userData}) => userData.collision & Properties.PLAYER);
        playerPolys.forEach(({userData}) => {
            userData.position = Vector.fromObject(userData.position);
        });
        // setup ammo colliders
        ammo.colliders.push(terrainPoly);
        for (const collisionPoly of collisions)
            ammo.colliders.push(collisionPoly);
        ammo.applyDestruction = true;
        // save polygon states to restore after trace
        const destructiblePolys = ammo.colliders.filter(({userData}) => userData.collision & Properties.DESTRUCTION);
        const originalHoleCounts = Array.from(destructiblePolys, (poly) => poly.holes.length);
        // trace ammo
        let time = limit;
        let finished = false;
        terrainPoly.updateEdges(true); // [!] doesn't register holes, or changes to the edge hashes, unless we force update here for some reason. -KT
        let terrainHash = terrainPoly.hash;
        let blastsCount;
        while (ammo.time < limit && !finished) {
            blastsCount = ammo.blasts.length;
            // run the trace
            ammo.update(increment);
            // check if done
            if (ammo.isFinished) {
                time = ammo.time;
                finished = true;
                break;
            }
            // update player hitboxes if terrain has changed
            // [!] does not track if player dies. Need to do that - KT
            const updatedTerrainHash = terrainPoly.hash;
            if (playerPolys.length && terrainHash !== terrainPoly.hash) {
                const newBlasts = ammo.blasts.slice(blastsCount);
                for (const player of playerPolys) {
                    if (newBlasts.length && !newBlasts.some((b) => b.shape.isIntersecting(player))) continue;
                    // update positioning - account for "falling"
                    const { position, rotation, heightOffset } = player.userData;
                    const hit = Mover.computePosition(position, heightOffset, terrainPoly);
                    if (hit) {
                        const { angle, point } = hit;
                        const offset = point.sub(position);
                        player.path.forEach((pt) => pt
                            .pivot(angle - rotation, position, true)
                            .add(offset, true));
                        position.add(offset, true);
                        player.userData.rotation = angle;
                    }
                }
            }
            terrainHash = updatedTerrainHash;
        }
        destructiblePolys.forEach((poly, i) => {
            const count = originalHoleCounts[i];
            poly.holes.splice(count, poly.holes.length - count);
        });
        return new AmmoMap(finished, time, ammo.legend, ammo.blasts);
    }
    static decode (obj) {
        const { f, t, l, b } = obj;
        const legend = AmmoLegend.decode(l);
        const blasts = b.map((blast) => Blast.decode(blast));
        return new AmmoMap(f, t, legend, blasts);
    }
    static fromObject (obj) {
        const { finished, time, legend: l, blasts: b } = obj;
        const legend = AmmoLegend.fromObject(l);
        const blasts = b.map((blast) => Blast.fromObject(blast));
        return new AmmoMap(finished, time, legend, blasts);
    }
    #blasts = new Array();
    #finished = false;
    #time;
    #legend;
    constructor (finished, time, legend, blasts = undefined) {
        this.#legend = legend.clone();
        this.#time = time;
        this.#finished = finished;
        if (blasts?.length)
            for (const blast of blasts)
                this.#blasts.push(blast.clone());
    }

    encode () {
        const legend = this.legend.encode();
        const blasts = this.blasts.map((blast) => blast.encode());
        const buffers = blasts.map(({buffers}) => buffers).flat(1);
        return {
            f: this.finished,
            t: this.time,
            l: legend,
            b: blasts,
            buffers
        };
    }
    toJSON () {
        return {
            finished: this.finished,
            time: this.time,
            legend: this.legend.toJSON(),
            blasts: this.blasts.map((blast) => blast.toJSON())
        };
    }

    get isAmmoMap () { return true }
    get blasts () { return this.#blasts }
    get time () { return this.#time }
    get legend () { return this.#legend }
    get finished () { return this.#finished }
}
