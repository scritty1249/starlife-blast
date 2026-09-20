import Basic from "./Basic.js";
import { Vector } from "../core/math/Vector.js";

export default class Sniper extends Basic {
    static NAME = "Sniper";
    static IMPORT = "Sniper";
    static acceleration = new Vector(10, 10);
    constructor (origin, angle, power = 1, resolution = 1) {
        super(origin, angle, power, resolution);
        const shot = this.stages[0].shots[0];
        const blast = shot.userData.hitbox[0];
        const { projectile } = shot;
        // adjust sizing
        blast.damage = 60;
        blast.shape.radius = 15;
        projectile.origin.velocity.mul(5, true);
        projectile.current.velocity.mul(5, true);
        projectile.shape.radius = 3;
        // adjust cosmetics
        projectile.glowRadius = 3;
        projectile.tailLength = 70;
    }
}
