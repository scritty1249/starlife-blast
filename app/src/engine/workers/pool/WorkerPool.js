import { Identifiable } from "../../core/utils/tracking/Identifiable.js";
import { Cache } from "./Cache.js";
import { Job } from "./Job.js";
import { Transaction } from "./Transaction.js";
import { PoolEntry } from "./PoolEntry.js";
import { typeString } from "../../core/utils/logging.js";

export class WorkerPool extends Identifiable {
    static #workerMessage (entry, event) { // bound to WorkerPool instance
        const { id, error, state } = event.data;
        const completedMessage = [`[${typeString(this)}]: Worker ${entry.id} completed Transaction ${id}`]
        const subId = /^CACHEUPDATE_([a-z0-9]+\-[a-z0-9]+\-[a-z0-9]+\-[a-z0-9]+\-[a-z0-9]+)_[0-9]+$/g.exec(id)?.[1];
        if (this.LOG_LEVEL >= 4) completedMessage.push(` \n\tState: `, state);
        if (state && "cache" in state) {
            const added = new Set(state.cache).difference(entry.cache);
            const removed = entry.cache.difference(new Set(state.cache));
            if (this.LOG_LEVEL >= 3 && (added.size || removed.size)) {
                completedMessage.push("\n\tCache change: ");
                if (added.size) completedMessage.push("Added", added);
                if (removed.size) completedMessage.push("Removed", removed);
                //console.debug(...completedMessage);
            }
            entry.cache.clear();
            for (const cache of state.cache) {
                const peer = this.cacheAt(cache);
                if (!subId && peer) console.warn(`[${typeString(this)}]: Worker cache key collision ${cache}\n\tTransaction: ${id}\n\tColliding Worker: ${entry.id}\n\tVictim Worker: ${peer}`);
                entry.cache.add(cache);
            }
        }
        if (subId && subId in this.#transaction) {
            completedMessage.push("\n\tCalled:", this.#transaction[subId].data?.called);
            if (this.LOG_LEVEL >= 4) console.debug(...completedMessage);
        } else if (id in this.#transaction) {
            completedMessage.push("\n\tCalled:", this.#transaction[id].data?.called);
            if (entry.jobs.has(id)) entry.jobs.delete(id); // update running job queue
            else console.warn(`[${typeString(this)}] Warning: Web worker ${entry.id} replied to an unregistered job\n`, event?.data);
            if (!this.#queue.includes(entry)) this.#queue.push(entry); // push onto top of queue if it doesnt already exist there
            if (!entry.isBusy) entry.setAvailable(); // trigger anything waiting
            if (error) this.#transaction[id].reject(event.data);
            else {
                this.#transaction[id].resolve(event.data);
                if (this.LOG_LEVEL >= 4) console.debug(...completedMessage);
            }
        } else if (error) {
            console.error(`[${typeString(this)}]: Wrker ${entry.id} caught an Error\n`, event?.data);
        } else {
            console.warn(`[${typeString(this)}]: Worker ${entry.id} replied to an unregistered transaction\n`, event?.data);
        }
    }
    static #workerErrorMessage (entry, event) { // bound to WorkerPool instance
        console.error(`[${typeString(this)}]: Worker ${entry.id} failed to serialize message\n`, event?.data);
    }
    static #workerError (entry, event) { // bound to WorkerPool instance
        throw new Error(`[${typeString(this)}]: Worker ${entry.id} threw uncaught Error\n\tMessage: ${event?.message}\n\tFile: ${event?.filename}\n\tLine: ${event?.lineno}`);
    }
    static OPTIMAL_THREAD_COUNT = 4;
    #cache = {};  // storing persistant values from workers
    #transaction = {}; // partially automatic garbage collection on resolved transactions
    #workers = [];
    #queue = [];  // FIFO
    #transactionProxy;
    #cacheProxy;
    #src;
    #loadPromise = Promise.resolve();
    #LOG_LEVEL; // 1 - Transaction post messages | 2 - Transaction received messages | 3 - Transaction state change messages | 4 - Transaction completed messages 
    constructor (src, defaultPoolSize = WorkerPool.OPTIMAL_THREAD_COUNT, logLevel = 4) {
        super();
        this.#src = new URL(src);
        this.#LOG_LEVEL = logLevel;
        // setup workers
        const createWorkerPromises = [];
        const targetSize = (window.navigator.hardwareConcurrency || defaultPoolSize);
        for (let i = 0; i < targetSize; i++) createWorkerPromises.push(this.createWorker(i));
        this.#loadPromise = Promise.all(createWorkerPromises)
            .catch((err) => console.error(`[${typeString(this)}]: Error encountered while initalizing workers\n\t`, err))
            .finally(() => {
                if (this.size >= targetSize)
                    console.info(`[${typeString(this)}]: ${this.size} workers initalized`);
                else
                    console.error(`[${typeString(this)}]: Failed to initalize ${targetSize - this.size} workers. ${this.size} workers initalized`);
                if (this.size < this.constructor.OPTIMAL_THREAD_COUNT)
                    console.warn(`[${typeString(this)}]: Worker pool size (${this.size}) is lower than the minimum (${this.constructor.OPTIMAL_THREAD_COUNT}). Performance may be impacted`);
            });

        // setup proxies
        this.#cacheProxy = new Proxy(this.#cache, {
            set(target, prop, value, receiver) {
                if (target[prop])
                    for (const data of Object.values(target[prop]))
                        if (typeof data?.close === "function") data.close(); // cleanup memory
                return Reflect.set(target, prop, value, receiver);
            },
            deleteProperty(target, prop) {
                if (target[prop])
                    for (const data of Object.values(target[prop]))
                        if (typeof data?.close === "function") data.close(); // cleanup memory
                return Reflect.deleteProperty(target, prop);
            }
        });
        this.#transactionProxy = new Proxy(this.#transaction, {
            set(target, prop, value, receiver) {
                if (prop in target)
                    return false; // reject, transaction already exists
                return Reflect.set(target, prop, value, receiver);
            },
            deleteProperty(target, prop) {
                if (!Reflect.deleteProperty(target, prop))
                    console.warn(`[${typeString(this)}]: Attempted to delete a transaction that doesn't exist `, prop);
                return true;
            }
        });
    }
    // removes worker entry from queue and returns it
    #pluckWorker (id) {
        const idx = this.#queue.findIndex(({id: i}) => i === id);
        return idx < 0
            ? undefined
            : this.#queue.splice(idx, 1)?.[0];
    }
    #nextWorker () {
        const firstInQueue = this.#ready[0]?.id;
        const workerEntry = firstInQueue !== undefined
            ? this.#pluckWorker(firstInQueue)
            : this.#available.reduce((bestWorker, currentWorker) => {
                    return currentWorker.jobs.size < bestWorker.jobs.size ? currentWorker : bestWorker;
                }, this.#available[0]);
        if (!workerEntry) throw new Error(`[${typeString(this)}]: Failed to retrieve Worker (${this.idleCount} idle, ${this.size - this.#available.length} waiting, ${this.size} total)`);
        return workerEntry;
    }
    #postJob (type, payload, transfer = [], command = "", worker = undefined, dispose = false) {
        if (worker && !worker?.isPoolEntry)
            throw new Error(`[${typeString(this)}]: Expected empty or PoolEntry, got ${typeString(worker)}`);
        const w = worker || this.#nextWorker();
        const { isWaiting } = w;
        const transaction = new Transaction(w.id);
        const { id } = transaction;
        transaction.data.called = command ? command : type;
        this.#transaction[id] = transaction;
        w.jobs.add(id);
        w.instance.postMessage({type, payload, id, command}, transfer);
        if ((command !== "ADDWKR" && this.LOG_LEVEL >= 2) || (command === "ADDWKR" && this.LOG_LEVEL >= 4))
            console.debug(`[${typeString(this)}]: Transaction ${id} posted to Worker ${w.id}\n\t${command ? command : type}: `,  payload);
        if (dispose) transaction.finally(() => {
            delete this.transaction[transaction.id];
            if (isWaiting) w.release();
        });
        // always return a Job, not Transaction
        return new Job(transaction);
    }
    #cacheAt (id) { // return worker entry that holds the cache of given id
        for (const entry of this.#workers)
            if (entry.cache.has(id)) return entry;
        return undefined;
    }
    #getWorker (id) {
        for (const entry of this.#workers)
            if (entry.id === id) return entry;
        return undefined;
    }
    #isWorkerFree (worker) {
        for (const { id } of this.#queue)
            if (id === worker.id) return true;
        return false;
    }
    #getPrioritizedWorker (cachesUsed = new Set()) {
        let worker;
        let used = 0;
        for (let i = 0; i < this.#ready.length; i++) {
            let w = this.#ready[i];
            const common = cachesUsed.intersection(w.cache);
            if (common.size === cachesUsed.size)
                return this.#pluckWorker(w.id);
            if (common.size > used) {
                used = common.size;
                worker = w;
            }
        }
        return worker
            ? this.#pluckWorker(worker.id)
            : this.#nextWorker();
    }
    async #dropCache (id, worker) {
        return await this.#postJob(
            "", 
            { target: id }, 
            [], 
            "DROPCACHE",
            worker,
            true
        );
    }
    async #initWorker (entry) {
        // initalize worker
        const { id, instance: worker } = entry;
        return await new Promise((resolve, reject) => {
            worker.onerror = (event) => {
                const msg = `[${typeString(this)}]: Worker ${id} crashed at initialization\n\tMessage: ${event?.message}\n\tFile: ${event?.filename}\n\tLine: ${event?.lineno}`;
                console.error(msg);
                reject(new Error(msg));
            };
            worker.onmessage = (event) => {
                if (event.data?.type === "READY") {                    
                    worker.onerror = WorkerPool.#workerError.bind(this, entry);
                    worker.onmessage = WorkerPool.#workerMessage.bind(this, entry);
                    worker.onmessageerror = WorkerPool.#workerErrorMessage.bind(this, entry);
                    // setup MessageChannels
                    for (const peer of this.#workers) {
                        const channel = new MessageChannel();
                        this.#postJob("", {
                            port: channel.port1,
                            worker: peer.id
                        }, [channel.port1], "ADDWKR", entry, true);
                        this.#postJob("", {
                            port: channel.port2,
                            worker: id
                        }, [channel.port2], "ADDWKR", peer, true);
                    }
                    // add to record
                    this.#workers.push(entry);
                    this.#queue.push(entry);
                    if (this.LOG_LEVEL >= 4)
                        console.debug(`[${typeString(this)}]: Worker ${id} registered`);
                    resolve();
                } else {
                    console.debug(`[${typeString(this)}]: Unknown message on initalization from worker ${id}\n`, event);
                }
            };
        });
    }
    #decodeCache (payload) {
        return Cache.TYPES.has(payload?.type)
            ? Cache.decode(payload)
            : null;
    }
    async #collectCaches (workerID, caches = []) {
        const transfers = [];
        for (const cache of caches)
            transfers.push(this.copyCache(cache, cache, false, workerID));
        await Promise.all(transfers);
    }
    claimWorker () {
        return new PoolEntryInstance(
            this.#nextWorker(),
            async (...args) => await this.#postJob(...args),
            (...args) => this.#decodeCache(...args)
        );
    }
    cacheAt (cache) { // return id of worker that holds cache of given id
        return this.#cacheAt(cache)?.id;
    }
    createWorker () {
        const entry = new PoolEntry(this.#src, {logLevel: this.LOG_LEVEL, blurSupported: window.__CANVAS_BLUR_SUPPORTED});
        if (Number.isFinite(window.navigator.hardwareConcurrency) && this.size + 1 > window.navigator.hardwareConcurrency)
            console.warn(`[${typeString(this)}]: Worker pool size exceeds supported hardware concurrency. Performance may be impacted`);
        return this.#initWorker(entry);
    }
    getTransactionWorker (transactionid) {
        return this.#transaction[transactionid]?.worker;
    }
    async post (type, payload, transfer = [], cachesUsed = []) {
        const caches = new Set(cachesUsed);
        const worker = this.#getPrioritizedWorker(caches);
        await this.#collectCaches(worker.id, caches.difference(worker.cache))
            .catch((e) => { console.warn(`[${typeString(this)}]: Failed to transfer cache(s) specified for worker job\n`, e)});
        return await this.#postJob(type, payload, transfer, "", worker) // don't dispose of transaction
            .then(({payload}) => Object.keys(payload).length === 0 ? undefined : payload ); // [!] getting empty objects instead of undefined for some reason on webworker response??
    }
    async hashCache (id) {
        let worker = this.#cacheAt(id);
        if (worker?.isBusy) {
            if (this.LOG_LEVEL >= 1) console.debug(`[${typeString(this)}]: Waiting for cache ${id}`);
            await worker.onAvailable;
            worker = this.#cacheAt(cache);
        }
        if (worker === undefined) throw new Error(`[${typeString(this)}]: Cache ${id} does not exist`);
        return this.#postJob(
            "", 
            { target: id, manager: true }, 
            [],
            "HASHCACHE",
            worker,
            true
        ).then(({payload}) => payload.hash);
    }
    async fillCache (id, data) {
        let worker = this.#cacheAt(id);
        if (worker?.isBusy) {
            if (this.LOG_LEVEL >= 1) console.debug(`[${typeString(this)}]: Waiting for cache ${id}`);
            await worker.onAvailable;
            worker = this.#cacheAt(cache);
        }
        if (worker === undefined) throw new Error(`[${typeString(this)}]: Cache ${id} does not exist`);
        return this.#postJob(
            "", 
            { data, target: id, manager: true }, 
            [],
            "FILLCACHE",
            worker,
            true
        ).then(() => true)
        .catch((err) => false);
    }
    // [!] Safer version of createCache, deletes the cache from an old worker if it already exists
    async setCache (cache) {
        if (!cache?.isCache) throw new Error(`[${typeString(this)}]: ${typeString(cache)} is not a valid cache`);
        const staleCacheWorker = this.#cacheAt(cache.id);
        const worker = this.#nextWorker();
        let concurrent = Promise.resolve();

        if (staleCacheWorker && worker.id !== staleCacheWorker.id) {
            // drop cache from old worker, push new cache onto available worker
            concurrent = this.#dropCache(cache.id, staleCacheWorker);
        }
        const data = await cache.encode();
        const result = this.#postJob(
            "",
            { cache: data }, 
            data.buffers, 
            "CREATECACHE",
            worker,
            true
        );
        await Promise.all([concurrent, result]);
    }
    // overwrites one cache with another. support cache renaming
    async copyCache (source, dest, clone = false, receiverID = undefined) {
        const receiever = this.#getWorker(receiverID);
        let worker = this.#cacheAt(source);
        if (worker === undefined) throw new Error(`[${typeString(this)}]: Cache ${source} does not exist`);
        if (worker?.isBusy) {
            if (this.LOG_LEVEL >= 1) console.debug(`[${typeString(this)}]: Waiting for cache ${source}`);
            await worker.onAvailable;
            worker = this.#cacheAt(source);
        }
        worker?.hold?.();
        let holder = this.#cacheAt(dest);
        if (holder?.eq?.(worker)) holder = undefined;
        if (holder?.isBusy) {
            if (this.LOG_LEVEL >= 1) console.debug(`[${typeString(this)}]: Waiting for cache ${dest}`);
            await holder.onAvailable;
            holder = this.#cacheAt(dest);
        }
        holder?.hold?.();
        let target;
        if (holder?.eq?.(receiever)) {
            holder.release();
            target = holder;
        } else if (holder !== undefined && receiever !== undefined) {
            // destination cache exists, receiever is specified
            target = receiever;
            await this.#dropCache(dest, holder);
        } else if (holder !== undefined && receiever === undefined) {
            // destination cache exists, receiever is not specified
            target = holder;
        } else if (holder === undefined && receiever !== undefined) {
            // destination cache does not exist, receiver is specified
            target = receiever;
        } else {
            // destination cache does not exist, receiver is not specified
            target = worker; // just rename the cache within the same worker
        }
        return this.#postJob(
            "", 
            { dest, source, clone, worker: target.id, manager: false }, 
            [],
            "SENDCACHE",
            worker,
            true
        );
    }
    async pullCache (source, clone = true) {
        let worker = this.#cacheAt(source);
        if (worker?.isBusy) {
            if (this.LOG_LEVEL >= 1) console.debug(`[${typeString(this)}]: Waiting for cache ${source}`);
            await worker.onAvailable;
            worker = this.#cacheAt(source);
        }
        if (worker === undefined) return null; // signal something went wrong
        const { payload } = await this.#postJob(
            "", 
            { source, clone, manager: true }, 
            [],
            "SENDCACHE",
            worker,
            true
        );
        const cache = this.#decodeCache(payload);
        if (cache) {
            this.cache[source] = cache;
        } else {
            // callers responsiblity to deal with the mess
            throw new Error(`[${typeString(this)}]: Worker ${worker.id} returned a cache of unknown type ${typeString(payload)}`);
        }
        return this.cache[source];
    }
    // [!] creates a cache without checking if it already exists. Should only be used in controlled situations. For most cases, use setCache() to create new caches instead.
    async createCache (cache) {
        if (!cache?.isCache) throw new Error(`[${typeString(this)}]: ${typeString(cache)} is not a valid cache`);
        const worker = this.#nextWorker();
        const data = await cache.encode();
        return this.#postJob(
            "", 
            { cache: data }, 
            data.buffers, 
            "CREATECACHE",
            worker,
            true
        );
    }
    dropCache (id) {
        const worker = this.#cacheAt(id);
        if (!worker) return;
        return this.#dropCache(id, worker);
    }
    terminate () {
        for (const { instance } of this.#workers) instance.terminate();
        this.#workers.splice(0, this.#workers.length);
        this.#queue.splice(0, this.#queue.length);
    }

    get isWorkerPool () { return true }
    get LOG_LEVEL () { return this.#LOG_LEVEL }
    get size () { return this.#workers.length }
    get idleCount () { return this.#queue.length }
    get transaction () { return this.#transactionProxy }
    get cache () { return this.#cacheProxy }
    get onload () { return this.#loadPromise }
    get #ready () { return this.#queue.filter(({isWaiting}) => !isWaiting) }
    get #available () { return this.#workers.filter(({isWaiting}) => !isWaiting) }
}

class WorkerEntryInstance extends Identifiable {
    #entry;
    #postCallback;
    #decodeCallback;
    constructor (
        entry,
        postJobCallback
            = async (type, payload, transfer = [], command = "", worker = undefined, dispose = false) => {},
        decodeCacheCallback
            = (payload) => {}
    ) {
        super(entry.id);
        this.#entry = entry;
        this.#postCallback = postJobCallback;
        this.#decodeCallback = decodeCacheCallback;
        this.#entry.hold();
    }

    async #pullCache (id, clone) {
        const { payload } = await this.#postCallback(
            "", 
            { id, clone, manager: true }, 
            [],
            "SENDCACHE",
            this.#entry,
            false
        );
        return this.#decodeCallback(payload);
    }

    async post (type = "", payload = {}, transfer = []) {
        const { payload: data = {} } = await this.#postCallback(
            type,
            payload,
            transfer,
            "",
            this.#entry,
            false
        );
        return Object.keys(data).length === 0
            ? undefined
            : data;
    }
    async sendCache (id, entryInstance, clone = false) {
        await this.#postCallback(
            "",
            { dest: id, source: id, clone, worker: entryInstance.id, manager: false }, 
            [],
            "SENDCACHE",
            this.#entry,
            false
        );
    }
    async putCache (cache) {
        const data = await cache.encode();
        await this.#postCallback(
            "",
            { cache: data }, 
            data.buffers, 
            "CREATECACHE",
            this.#entry,
            false
        );
    }
    async dropCache (id) {
        await this.#postCallback(
            "", 
            { target: id }, 
            [], 
            "DROPCACHE",
            this.#entry,
            false
        );
    }
    async getCache (id) {
        return await this.#pullCache(id, false);
    }
    async peekCache (id) {
        return await this.#pullCache(id, true);
    }
    release () {
        this.#entry.release();
        this.#entry = null;
    }

    get isWorkerEntryInstance () { return true }
    get cache () { return new Set(this.#entry.cache) }
    get jobs () { return new Set(this.#entry.jobs) }
    get isBusy () { return this.#entry.isBusy }
    get onAvailable () { return this.#entry.onAvailable }
}