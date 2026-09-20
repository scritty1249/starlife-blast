import { AmmoType } from "../core/projectile/AmmoType.js";
import { Vector } from "../core/math/Vector.js";
import { Color } from "../core/math/Color.js";
import { Circle } from "../core/geometry/Circle.js";
import { Blast } from "../core/projectile/blast/Blast.js";
import { Projectile } from "../core/projectile/Projectile.js";
import { Properties } from "../core/projectile/collision/Properties.js";
import { computeBounce, createBlasts } from "../core/projectile/collision/Behaviors.js";

export default class Digger extends AmmoType {
    static NAME = "Digger";
    static IMPORT = "Digger";
    static collisionCallback (point, normal, collisionFlags) {
        const { projectile } = this;
        const direction = projectile.current.velocity.normalize();
        const doBlast = normal === undefined || normal.y >= 0 // only apply blasts and count bounces if normal is not negative (colliding surface faces up)
            || (collisionFlags & Properties.PLAYER); // or if hitting a player
        if (!(collisionFlags & Properties.STOP) && this.userData.bounces < this.userData.maxBounces) {
            if (doBlast) {
                // update projectile
                const reflection = projectile.current.velocity.apply(0,
                        175 * (doBlast ? 1 : -1)
                    ).clone();
                projectile.drag = 0.002;
                projectile.acceleration.y = 300;
                const displace = normal
                    .mul(Math.max(...projectile.shape.getBoundingBox().size) / 2);
                projectile.applyPosition(projectile.position.add(displace));
                this.userData.bounces++;
            } else {
                const { reflect } = computeBounce.call(this, normal);
                projectile.current.velocity.apply(reflect.mul(this.userData.ricochetVelocityScaleMultipler, true));
                // if it's already created a blast (bounce was counted), scale velocity mulitplier more
                if (this.userData.bounces) this.userData.ricochetVelocityScaleMultipler *= this.userData.ricochetVelocityScaleMultipler;
                this.userData.ricochetVelocityScaleMultipler *= this.userData.ricochetVelocityScaleMultipler;
            }
            // callback
            this.userData.onBounce();
            this.userData.onBounceCallback?.();
        } else {
            projectile.current.velocity.mul(0, true);
        }
        if (doBlast) createBlasts.call(this);
    }
    static onBounce () {} // override, don't modify cosmetically
    static onBounceCallback () {} // override, don't play bounce sfx
    static blastRadius = 40;
    static maxBounces = 4;
    static initalSpeed = 500;
    static drag = 0.003;
    static radius = 8;
    static glowColor = new Color(210, 165, 0);
    static mainColor = new Color(200, 90, 0);
    constructor (origin, angle, power = 1, resolution = 1) {
        super(origin, angle, power, resolution);
        // geometry config
        const { initalSpeed, drag, radius, ambient, blastRadius, glowColor, mainColor } = this.constructor;
        const acceleration = this.constructor.acceleration.clone();
        // convert params for Projectile(s)
        const velocity = Vector.fromAngle(angle).mul(400 * power);
        // init geometry
        const shape = new Circle(radius, origin);
        const projectile = new Projectile(origin, velocity, acceleration, drag, shape);
        projectile.ambient.apply(ambient);
        projectile.glowColor.apply(glowColor);
        projectile.mainColor.apply(mainColor);
        const hitbox = [new Blast(new Circle(blastRadius), 0, 20)];
        // generate stages
        const stage = this.newStage().newStage(projectile);
        stage.userData = { hitbox,
            bounces: 0,
            maxBounces: this.constructor.maxBounces,
            onBounce: this.constructor.onBounce.bind(stage),
            onBounceCallback: this.constructor.onBounceCallback.bind(stage),
            bounceVelocityMultiplier: this.constructor.bounceVelocityMultiplier,
            bounceGlowReduction: this.constructor.bounceGlowReduction,
            ricochetVelocityScaleMultipler: .5 // slows down the projectile if bounced off any surface that isn't the ground (discourage repeatedly banking this projectile off of walls)
        };
        stage.collisionCallback = this.constructor.collisionCallback;
    }
}
