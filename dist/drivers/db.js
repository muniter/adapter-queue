import { Queue } from "../core/queue.js";
export class DbQueue extends Queue {
    db;
    constructor(db, options = {}) {
        super(options);
        this.db = db;
    }
    async pushMessage(payload, meta) {
        return await this.db.insertJob(payload, meta);
    }
    async reserve(timeout) {
        const record = await this.db.reserveJob(timeout);
        if (!record) {
            return null;
        }
        return {
            id: record.id,
            payload: record.payload,
            meta: record.meta
        };
    }
    async release(message) {
        await this.db.releaseJob(message.id);
    }
    async status(id) {
        const status = await this.db.getJobStatus(id);
        return status || 'done';
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
            await this.db.updateJobAttempt(message.id, currentAttempt);
            message.meta.attempt = currentAttempt;
            const payload = this.serializer.serialize(job);
            await this.pushMessage(payload, message.meta);
            return true;
        }
        return true;
    }
}
//# sourceMappingURL=db.js.map