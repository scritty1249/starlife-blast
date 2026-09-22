import { BlobPacker, BlastInterval, ActorState, AmmoMap } from "../../core/Core.js";

class RoundState {
    static fromRound (players, terrain, frame = undefined, time = 0) {
        const interval = new BlastInterval(time, terrain, frame, []);
        const actors = RoundState.getActorStates(players);
        return new RoundState(actors, interval);
    }
    static unpack (data) {
        const viewIterator = BlobPacker.unpack(data);
        const players = viewIterator.next().Object;
        const states = Object.fromEntries(Object.entries(players).map(
            ([id, state]) => [id, ActorState.fromObject(state)]
        ));
        const interval = BlastInterval.unpack(viewIterator.next().value);
        return new RoundState(states, interval);
    }
    // returns a list of player IDs for those that died as a result of applying this State
    static applyActors (players, actorStates) {
        const died = [];
        for (const [id, state] of Object.entries(actorStates)) {
            if (players.has(id)) {
                const player = players.get(id);
                const {isDead: wasDead} = player;
                player.setState(state);
                if (player.isDead && !wasDead) died.push(id);
            }
        }
        return died;
    }
    static getActorStates (players) {
        return Object.fromEntries(players.values().map((actor) => [actor.id, actor.getState()]));
    }
    #playerStates;
    #blastInterval;
    constructor (playerStates, blastInterval) {
        this.#playerStates = playerStates;
        this.#blastInterval = blastInterval;
    }

    pack (includeTerrain = true) {
        const packer = new BlobPacker();
        packer.push(Object.fromEntries(Object.entries(this.actors).map(
            ([id, state]) => [id, state.toJSON()]
        )));
        packer.push(this.interval.pack(includeTerrain));
        return packer.pack();
    }
    // returns changes in this relative to other
    //  *returns values of THIS which are different in THAT -KT
    difference (other) {
        const terrainChanged = this.terrain.hash !== other?.terrain?.hash;
        const states = Object.fromEntries(Object.entries(this.actors)
            .filter(([id, state]) =>
                !(id in other?.actors)
                || (state.hash !== other.actors[id]?.hash)
            ));
        const interval = new BlastInterval(
            this.interval.delay,
            terrainChanged ? this.terrain : undefined,
            terrainChanged ? this.frame : undefined,
            this.interval.blasts
        );
        return new RoundState(states, interval);
    }
    // returns combination of this and other
    // values in other take precendence over ones in this
    union (other) {
        const states = {
            ...this.actors,
            ...other.actors
        };
        const hasTerrain = other.terrain?.isTerrain;
        const interval = new BlastInterval(
            other.interval.time,
            hasTerrain
                ? other.terrain
                : this.terrain,
            hasTerrain
                ? other.interval.frame
                : this.interval.frame,
            this.interval.blasts.concat(other.interval.blasts)
        );
        return new RoundState(states, interval);
    }
    // returns a list of player IDs for those that died as a result of applying this State
    applyActors (players) {
        return RoundState.applyActors(players, this.actors);
    }
    getAffectedActors (players) {
        return new Map(players.entries()
            .filter(([id, actor]) =>
                id in this.actors
                && this.actors[id].hash !== actor.getState().hash
            ));
    }
    // returns JSON of affected player actors
    // restores actor states after capturing
    captureAffectedActors (players) {
        const actors = this.getAffectedActors(players);
        const og = RoundState.getActorStates(actors);
        this.applyActors(actors);
        const instances = Object.fromEntries(actors.entries()
            .map(([id, actor]) => [id, actor.toJSON()]));
        RoundState.applyActors(actors, og);
        return instances;
    }

