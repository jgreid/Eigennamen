import pkg from '../../package.json';

/** Application version from package.json (single source of truth) */
export const APP_VERSION: string = pkg.version;

/** Major version number (e.g. 5 from "5.5.0") */
export const APP_MAJOR_VERSION: number = parseInt(APP_VERSION.split('.')[0] ?? '0', 10);
