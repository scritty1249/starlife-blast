import { Aimer } from "./round/Aimer.js";
import { Mover } from "./round/Mover.js";
import { Properties, Affiliation } from "../projectile/collision/Properties.js";
import { Loadable } from "../load/Loadable.js";
import { Vector } from "../math/Vector.js";
import { Ray } from "../math/Ray.js";
import { Hashable, FNV1a } from "../math/Hash.js";

export class Actor extends Loadable {
    #Aimer;
    #Mover;
    #Puppet;
    #Metadata;
    #HitTotal;
    #originalStyling = {};
    #stylingApplied = false;
    #onloadProxy = Promise.withResolvers();
    #puppetState = {
        lastX: undefined,
        flipBody: false
    }
    activeState = false; // draws the avatar with border when set
    constructor (metadata, hittotal) {
        super();
        this.#Metadata = metadata;
        this.#HitTotal = hittotal;
        this.#saveStyling();
        this.Metadata.onload.then(() => {
            const { Model } = this.Metadata;
            Model.width = 50;
            this.#Puppet = Model.Puppet();
            this.#Aimer = new Aimer(this.Puppet, this.Puppet.width * 3);
            this.#Mover = new Mover(this.Puppet);
            this.Mover.offsetY = -(this.Puppet.offset.body.y / 10);
            this.Mover.climbHeight = this.Puppet.height / 2;
            this.#onloadProxy.resolve(this);
        }).catch((err) => this.#onloadProxy.reject(err));
    }

    #saveStyling () {
        const styling = this.#originalStyling;
        styling.barOffset = this.HitTotal.barOffset.clone();
    }

    applyStyling (cursor) {
        if (!cursor?.isCanvas2DContextCursor) return;
        const original = this.#originalStyling;
        const { Profile, Model } = this.Metadata;
        Profile.fontSize = 18;
        const nameWidth = Profile.getNameWidth(cursor);
        const profileLinePadding = 5;
        Profile.fontColor.apply(255, 255, 255);
        Profile.avatar.width = 25;
        Profile.nameOffset.x = ((nameWidth + Profile.avatar.width) / 2) - (nameWidth / 2);
        Profile.avatarOffset.x = Profile.nameOffset.x - (nameWidth / 2) - (25 / 2) - profileLinePadding;
        Profile.avatarOffset.y = Profile.nameOffset.y = Model.body.height * 2.6;

        this.HitTotal.barOffset.y = original.barOffset.y + Model.body.height * 2;
        this.HitTotal.barHeight = 8;
        this.HitTotal.barWidth = Model.body.width;
        this.#stylingApplied = true;
    }
    drawOverlay (cursor, isClient = false, isTurn = true) {
        const { Metadata, Puppet, HitTotal, isDead } = this;
        if (!this.#stylingApplied) this.applyStyling(cursor);
        cursor.save();
        if (isClient && !isDead && isTurn) {
            cursor.fillStyle = "white";
            cursor.fillText(Math.round(this.Aimer.rotation * (180/Math.PI)), this.Puppet.barrelPosition.project(this.Aimer.rotation - (Math.PI / 2), 50));
        }
        if (isDead) {
            cursor.filter = "grayscale(100%)";
            Metadata.Profile.fontColor.apply(100, 100, 100); // [!] inefficient
        }
        if (!isClient) {
            Metadata.Profile.draw(cursor, Puppet.relativePosition, this.activeState);
        }
        HitTotal.draw(cursor, Puppet.relativePosition);
        cursor.restore();
    }
    drawModel (cursor) {
        const rotation = this.Aimer.rotation - this.Puppet.rotation.body;
        const newX = this.Mover.position.x;
        if (!Number.isFinite(this.#puppetState.lastX)) {
            this.#puppetState.lastX = newX;
        } else if (this.#puppetState.lastX !== newX) {
            this.#puppetState.flipBody = this.#puppetState.lastX > newX;
            this.#puppetState.lastX = newX;
        }
        const flipBarrel = (rotation < Math.PI * 2 && rotation > Math.PI);
        this.Puppet.draw(cursor, this.#puppetState.flipBody, flipBarrel);
    }
    toJSON () {
        const payload = {
            data: this.Metadata.toJSON(),
            hitpoints: this.HitTotal.toJSON(),
        };
        if (this.ready) {
            payload.position = this.Puppet.position.toJSON();
            payload.rotation = this.rotation;
            payload.orientation = this.orientation;
            payload.power = this.Aimer.power;
        }
        return payload;
    }
    getCollider (isClient = false, isAlly = false) {
        const { Puppet, Mover } = this;
        const collider = Puppet.getHitbox().Polygon();
        collider.userData.collision = Properties.PLAYER | Properties.ENTER;
        collider.userData.affiliation = isClient
            ? Affiliation.SELF
            : isAlly
                ? Affiliation.ALLY
                : Affiliation.ENEMY;
        collider.userData.position = Puppet.position.round(2, true).toJSON();
        collider.userData.rotation = Puppet.rotation.body;
        collider.userData.heightOffset = Puppet.height + Mover.offsetY;
        return collider;
    }
    *getLaunchParameters (terrain) {
        const { relativePosition, barrelPosition } = this.Puppet;
        const { Aimer } = this;
        const barrelPath = new Ray(relativePosition, barrelPosition);
        const hit = terrain.polygon.raycast(barrelPath)
            .sort((a, b) =>
                a.distance(relativePosition) - b.distance(relativePosition))
            .at(0);
        yield hit?.point || barrelPosition;
        yield Aimer.rotation + (3 * (Math.PI / 2));
        yield Aimer.power;
    }
    getState () {
        return new ActorState(
            this.position.clone(),
            this.Aimer.power,
            this.rotation,
            this.orientation,
            this.HitTotal.toJSON()
        );
    }
    setState (actorState) {
        const { hitpoints, position, rotation, orientation, power } = actorState;
        this.HitTotal.set(hitpoints);
        this.position.apply(position);
        this.rotation = rotation;
        this.orientation = orientation;
        this.Aimer.power = power;
    }

    get isActor () { return true }
    get onload () { return this.#onloadProxy.promise }
    get ready () { return this.Metadata.ready }
    get source () { return this.Metadata.source }
    get Metadata () { return this.#Metadata }
    get HitTotal () { return this.#HitTotal }
    get Puppet () { return this.#Puppet }
    get Aimer () { return this.#Aimer }
    get Mover () { return this.#Mover }
    // easy access
    get id () { return this.Metadata.Profile.userid }
    get position () { return this.Mover.position }
    get rotation () { return this.Aimer.rotation }
    set rotation (radians) { return (this.Aimer.rotation = radians) }
    get orientation () { return this.Puppet.rotation.body }
    set orientation (radians) { return (this.Puppet.rotation.body = radians) }
}

export class ActorState extends Hashable {
    static fromObject (obj) {
        const { hitpoints, power, rotation, orientation, position: p } = obj;
        const position = Vector.fromObject(p);
        return new ActorState(position, power, rotation, orientation, hitpoints);
    }
    static #computeRawHash (hitpointRawHash, position, power, rotation, orientation) {
        let hash = hitpointRawHash;
        hash = FNV1a.Extend32Bit(hash, position);
        hash = FNV1a.Extend32Bit(hash, power);
        hash = FNV1a.Extend32Bit(hash, rotation);
        hash = FNV1a.Extend32Bit(hash, orientation);
        return hash;
    }
    #position;
    #rotation;
    #orientation;
    #power;
    #hitpoints;
    #rawHash;
    // Vector, Number, Number, Number, Object (JSON), 32-bit Hash
    constructor (position, power, rotation, orientation, hitpointJson) {
        super();
        this.#rawHash = ActorState.#computeRawHash(hitpointJson.hash, position, power, rotation, orientation);
        this.#hitpoints = hitpointJson;
        this.#position = position;
        this.#power = power;
        this.#rotation = rotation;
        this.#orientation = orientation;
    }

    toJSON () {
        return {
            hitpoints: this.#hitpoints,
            power: this.power,
            rotation: this.rotation,
            orientation: this.orientation,
            position: this.position.toJSON(),
        };
    }

    get isActorState () { return true }
    get position () { return this.#position }
    get rotation () { return this.#rotation }
    get orientation () { return this.#orientation }
    get power () { return this.#power }
    get hitpoints () { return this.#hitpoints.layers }
    get rawHash () { return this.#rawHash }
}