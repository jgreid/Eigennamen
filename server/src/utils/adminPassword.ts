/**
 * Shared admin-password verification (scrypt KDF + constant-time compare).
 *
 * Single source of truth for "does this password match ADMIN_PASSWORD", used by
 * BOTH the admin router (`routes/adminRoutes.ts`) and the metrics-auth guard
 * (`routes/healthRoutes.ts`). Previously the metrics guard did a bespoke
 * plaintext compare with a length short-circuit (leaking the admin-password
 * length via timing, no KDF), diverging from the admin router's scrypt path — so
 * a future admin-auth change silently wouldn't cover `/health/metrics`. This
 * module ends that divergence (N35). Kept dependency-free (no route imports) so
 * either router can use it without a circular dependency.
 */
import crypto, { scrypt } from 'crypto';
import { promisify } from 'util';

const scryptAsync = promisify(scrypt) as (
    password: crypto.BinaryLike,
    salt: crypto.BinaryLike,
    keylen: number
) => Promise<Buffer>;

// Derive the salt from JWT_SECRET when available so identical passwords across
// deployments produce different hashes; otherwise a static fallback.
function getAdminScryptSalt(): string {
    return process.env.JWT_SECRET
        ? `eigennamen-admin-${crypto.createHash('sha256').update(process.env.JWT_SECRET).digest('hex').slice(0, 16)}`
        : 'eigennamen-admin-auth';
}

// Lazy, cached admin-password hash — computed on first verification rather than
// at module load. Caches a Promise so concurrent requests share one derivation,
// and recomputes if ADMIN_PASSWORD changes at runtime.
let cachedAdminHashPromise: Promise<Buffer> | null = null;
let cachedAdminPassword: string | undefined;

function getAdminHashAsync(adminPassword: string): Promise<Buffer> {
    if (!cachedAdminHashPromise || cachedAdminPassword !== adminPassword) {
        cachedAdminPassword = adminPassword;
        cachedAdminHashPromise = scryptAsync(adminPassword, getAdminScryptSalt(), 32);
    }
    return cachedAdminHashPromise;
}

/**
 * Constant-time verification that `supplied` matches the configured
 * `ADMIN_PASSWORD`, via scrypt. Returns false (never throws) when no admin
 * password is configured or the supplied value is empty/mismatched. The scrypt
 * work runs UNCONDITIONALLY on whatever was supplied, so timing and CPU stay
 * uniform regardless of the input — no length short-circuit, no early return on
 * a user-controlled value.
 */
export async function verifyAdminPassword(supplied: string): Promise<boolean> {
    const adminPassword = process.env.ADMIN_PASSWORD;
    if (!adminPassword) return false;
    const [suppliedHash, adminHash] = await Promise.all([
        scryptAsync(supplied ?? '', getAdminScryptSalt(), 32),
        getAdminHashAsync(adminPassword),
    ]);
    return crypto.timingSafeEqual(suppliedHash, adminHash);
}

// Test-only: drop the cached hash so a changed ADMIN_PASSWORD/JWT_SECRET takes effect.
export function resetAdminHashCache(): void {
    cachedAdminHashPromise = null;
    cachedAdminPassword = undefined;
}
