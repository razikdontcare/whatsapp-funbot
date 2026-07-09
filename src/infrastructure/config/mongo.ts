import {MongoClient, ServerApiVersion} from 'mongodb';
import {Logger} from '../../shared/logger/logger.js';

const log = new Logger({
    level: 'debug',
    displayTimestamp: true,
    displayLevel: true,
});

let client: MongoClient | null = null;
let connectionPromise: Promise<MongoClient> | null = null;
let lastPingCheck = 0;
let isConnected = false;
const PING_INTERVAL = 30000; // 30 seconds

function setupClientListeners(mongoClient: MongoClient) {
    mongoClient.on('connectionCreated', () => {
        isConnected = true;
        log.info('[MongoDB] Connection created');
    });
    mongoClient.on('connectionClosed', () => {
        isConnected = false;
        log.warn('[MongoDB] Connection closed');
    });
    mongoClient.on('topologyClosed', () => {
        isConnected = false;
        log.warn('[MongoDB] Topology closed');
    });
}

export async function getMongoClient(): Promise<MongoClient> {
    // If we have a healthy client and it's recently pinged, return it
    if (client && isConnected && (Date.now() - lastPingCheck <= PING_INTERVAL)) {
        return client;
    }

    // If a connection or health check is already in progress, wait for it
    if (connectionPromise) {
        return connectionPromise;
    }

    // Start connection or health check process
    connectionPromise = (async () => {
        try {
            const uri = process.env.MONGO_URI!;
            
            if (!client) {
                client = new MongoClient(uri, {
                    serverApi: {
                        version: ServerApiVersion.v1,
                        strict: true,
                        deprecationErrors: true,
                    },
                });
                setupClientListeners(client);
                await client.connect();
                isConnected = true;
                lastPingCheck = Date.now();
                log.info('[MongoDB] Connected successfully');
            } else if (Date.now() - lastPingCheck > PING_INTERVAL) {
                try {
                    await client.db('admin').command({ping: 1});
                    lastPingCheck = Date.now();
                } catch (_error) {
                    log.error('[MongoDB] Ping failed, reconnecting...', _error);
                    // Connection lost, reconnect
                    await client.close(true).catch(() => {});
                    isConnected = false;
                    client = new MongoClient(uri);
                    setupClientListeners(client);
                    await client.connect();
                    isConnected = true;
                    lastPingCheck = Date.now();
                    log.info('[MongoDB] Reconnected successfully');
                }
            }
            return client!;
        } finally {
            connectionPromise = null;
        }
    })();

    return connectionPromise;
}

export async function closeMongoClient(): Promise<void> {
    if (client) {
        await client.close(true).catch(() => {});
        client = null;
        isConnected = false;
        log.info('[MongoDB] Client closed');
    }
}

export function isMongoConnected(): boolean {
    return client !== null && isConnected;
}

export function getActiveMongoClient(): MongoClient {
    if (!client) {
        throw new Error('MongoClient is not initialized. Call getMongoClient() first.');
    }
    return client;
}
