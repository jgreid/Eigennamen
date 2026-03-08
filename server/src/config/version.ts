import pkg from '../../package.json';

/** Application version from package.json (single source of truth) */
export const APP_VERSION: string = pkg.version;

/** Major version number (e.g. 5 from "5.4.0-beta.5") */
export const APP_MAJOR_VERSION: number = parseInt(APP_VERSION.split('.')[0] ?? '0', 10);
