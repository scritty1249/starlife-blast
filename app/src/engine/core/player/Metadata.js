import { Loadable } from "../load/Loadable.js";

// wraps all loadable player data
export class Metadata extends Loadable {
    #team;
    #Profile;
    #Model;
    #loadPromise;
    #ready = false;
    #ammo = new Array();
    constructor (model, profile, team, ammo = undefined) {
        super();
        this.#Profile = profile;
        this.#Model = model;
        this.#team = team;
        if (ammo?.length)
            for (const a of ammo)
                this.ammo.push(a);
        this.#loadPromise = Promise.all([this.Profile.onload, this.Model.onload])
            .then(() => this.#ready = true)
            .then(() => this);
    }

    toJSON () {
        return {
            profile: this.Profile.toJSON(),
            model: this.Model.type,
            team: this.team,
            ammo: Array.from(this.ammo)
        };
    }

    get isMetadata () { return true }
    get onload () { return this.#loadPromise }
    get ready () { return this.#ready }
    get Profile () { return this.#Profile }
    get Model () { return this.#Model }
    get team () { return this.#team }
    get ammo () { return this.#ammo }
}
