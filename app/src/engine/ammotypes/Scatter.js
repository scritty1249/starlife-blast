import { AmmoType } from "../core/projectile/AmmoType.js";
import { Vector } from "../core/math/Vector.js";
import { Color } from "../core/math/Color.js";
import { Circle } from "../core/geometry/Circle.js";
import { Ray } from "../core/math/Ray.js";
import { Beam } from "../core/projectile/Beam.js";
import { Shot } from "../core/projectile/Shot.js";
import { Blast } from "../core/projectile/blast/Blast.js";
import { Projectile } from "../core/projectile/Projectile.js";
import { Properties, Affiliation } from "../core/projectile/collision/Properties.js";
import { createBlasts } from "../core/projectile/collision/Behaviors.js";
import { wrapAngle } from "../core/math/utils.js";

const TWO_PI = 2 * Math.PI;
const DOWN_ANGLE_OFFSET = -3 * Math.PI / 2;

export default class Scatter extends AmmoType {
    static beamUpdateCallback (seconds) {
        if (this.isFinished)
            this.projectile.tail.pop();
    }
    static beamPreUpdateCallback (seconds) {
        const { target, range, driftX } = this.userData;
        if (driftX === 0 || !target?.isVector) return;
        const { projectile } = this;
        const { position, velocity, force } = projectile;
        const distanceX = target.x - position.x;
        const curveFactor = (velocity.y > 0 && position.y > target.y) || (velocity.y < 0 && position.y < target.y)
            ? -0.4
            : 1;
        const signX = Math.sign(distanceX);
        const driftXFactor = position.distance(target) / range;
        force.x += signX * driftX * driftXFactor * curveFactor;
    }
    static beamCollisionCallback (point, normal, collisionFlags) {
        const playerCollision = collisionFlags & Properties.PLAYER;
        if (playerCollision) return;
        this.projectile.current.velocity.mul(0, true);
        createBlasts.call(this);
    }
    static setupBeamStage (beamStage, target) {
        const position = this.projectile.position.clone();
        const time = this.time;
        const range = position.distance(target);
        beamStage.shots.forEach((stage) => {
            stage.projectile.applyOrigin(position);
            stage.blastTimeOffset += time;
            stage.userData.target = target;
            stage.userData.range = range;
        });
    }
    static cancelBeamStage (beamStage) {
        const velocity = new Vector(0, 0);
        const position = this.projectile.position.clone();
        const time = this.time;
        beamStage.shots.forEach((stage) => {
            stage.projectile.applyOrigin(position, velocity);
            stage.blastTimeOffset += time;
        });
    }
    static ballCollisionCallback (point, normal, collisionFlags) {
        this.projectile.velocity.mul(0, true);
        if (collisionFlags === Properties.NONE)
            this.userData.setupBeamStage(this.userData.target.clone());
        else {
            createBlasts.call(this);
            this.userData.cancelBeamStage();
        }
    }
    static ballUpdateCallback (seconds) {
        if (!this.isTracing) return;
        const { projectile, colliders } = this;
        const { position, velocity } = projectile;
        const players = colliders.filter(({userData}) =>
            (userData.collision & Properties.PLAYER)
            && (userData.affiliation & Affiliation.ENEMY)
        );
        if (!players.length) return;
        for (let i = 0; i < players.length; i++) {
            const dest = position.clone();
            dest.y = 0;
            const ray = new Ray(position, dest);
            const hit = ray.isIntersecting(players[i].path);
            if (hit?.point) {
                this.userData.target.apply(hit.point);
                this.applyCollision(position.clone(), velocity.mul(-1).normalize(true), Properties.NONE);
                return;
            }
        }
    }
    static NAME = "Scatter"; // display name
    static IMPORT = "Scatter"; // file name (case sensitive)
    static stageCount = 2;
    static radius = 15;
    static initalSpeed = 400;
    static drag = 0.0005;
    static blastRadius = 30;
    static acceleration = new Vector(20, 0);
    static ambient = new Vector(0, -50);
    static mainColor = new Color(74, 87, 121);
    static glowColor = new Color(239, 128, 40);
    // beam properties
    static beamCount = 3;
    static beamHeadRadius = 20;
    static beamOriginRadius = 25;
    static beamLength = 1000;
    static beamRadiusScale = 0.35;
    static beamGlowRadius = 15;
    static beamCenterRadiusScale = 0.5; // radius of a beam that falls straight down
    static beamCenterGlowRadius = 20; // glow radius of a beam that falls straight down
    static beamMainColor = new Color(255, 255, 255, 1);
    static beamGlowColor = Scatter.glowColor.clone();
    // beam physics
    static beamSpread = TWO_PI - (TWO_PI / 5);
    static beamDriftX = 900;
    static beamAcceleration = new Vector(0, 75);
    static beamAmbient = new Vector(0, -600);
    static beamInitialSpeed = 400;
    static beamDrag = 0.0001;
    constructor (origin, angle, power = 1, resolution = 1) {
        super(origin, angle, power, resolution);
        const { initalSpeed, drag, radius, blastRadius, glowColor, mainColor, ambient } = this.constructor;
        const acceleration = this.constructor.acceleration.clone();
        this.transferData.target = new Vector();
        // convert params for Projectile(s)
        const velocity = Vector.fromAngle(angle).mul(initalSpeed * power);
        const ballStage = this.stages[0];
        const beamStage = this.stages[1];
        // Ball stage
        {
            const shape = new Circle(radius, origin);
            const shot = new Projectile(origin, velocity, acceleration, drag, shape);
            shot.ambient.apply(ambient);
            shot.glowColor.apply(glowColor);
            shot.tailColor.apply(shot.mainColor.apply(mainColor));
            const ballShot = ballStage.newStage(shot);
            ballShot.userData = {
                hitbox: [new Blast(new Circle(blastRadius), 0, 15)],
                setupBeamStage: this.constructor.setupBeamStage.bind(ballShot, beamStage),
                cancelBeamStage: this.constructor.cancelBeamStage.bind(ballShot, beamStage),
                target: this.transferData.target
            };
            ballShot.collisionCallback = this.constructor.ballCollisionCallback;
            ballShot.updateCallback = this.constructor.ballUpdateCallback;
        }
        // Beams stage
        {
            const {
                beamCount,
                beamSpread,
                beamOriginRadius,
                beamHeadRadius,
            } = this.constructor;
            const beamOrigin = new Vector();
            const beamShape = new Circle(beamHeadRadius, beamOrigin);
            const blastShape = new Circle(beamHeadRadius * 1.1, beamOrigin);

            this.#createBeamOrigin(beamStage, new Circle(beamHeadRadius * 2, beamOrigin), beamOrigin);

            if (beamCount === 1) {
                this.#createBeam(beamStage, beamShape, blastShape, beamOrigin, beamSpread / 2);
            } else if (beamCount >= 2) {
                const angleSpan = beamSpread / (beamCount - 1);
                for (let i = 0; i < beamCount; i++) {
                    const angle = (angleSpan * i);
                    this.#createBeam(beamStage, beamShape, blastShape, beamOrigin, angle);
                }
            }
        }
    }