    get isRoundState () { return true }
    get interval () { return this.#blastInterval }
    get actors () { return this.#playerStates }
    get time () { return this.interval.delay }
    get terrain () { return this.interval.terrain }
}

class TurnRecording {
    static unpack (data) {
        const viewIterator = BlobPacker.unpack(data);
        const metadata = viewIterator.next().Object;
        const map = AmmoMap.fromObject(metadata.m);
        const other = new TurnRecording(metadata.p, metadata.a, map);
        for (const view of viewIterator) {
            other.states.push(RoundState.unpack(view));
        }
        return other;
    }
    #activeplayer;
    #ammoJson;
    #ammoMap;
    #states = new Array();
    constructor (activePlayerID, ammoJson, ammoMap) {
        this.#activeplayer = activePlayerID;
        this.#ammoJson = ammoJson;
        this.#ammoMap = ammoMap;
    }

    pack () {
        const packer = new BlobPacker();
        packer.push({
            p: this.ActivePlayerID,
            a: this.ammoJson,
            m: this.ammoMap.toJSON()
        });
        if (this.states.length) {
            packer.push(this.start.pack());
            for (let i = 1; i < this.states.length; i++)
                packer.push(this.states[i].difference(this.states[i-1]).pack());
        }
        return packer.pack();
    }

    get isTurnRecording () { return true }
    get ActivePlayerID () { return this.#activeplayer }
    get ammoJson () { return this.#ammoJson }
    get states () { return this.#states }
    get ammoMap () { return this.#ammoMap }
    get start () { return this.states.at(0) }
    get end () { return this.states.at(-1) }
    get final () { return this.states.reduce((acc, curr) => acc.union(curr), this.start) } // [!] horribly wasteful
    get duration () {
        // include time of any lingering blasts
        let max = this.ammoMap?.time || 0;
        for (const { time } of this.states)
            if (time > max) max = time;
        return max;
    }
    get intervals () { return this.states.map(({interval}) => interval) }
    get changes () { return this.length ? this.end.difference(this.start) : undefined }
    get length () { return this.states.length }
}

export class TurnRecorder {
    static #updateTerrain (players, terrain, newTerrain, blastBboxes) {
        const terrainChanged = terrain.hash !== newTerrain.hash;
        if (terrainChanged)
            terrain.apply(newTerrain);
        const affectedPlayers = blastBboxes?.length
            ? players.values().filter(({Puppet}) => {
                const { position } = Puppet;
                return blastBboxes.some((bbox) => bbox.isIntersecting(position));
            }) : players.values();
        for (const { Puppet, Mover } of affectedPlayers) {
            // update positioning - account for "falling"
            Puppet.position.round(2);
            Mover.apply(Mover.position.x, Mover.position.y);
        }
    }
    static #applyBlastDamage (blast, players) {
        for (const player of players.values()) {
            if (!blast.damage || !player.Puppet.getHitbox().isIntersecting(blast.shape)) continue;
            player.HitTotal.damage(blast.damage);
        }
    }
    static #applyBlastInterval (terrain, interval, players) {
        const { terrain: newTerrain, blasts, boundingBoxes: bboxes } = interval;
        TurnRecorder.#updateTerrain(players, terrain, newTerrain, bboxes);
        for (const blast of blasts)
            TurnRecorder.#applyBlastDamage(blast, players);
    }
    static #isAmmoDone (ammo, duration) {
        return ammo.time >= duration - Number.EPSILON;
    }
    static #tickUpdateAmmo (ammo, players, terrain, intervals, delta) {
        const states = [];
        const keepIntervals = [];
        for (const interval of intervals) {
            if (interval.delay <= ammo.time) {
                TurnRecorder.#applyBlastInterval(terrain, interval, players);
                states.push(new RoundState(RoundState.getActorStates(players), interval));
            } else keepIntervals.push(interval);
        }
        intervals.splice(0, intervals.length, ...keepIntervals);
        // update projectile
        ammo.update(delta / 1000);
        return states;
    }
    static create (frame, players, terrain) {
        return new TurnRecorder(frame, players, terrain.clone(true));
    }
    static process (recordingPayload) {
        const recording = TurnRecording.unpack(recordingPayload);
        return new TurnRecorder(recording);
    }
    #frame;
    #actors;
    #terrain;
    #recording;
    #startState;
    #state = {
        complete: false,
        finished: Promise.withResolvers()
    };
    constructor (startFrame, playerActors, startTerrain) {
        if (startFrame?.isTurnRecording) {
            this.#startState = startFrame.start;
            this.#finish(startFrame);
        } else {
            this.#frame = startFrame;
            this.#actors = playerActors;
            this.#terrain = startTerrain;
            this.#startState = RoundState.fromRound(this.#actors, this.#terrain, this.#frame, 0);
        }
    }

    #finish (recording) {
        this.#recording = recording;
        this.#state.complete = true;
        this.#state.finished.resolve(recording);
    }

    record (activePlayerID, ammo, ammoMap, blastIntervals, tickspeed) {
        if (this.complete) return undefined;
        try {
            const terrain = this.#startState.terrain.clone(true);
            const recording = new TurnRecording(activePlayerID, ammo.toJSON(), ammoMap);
            const intervals = Array.from(blastIntervals);
            recording.states.push(this.#startState);
            const { time } = ammoMap;
            while (!TurnRecorder.#isAmmoDone(ammo, time)) {
                const states = TurnRecorder.#tickUpdateAmmo(ammo, this.#actors, terrain, intervals, tickspeed);
                if (states.length)
                    for (const state of states)
                        recording.states.push(state);
            }
            // recording any blasts that occur after ammo expires
            for (const interval of intervals) {
                TurnRecorder.#applyBlastInterval(terrain, interval, this.#actors);
                recording.states.push(new RoundState(RoundState.getActorStates(this.#actors), interval));
            }
            for (const player of this.#actors.values()) {
                if (player.id in recording.start.actors)
                    player.setState(recording.start.actors[player.id]);
            }
            this.#finish(recording);
            return recording;
        } catch (err) {
            this.#state.finished.reject(err);
        }
    }
    
    get isTurnRecorder () { return true }
    get complete () { return this.#state.complete }
    get oncomplete () { return this.#state.finished.promise }
    get recording () { return this.#recording }
    get start () { return this.#startState }
}