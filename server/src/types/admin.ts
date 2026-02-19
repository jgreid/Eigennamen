/**
 * Shared types for admin routes.
 *
 * Previously duplicated across adminRoutes.ts, admin/roomRoutes.ts,
 * and admin/statsRoutes.ts.
 */

import type { Request, Application } from 'express';
import type { Server } from 'socket.io';

export interface AdminRequest extends Request {
    adminUsername?: string;
    app: Application & {
        get(key: 'io'): Server | undefined;
    };
}
