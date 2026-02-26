// Centralizes the existence + connection check used across the frontend.
/**
 * Returns the global EigennamenClient if it has been loaded, or null.
 * The client is exposed by socket-client.js which runs before the
 * ES module entry point — but this guard prevents crashes if the
 * script fails to load or is deferred unexpectedly.
 */
export function getClient() {
    return typeof EigennamenClient !== 'undefined' ? EigennamenClient : null;
}
/**
 * Combined existence + connection check.
 * Replaces the repeated pattern:
 *   `EigennamenClient && EigennamenClient.isConnected()`
 */
export function isClientConnected() {
    const client = getClient();
    return client !== null && client.isConnected();
}
//# sourceMappingURL=clientAccessor.js.map