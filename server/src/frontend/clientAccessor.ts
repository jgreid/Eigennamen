// ========== CODENAMES CLIENT ACCESSOR ==========
// Safe accessor for the global CodenamesClient loaded via <script> tag.
// Centralizes the existence + connection check used across the frontend.

/**
 * Returns the global CodenamesClient if it has been loaded, or null.
 * The client is exposed by socket-client.js which runs before the
 * ES module entry point — but this guard prevents crashes if the
 * script fails to load or is deferred unexpectedly.
 */
export function getClient(): CodenamesClientAPI | null {
    return typeof CodenamesClient !== 'undefined' ? CodenamesClient : null;
}

/**
 * Combined existence + connection check.
 * Replaces the repeated pattern:
 *   `CodenamesClient && CodenamesClient.isConnected()`
 */
export function isClientConnected(): boolean {
    const client = getClient();
    return client !== null && client.isConnected();
}
