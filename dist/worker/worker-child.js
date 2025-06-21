import { DefaultSerializer } from "../core/serializer.js";
const serializer = new DefaultSerializer();
(async () => {
    const chunks = [];
    for await (const chunk of process.stdin) {
        chunks.push(chunk);
    }
    try {
        const payload = Buffer.concat(chunks);
        const job = serializer.deserialize(payload);
        if (typeof job.execute !== 'function') {
            throw new Error('Job must have an execute method');
        }
        await job.execute();
        process.exit(0);
    }
    catch (error) {
        console.error('Job execution failed:', error);
        process.exit(1);
    }
})();
//# sourceMappingURL=worker-child.js.map