    #createBeamOrigin (stage, shape, origin) {
        const {
            beamGlowColor: glowColor,
            beamMainColor: mainColor,
            beamRadiusScale: radiusScale,
            beamGlowRadius: glowRadius,
        } = this.constructor;
        const ball = new Projectile(origin, new Vector(), new Vector(), 0, shape);
        const shot = stage.newStage(ball);
        ball.tailLength = 0;
        ball.glowRadius = glowRadius;
        ball.glowColor.apply(glowColor);
        ball.tailColor.apply(ball.mainColor.apply(mainColor));
        shot.drawAfter = true;
        shot.playLaunchCallback = false;
        return shot;
    }
    // angle should be a Number, not Vector
    #createBeam (stage, shape, blastShape, origin, angle) {
        const {
            beamLength,
            beamDriftX,
            beamSpread,
            beamCenterRadiusScale,
            beamCenterGlowRadius,
            beamAcceleration: acceleration,
            beamAmbient: ambient,
            beamGlowColor: glowColor,
            beamMainColor: mainColor,
            beamRadiusScale: radiusScale,
            beamGlowRadius: glowRadius,
            beamUpdateCallback: updateCallback,
            beamPreUpdateCallback: preUpdateCallback,
            beamCollisionCallback: collisionCallback,
            beamInitialSpeed: initialSpeed,
            beamDrag: drag
        } = this.constructor;
        const halfSpread = wrapAngle(beamSpread / 2); // [!] modulo operators corrupt values (floors the value under the hood. This prevents the equality check for driftXSign). So this value must undergo the same treatment as normalizedAngle
        const normalizedAngle = wrapAngle(angle);
        const offsetAngle = wrapAngle(normalizedAngle + ((TWO_PI - beamSpread) / 2) + DOWN_ANGLE_OFFSET);
        const velocity = Vector.fromAngle(offsetAngle).mul(initialSpeed);
        const beam = new Beam(origin, velocity, acceleration, drag, shape.clone(true));
        beam.ambient.apply(ambient);
        beam.acceleration.x *= Math.abs(Math.sin(offsetAngle));
        // cosmetic
        beam.tailLength = beamLength;
        beam.tailScale = radiusScale;
        beam.glowRadius = glowRadius;
        beam.glowColor.apply(glowColor);
        beam.tailColor.apply(beam.mainColor.apply(mainColor));
        if (!(normalizedAngle < halfSpread) && !(normalizedAngle > halfSpread)) {
            beam.glowRadius = beamCenterGlowRadius;
            beam.tailScale = beamCenterRadiusScale;
        }
        // setup shot
        const shot = stage.newStage(beam, 0);
        shot.userData = {
            hitbox: [new Blast(blastShape.clone(true), 0, 10)],
            driftX: beamDriftX,
            target: this.transferData.target,
            range: 1
        };
        shot.fadeTime = 1;
        shot.preUpdateCallback = preUpdateCallback;
        shot.updateCallback = updateCallback;
        shot.collisionCallback = collisionCallback;
        shot.playLaunchCallback = false;
        return shot;
    }

    encodeTransferData () {
        return {
            target: this.transferData.target.toJSON()
        };
    }
    decodeTransferData (data) {
        this.transferData.target.apply(Vector.fromObject(data.target));
    }
}
