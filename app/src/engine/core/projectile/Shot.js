import { Vector } from "../math/Vector.js";
import { Path } from "../math/Path.js";
import { equals } from "../math/utils.js";
import { Identifiable } from "../utils/tracking/Identifiable.js";
import { typeString } from "../utils/logging.js";
import { Properties } from "./collision/Properties.js";
import { getSegmentCollision } from "./collision/utils.js";
import { AmmoLegend } from "./AmmoLegend.js";

// A stage of a projectile's lifetime
export class Shot extends Identifiable {
    static getCircleCollision (position, projection, colliders = []) {
        if (!colliders?.length) return;
        if (!projection?.shape?.isCircle) throw new Error(`Invalid projection - shape must be a Circle`);
        else if (projection.shape.isEllipse) throw new Error(`Invalid projection - shape cannot be elliptical`);
        if (colliders.some(({isPolygon}) => !isPolygon)) throw new Error(`Invalid collider(s) - Polygon expected`);

        const radius = projection.shape.radii.max();
        const angles = [];
        let collision;
        let flags = 0;
        let minCoeff = 1;
        for (let cidx = 0; cidx < colliders.length; cidx++) {
            const collider = colliders[cidx];
            if (!collider.getBoundingBox().isIntersecting(projection.traversalArea)) continue;
            // getting collision flags
            const collisionFlags = collider.userData?.collision || 0;
            const allowEnter = collisionFlags & Properties.ENTER;
            const allowExit = collisionFlags & Properties.EXIT;

            const edges = collider.edges;
            for (let eidx = 0; eidx < edges.length; eidx++) {
                const edge = edges[eidx];
                const clockwise = edge.isClockwise;
                const iter = edge.pairs();
                for (let next = iter.next(); !next.done; next = iter.next()) {
                    const start = next.value;
                    const end = iter.next().value;
                    const hit = getSegmentCollision(
                        position, projection.position,
                        start, end,
                        radius, clockwise, projection.delta
                    );
                    if (hit && ((hit.entering && allowEnter) || (!hit.entering && allowExit))) {
                        if (hit.projectedCoeff <= minCoeff) {
                            minCoeff = hit.projectedCoeff;
                            collision = hit;
                            flags = collisionFlags;
                            angles.splice(0, angles.length, hit.normal);
                        } else if (equals(hit.projectedCoeff, minCoeff)) {
                            angles.push(hit.normal);
                        }
                    }
                }
            }
        }
        if (collision) {
            return {
                position: collision.position,
                point: collision.point,
                normal: Vector.average(angles).normalize(true),
                flags: flags 
            };
        }        
    }
    #projectile;
    #blasts;
    #time = 0; // global time, seperate from Projectile time
    #delayTime; // don't start updating projectile until this duration has passed
    #collisionCallback; // <bound to This> (point (contact point), normal (of colliding surface), collisionFlags) => undefined
    #updateCallback; // <bound to This> (seconds) => undefined
    #preUpdateCallback; // <bound to This> (seconds) => undefined
    #launchCallback; // <bound to This> () => undefined
    #colliders; // list of polygons that can be collided with
    #isFinished = false; // trip this flag once projectile stops moving, never set again to prevent overlapping stages
    #isStarted = false; // trip this flag once we start updating projectile, never set again to prevent tracking errors
    #applyDestruction = false; // push new blasts to collider polygon holes
    #blastTimeOffset = 0; // offset time when creating new Blasts
    #finishedPromise = Promise.withResolvers();
    #traceLegend; // when set, Shot will skip all collision checks and follow based on this
    #legend = new (AmmoLegend.Shot)(); // records data to be exported
    #sfxCallback;
    #tracer = new Path();
    #hasLaunched = false;
    #playLaunchCallback = true;
    #displayBoundingBox; // optimization- when set, will only draw projectile if bounding box intersects with it
    userData = {};
    drawAfter = false; // draw even after shot is finished
    #totalFadeTime = 0;
    #fadeTime = 0;
    constructor (projectile, delay = 0, blastsReference = [], collisionsReference = [], sfxCallbackReference = {}) {
        super();
        if (!projectile?.isProjectile) throw new Error(`[${typeString(this)}]: Invalid parameter - expected Projectile, got ${typeof projectile}`);
        this.#projectile = projectile;
        this.#delayTime = delay;
        this.#blasts = blastsReference; // by reference
        this.#colliders = collisionsReference; // by reference
        this.#sfxCallback = sfxCallbackReference; // by reference
    }

