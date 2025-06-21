import { Job, Queue } from '@muniter/queue';
export declare class EmailJob implements Job {
    private to;
    private subject;
    private body;
    constructor(to: string, subject: string, body: string);
    execute(queue: Queue): Promise<void>;
}
export declare class ImageProcessingJob implements Job<{
    width: number;
    height: number;
}> {
    private url;
    private resize?;
    constructor(url: string, resize?: {
        width: number;
        height: number;
    } | undefined);
    execute(queue: Queue): Promise<{
        width: number;
        height: number;
    }>;
}
export declare class ReportGeneratorJob implements Job {
    private type;
    private period;
    constructor(type: string, period: string);
    execute(queue: Queue): Promise<void>;
}
//# sourceMappingURL=job-processors.d.ts.map