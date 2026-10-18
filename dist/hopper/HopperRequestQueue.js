import { hopperOperationStage } from "./HopperOperationStage.js";
import { HopperCancelledError, HopperProcessError, HopperProtocolError, HopperRemoteError, } from "../domain/hopperErrors.js";
import { err } from "../domain/result.js";
/** FIFO that keeps the wire serialized until Hopper actually replies. */
export class HopperRequestQueue {
    send;
    #queue = [];
    #active;
    constructor(send) {
        this.send = send;
    }
    /** Queue one request until Hopper replies or the caller cancels it. */
    run(id, method, params, options) {
        if (options.signal?.aborted === true)
            return Promise.resolve(err(new HopperCancelledError()));
        return new Promise((resolve) => {
            let entry;
            const onAbort = options.signal === undefined ? undefined : () => this.#cancel(entry);
            entry = {
                id,
                method,
                params,
                signal: options.signal,
                progress: options.progress,
                resolve,
                onAbort,
                callerState: "waiting",
                callerSettled: false,
                startedAt: undefined,
                heartbeat: undefined,
            };
            this.#queue.push(entry);
            if (onAbort !== undefined)
                options.signal?.addEventListener("abort", onAbort, { once: true });
            if (this.#active !== undefined || this.#queue.length > 1)
                this.#report(entry, `${method} queued behind ${String(this.#size() - 1)} Hopper request(s)`);
            this.#drain();
        });
    }
    /** Settle the active wire request. False identifies an unexpected response id. */
    accept(id, result) {
        const entry = this.#active;
        if (entry === undefined || entry.id !== id)
            return false;
        this.#releaseWire(entry);
        if (!entry.callerSettled)
            this.#settleCaller(entry, result.ok ? result : err(withRequestContext(result.error, entry)), "waiting");
        this.#active = undefined;
        this.#drain();
        return true;
    }
    /** Forward one correlated bridge event without releasing the wire request. */
    acceptEvent(event) {
        const entry = this.#active;
        if (entry === undefined || entry.id !== event.id)
            return false;
        if (event.event.type === "progress" && !entry.callerSettled) {
            if (event.event.terminal === true && entry.heartbeat !== undefined) {
                clearInterval(entry.heartbeat);
                entry.heartbeat = undefined;
            }
            this.#reportUpdate(entry, {
                phase: event.event.phase,
                completed: event.event.completed,
                total: event.event.total,
                message: event.event.message,
                ...(event.event.terminal === undefined
                    ? {}
                    : { terminal: event.event.terminal }),
            });
        }
        return true;
    }
    /** Fail the active wire request and every request still waiting in the FIFO. */
    failAll(error) {
        const active = this.#active;
        this.#active = undefined;
        if (active !== undefined) {
            this.#releaseWire(active);
            if (!active.callerSettled)
                this.#settleCaller(active, err(withRequestContext(error, active)), "waiting");
        }
        for (const entry of this.#queue.splice(0))
            this.#settleCaller(entry, err(withRequestContext(error, entry)), "waiting");
    }
    /** Snapshot the one request still occupying Hopper's serial Python thread. */
    activity() {
        const active = this.#active;
        if (active === undefined || active.startedAt === undefined)
            return null;
        return {
            requestId: active.id,
            operation: active.method,
            elapsedMs: Math.max(0, Math.round(performance.now() - active.startedAt)),
            callerState: active.callerState,
            queuedRequests: this.#queue.length,
        };
    }
    /** Return whether an id belongs to a request that has not crossed the wire. */
    hasQueued(id) {
        return this.#queue.some((entry) => entry.id === id);
    }
    /** Number of caller requests waiting behind the active bridge operation. */
    queuedCount() {
        return this.#queue.length;
    }
    #size() {
        return this.#queue.length + (this.#active === undefined ? 0 : 1);
    }
    #drain() {
        if (this.#active !== undefined)
            return;
        const entry = this.#queue.shift();
        if (entry === undefined)
            return;
        if (entry.signal?.aborted === true) {
            this.#settleCaller(entry, err(new HopperCancelledError()), "cancelled");
            this.#drain();
            return;
        }
        this.#active = entry;
        entry.startedAt = performance.now();
        this.#report(entry, `${entry.method} started on Hopper's serial bridge`);
        entry.heartbeat = setInterval(() => {
            if (entry.callerSettled || entry.startedAt === undefined)
                return;
            const elapsed = Math.round(performance.now() - entry.startedAt);
            this.#report(entry, `${entry.method} is still running in Hopper (${String(elapsed)} ms elapsed)`);
        }, 1_000);
        try {
            this.send({ id: entry.id, method: entry.method, params: entry.params }, () => this.accept(entry.id, err(new HopperProcessError(null, undefined, entry.method, entry.id, "unreachable", hopperOperationStage(entry.method)))));
        }
        catch (cause) {
            this.accept(entry.id, err(new HopperProtocolError("Hopper socket write failed", { cause })));
        }
    }
    #cancel(entry) {
        if (entry.callerSettled)
            return;
        if (this.#active === entry) {
            this.#settleCaller(entry, err(new HopperCancelledError()), "cancelled");
            return;
        }
        const index = this.#queue.indexOf(entry);
        if (index < 0)
            return;
        this.#queue.splice(index, 1);
        this.#settleCaller(entry, err(new HopperCancelledError()), "cancelled");
    }
    #settleCaller(entry, result, callerState) {
        if (entry.callerSettled)
            return;
        entry.callerSettled = true;
        entry.callerState = callerState;
        if (this.#active === entry && entry.heartbeat !== undefined) {
            clearInterval(entry.heartbeat);
            entry.heartbeat = undefined;
        }
        if (entry.signal !== undefined && entry.onAbort !== undefined)
            entry.signal.removeEventListener("abort", entry.onAbort);
        entry.resolve(result);
    }
    #releaseWire(entry) {
        if (entry.heartbeat !== undefined)
            clearInterval(entry.heartbeat);
        entry.heartbeat = undefined;
        if (entry.signal !== undefined && entry.onAbort !== undefined)
            entry.signal.removeEventListener("abort", entry.onAbort);
    }
    #report(entry, message) {
        this.#reportUpdate(entry, {
            phase: "hopper_request",
            completed: 0,
            total: 1,
            message,
        });
    }
    #reportUpdate(entry, update) {
        try {
            void Promise.resolve(entry.progress?.report(update)).catch((cause) => {
                // best-effort cleanup: progress rejection bookkeeping only.
                void cause;
            });
        }
        catch (cause) {
            // Progress observation cannot change the request outcome.
            void cause;
        }
    }
}
const withRequestContext = (error, entry) => {
    if (error instanceof HopperProcessError)
        return new HopperProcessError(error.exitCode, error.diagnostic, error.operation ?? entry.method, error.requestId ?? entry.id, error.providerState, error.operation === undefined && error.stage === "connection"
            ? hopperOperationStage(entry.method)
            : error.stage);
    if (error instanceof HopperRemoteError)
        return new HopperRemoteError(error.code, error.safeMessage, {
            diagnosticType: error.diagnosticType,
            operation: error.operation ?? entry.method,
            requestId: error.requestId ?? entry.id,
        });
    return error;
};
