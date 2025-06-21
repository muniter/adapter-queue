import { DbQueue } from '@muniter/queue';
import { SQLiteDatabaseAdapter } from './sqlite-adapter.js';
export class SQLiteQueue extends DbQueue {
    constructor(queueName) {
        const adapter = new SQLiteDatabaseAdapter();
        super(queueName, adapter);
    }
}
//# sourceMappingURL=sqlite-queue.js.map