export class JsonSerializer {
    serialize(job) {
        return Buffer.from(JSON.stringify(job), 'utf8');
    }
    deserialize(payload) {
        return JSON.parse(payload.toString('utf8'));
    }
}
export class DefaultSerializer {
    jobRegistry = new Map();
    registerJob(name, jobClass) {
        this.jobRegistry.set(name, jobClass);
    }
    serialize(job) {
        if (typeof job.serialize === 'function') {
            return Buffer.from(JSON.stringify(job.serialize()), 'utf8');
        }
        // For jobs without custom serialization, include constructor name
        const data = {
            constructor: job.constructor.name,
            ...job
        };
        return Buffer.from(JSON.stringify(data), 'utf8');
    }
    deserialize(payload) {
        const data = JSON.parse(payload.toString('utf8'));
        // If job is registered and has deserialize method
        if (data.constructor && this.jobRegistry.has(data.constructor)) {
            const JobClass = this.jobRegistry.get(data.constructor);
            if (JobClass.deserialize) {
                return JobClass.deserialize(data);
            }
        }
        // Default behavior - return data as is
        return data;
    }
}
//# sourceMappingURL=serializer.js.map