    #projectToCollision (seconds = 1) {
        const { projectile, blasts, colliders } = this;
        const projection = projectile.project(seconds);
        // Approximate if any colliders lie between current state and given projection
        const nearbyColliders = colliders.filter((collider) =>
            projection.traversalArea.isIntersecting(collider.getBoundingBox()));
        let collision;
        if (nearbyColliders.length) {
            if (projectile.shape.isCircle && !projectile.shape.isEllipse)
                collision = Shot.getCircleCollision(projectile.position, projection, colliders);
            else
                throw new Error(`[${typeString(this)}]: Cannot compute collision for non-Circle projectile shape`);
        }
        if (collision) {
            projectile.applyPosition(collision.position, false);
            this.applyCollision(collision.point, collision.normal, collision.flags);
            if (this.projectile.isStopped) return;
        }
        projectile.update(seconds);
    }
    #setFinished () { // [!] does not check if already finished. Caller is responsible for making sure this is only used once
        this.#isFinished = true;
        this.#finishedPromise.resolve();
    }
    #trackUpdate () { // [!] poorly named. Tracks data during update() calls
        this.legend.duration = this.time;
        this.tracer.push(this.projectile.position.clone());
    }
    #onLaunch () {
        this.#hasLaunched = true;
        if (this.playLaunchCallback)
            this.launchCallback?.();
        const { projectile } = this;
        if (!this.isTracing) {
            const { origin } = this.#traceLegend;
            projectile.applyOrigin(origin.position, origin.velocity);
            if (origin.position?.isVector)
                projectile.applyPosition(origin.position);
            if (origin.velocity?.isVector)
                projectile.current.velocity.apply(origin.velocity);
        }
        this.legend.setOrigin(projectile.origin.position, projectile.origin.velocity);
    }

    // point is collision/contact point
    applyCollision (point, normal, flags) {
        const { time, projectile } = this;
        this.legend.addCollision(time, flags, projectile.position, point, normal, projectile.velocity);
        this.collisionCallback?.(point, normal, flags);
        this.legend.collisions.at(-1).rebound.apply(projectile.velocity);
    }
    update (seconds) {
        try {
            if (!this.#isStarted) this.#isStarted = true;
            if (this.time <= this.delay) {
                this.time += seconds;
                return;   
            } else if (!this.#hasLaunched) {
                this.#onLaunch();
            }
            const { isStopped, projectile } = this;
            this.time += seconds;
            if (!this.#isFinished) {
                if (isStopped) {
                    if (this.#fadeTime > 0) {
                        this.#fadeTime = Math.max(0, this.#fadeTime - seconds);
                    } else {
                        this.#setFinished();
                    }
                    return;
                }
                if (this.isTracing) {
                    if (!this.#isFinished) {
                        this.preUpdateCallback?.(seconds);
                        this.#projectToCollision(seconds);
                        this.updateCallback?.(seconds);
                        this.#trackUpdate();
                    }
                } else {
                    const legend = this.#traceLegend;
                    this.preUpdateCallback?.(seconds);
                    if (legend.collisions.length > 0
                        && this.time >= legend.collisions[0].time
                    ) {
                        const { flags, position, point, velocity, normal } = legend.collisions.shift();
                        projectile.applyPosition(position, true);
                        projectile.current.velocity.apply(velocity);
                        this.applyCollision(point, normal, flags);
                    } else {
                        projectile.update(seconds, true);
                    }
                    this.updateCallback?.(seconds);
                    this.#trackUpdate();
                }
            }
        } catch (error) {
            this.#finishedPromise.reject(error);
            throw error;
        }
    }
    draw (cursor) {
        if (!this.isInsideDisplay) return;
        const { projectile, doDraw } = this;
        if (doDraw) projectile.draw(cursor);
    }
    drawGlow (cursor) {
        if (!this.isInsideDisplay) return;
        const { projectile, doDraw, hasFadeTime } = this;
        if (doDraw) {
            const alpha = hasFadeTime ? this.#fadeTime / this.#totalFadeTime : 1;
            projectile.drawTailGlow(cursor, alpha);
            projectile.drawMainGlow(cursor, alpha);
        }
    }
    drawBody (cursor) {
        if (!this.isInsideDisplay) return;
        const { projectile, doDraw, hasFadeTime } = this;
        if (doDraw) {
            const alpha = hasFadeTime ? this.#fadeTime / this.#totalFadeTime : 1;
            projectile.drawTail(cursor, alpha);
            projectile.drawShot(cursor, alpha);
        }
    }
    applyBlast (blast) {
        const hitbox = blast.clone(true);
        hitbox.shape.transform.offset.add(this.projectile.position, true);
        hitbox.shape.applyTransform();
        hitbox.delay += this.time + this.blastTimeOffset;
        this.blasts.push(hitbox);
        if (this.applyDestruction) {
            for (const collider of this.colliders) {
                if ((collider.userData.collision & Properties.DESTRUCTION)
                    && collider.getBoundingBox().isIntersecting(hitbox.shape.getBoundingBox())
                ) {
                    const poly = hitbox.shape.Polygon(1);
                    if (poly.path.isClockwise) poly.path.points.reverse();
                    collider.holes.push(poly);
                }
            }
        }
        return hitbox; // for modifying, if needed
    }
    playSfx (sfxName) {
        if (this.isTracing) return;
        if (sfxName in this.sfxCallback) this.sfxCallback[sfxName]?.();
        else console.warn(`[${typeString(this)}]: Unable to play SFX "${sfxName}" -  callback does not exist`);
    }
    traceLegend (legend) {
        this.#traceLegend = legend.clone();
    }
    // creates a fresh instance with the same Projectile, delay and collision callback
    // References, userData, update callback, launch callback, and blast time offset are not copied.
    clone (deep = false, blastsReference = [], collisionsReference = []) {
        const stage = new Shot(this.projectile.clone(deep), this.delay, blastsReference, collisionsReference);
        stage.collisionCallback = this.collisionCallback;
        stage.fadeTime = this.#totalFadeTime;
        stage.drawAfter = this.drawAfter;
        return stage;
    }

    get isShot () { return true }
    get isFinished () { return this.#isFinished }
    get isStarted () { return this.#isStarted } // [!] stage tracking- may be redundant
    get isTracing () { return !this.#traceLegend?.isShotLegend }
    get isInsideDisplay () { // [!] will return projectile as in-bounds if a display bbox is not set
        const { displayBoundingBox, projectile } = this;
        if (!displayBoundingBox?.isBoundingBox || !(displayBoundingBox.extentSquared > 0)) return true;
        return projectile.getBoundingBox(true).isIntersecting(displayBoundingBox);
    }
    get isStopped () { return this.isTracing ? this.projectile.isStopped : this.time >= this.#traceLegend?.duration }
    get isFading () { return this.isStopped && !this.#isFinished && this.#totalFadeTime > 0 }
    get hasFadeTime () { return this.#totalFadeTime > 0 }
    get doDraw () { return this.isStarted && (!this.isFinished || this.drawAfter) && this.time > this.delay }
    get legend () { return this.#legend }
    get delay () { return this.#delayTime }
    get projectile () { return this.#projectile }
    get blasts () { return this.#blasts }
    get colliders () { return this.#colliders }
    get onend () { return this.#finishedPromise.promise }
    get time () { return this.#time }
    set time (value) { return (this.#time = value) }
    get blastTimeOffset () { return this.#blastTimeOffset }
    set blastTimeOffset (value) { return (this.#blastTimeOffset = value) }
    get collisionCallback () { return this.#collisionCallback }
    set collisionCallback (callbackFn) { return (this.#collisionCallback = callbackFn?.bind?.(this)) }
    get preUpdateCallback () { return this.#preUpdateCallback }
    set preUpdateCallback (callbackFn) { return (this.#preUpdateCallback = callbackFn?.bind?.(this)) }
    get updateCallback () { return this.#updateCallback }
    set updateCallback (callbackFn) { return (this.#updateCallback = callbackFn?.bind?.(this)) }
    get sfxCallback () { return this.#sfxCallback }
    get launchCallback () { return this.#launchCallback }
    set launchCallback (callbackFn) { return (this.#launchCallback = callbackFn?.bind?.(this)) }
    get playLaunchCallback () { return this.#playLaunchCallback }
    set playLaunchCallback (bool) { return (this.#playLaunchCallback = bool) }
    get applyDestruction () { return this.#applyDestruction }
    set applyDestruction (value) { return (this.#applyDestruction = value) }
    get displayBoundingBox () { return this.#displayBoundingBox }
    set displayBoundingBox (bbox) { return (this.#displayBoundingBox = bbox) }
    get fadeTime () { return this.#fadeTime }
    set fadeTime (seconds) {
        this.#totalFadeTime = seconds;
        return (this.#fadeTime = seconds);
    }
    get tracer () { return this.#tracer }
}