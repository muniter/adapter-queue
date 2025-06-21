import { EventEmitter } from 'events';
import { DefaultSerializer } from "./serializer.js";
export class Queue extends EventEmitter {
    ttrDefault = 300;
    attemptsDefault = 1;
    serializer = new DefaultSerializer();
    pushOpts = {};
    constructor(options = {}) {
        super();
        if (options.serializer)
            this.serializer = options.serializer;
        if (options.ttrDefault)
            this.ttrDefault = options.ttrDefault;
        if (options.attemptsDefault)
            this.attemptsDefault = options.attemptsDefault;
    }
    ttr(value) {
        this.pushOpts.ttr = value;
        return this;
    }
    delay(seconds) {
        this.pushOpts.delay = seconds;
        return this;
    }
    priority(priority) {
        this.pushOpts.priority = priority;
        return this;
    }
    async push(job) {
        const meta = {
            ttr: this.pushOpts.ttr ?? this.ttrDefault,
            delay: this.pushOpts.delay ?? 0,
            priority: this.pushOpts.priority ?? 0,
            attempt: 0,
            pushedAt: new Date()
        };
        this.pushOpts = {};
        const event = { type: 'beforePush', job, meta };
        this.emit('beforePush', event);
        const payload = this.serializer.serialize(job);
        const id = await this.pushMessage(payload, meta);
        const afterEvent = { type: 'afterPush', id, job, meta };
        this.emit('afterPush', afterEvent);
        return id;
    }
    async run(repeat = false, timeout = 0) {
        const canContinue = () => true;
        while (canContinue()) {
            const message = await this.reserve(timeout);
            if (!message) {
                if (!repeat)
                    break;
                if (timeout > 0) {
                    await this.sleep(timeout * 1000);
                }
                continue;
            }
            const success = await this.handleMessage(message);
            if (success) {
                await this.release(message);
            }
        }
    }
    async handleMessage(message) {
        try {
            const job = this.serializer.deserialize(message.payload);
            const beforeEvent = { type: 'beforeExec', id: message.id, job, meta: message.meta };
            this.emit('beforeExec', beforeEvent);
            const result = await job.execute(this);
            const afterEvent = { type: 'afterExec', id: message.id, job, meta: message.meta, result };
            this.emit('afterExec', afterEvent);
            return true;
        }
        catch (error) {
            return await this.handleError(message, error);
        }
    }
    async handleError(message, error) {
        const job = this.serializer.deserialize(message.payload);
        const errorEvent = { type: 'afterError', id: message.id, job, meta: message.meta, error };
        this.emit('afterError', errorEvent);
        const currentAttempt = (message.meta.attempt || 0) + 1;
        const maxAttempts = this.attemptsDefault;
        let shouldRetry = currentAttempt < maxAttempts;
        if (this.isRetryableJob(job)) {
            shouldRetry = shouldRetry && job.canRetry(currentAttempt, error);
        }
        if (shouldRetry) {
            message.meta.attempt = currentAttempt;
            const payload = this.serializer.serialize(job);
            await this.pushMessage(payload, message.meta);
            return true;
        }
        return true;
    }
    isRetryableJob(job) {
        return typeof job.getTtr === 'function' && typeof job.canRetry === 'function';
    }
    async sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}
//# sourceMappingURL=queue.js.map