import { run, get } from './database.js';
export class SQLiteDatabaseAdapter {
    async insertJob(payload, meta) {
        const result = await run(`INSERT INTO jobs (
        payload, queue_name, ttr, delay, priority, push_time, 
        delay_time, attempt, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
            payload,
            meta.queueName || 'default',
            meta.ttr || 300,
            meta.delay || 0,
            meta.priority || 0,
            meta.pushTime || Date.now(),
            meta.delay ? Date.now() + meta.delay * 1000 : null,
            meta.attempt || 0,
            'waiting'
        ]);
        return result.lastID.toString();
    }
    async reserveJob(timeout) {
        const now = Date.now();
        const job = await get(`SELECT * FROM jobs 
       WHERE status = 'waiting' 
       AND (delay_time IS NULL OR delay_time <= ?)
       ORDER BY priority DESC, push_time ASC 
       LIMIT 1`, [now]);
        if (!job)
            return null;
        await run(`UPDATE jobs SET 
        status = 'reserved',
        reserve_time = ?,
        expire_time = ?
       WHERE id = ?`, [now, now + timeout * 1000, job.id]);
        return {
            id: job.id.toString(),
            queueName: job.queue_name,
            attempt: job.attempt,
            payload: job.payload,
            ttr: job.ttr,
            priority: job.priority,
            delay: job.delay,
            pushTime: job.push_time,
            delayTime: job.delay_time,
            reserveTime: now,
            expireTime: now + timeout * 1000
        };
    }
    async releaseJob(id) {
        await run(`UPDATE jobs SET 
        status = 'waiting',
        reserve_time = NULL,
        expire_time = NULL
       WHERE id = ?`, [parseInt(id)]);
    }
    async getJobStatus(id) {
        const job = await get(`SELECT status FROM jobs WHERE id = ?`, [parseInt(id)]);
        if (!job)
            return null;
        switch (job.status) {
            case 'waiting':
                return 'waiting';
            case 'reserved':
                return 'reserved';
            case 'done':
                return 'done';
            default:
                return null;
        }
    }
    async updateJobAttempt(id, attempt) {
        await run(`UPDATE jobs SET attempt = ? WHERE id = ?`, [attempt, parseInt(id)]);
    }
    async deleteJob(id) {
        await run(`DELETE FROM jobs WHERE id = ?`, [parseInt(id)]);
    }
    async markJobDone(id) {
        await run(`UPDATE jobs SET status = 'done', done_time = ? WHERE id = ?`, [Date.now(), parseInt(id)]);
    }
}
//# sourceMappingURL=sqlite-adapter.js.map