export interface Serializer {
    serialize(job: any): Buffer;
    deserialize(payload: Buffer): any;
}
export declare class JsonSerializer implements Serializer {
    serialize(job: any): Buffer;
    deserialize(payload: Buffer): any;
}
export declare class DefaultSerializer implements Serializer {
    private jobRegistry;
    registerJob(name: string, jobClass: any): void;
    serialize(job: any): Buffer;
    deserialize(payload: Buffer): any;
}
