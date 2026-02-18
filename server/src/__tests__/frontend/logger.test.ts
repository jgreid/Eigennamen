/**
 * Frontend Logger Module Tests
 *
 * Tests the ACTUAL logger from src/frontend/logger.ts.
 * No re-implementations — imports the real code directly.
 *
 * Test environment: jsdom (provides window, localStorage, console).
 */

import { logger } from '../../frontend/logger';

describe('logger', () => {
    let consoleLogSpy: jest.SpyInstance;
    let consoleInfoSpy: jest.SpyInstance;
    let consoleWarnSpy: jest.SpyInstance;
    let consoleErrorSpy: jest.SpyInstance;

    beforeEach(() => {
        consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();
        consoleInfoSpy = jest.spyOn(console, 'info').mockImplementation();
        consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();
        consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
    });

    afterEach(() => {
        // Reset to default level after each test
        logger.setLevel('warn');
    });

    describe('at default warn level', () => {
        it('debug does not log', () => {
            logger.setLevel('warn');
            logger.debug('debug message');
            expect(consoleLogSpy).not.toHaveBeenCalled();
        });

        it('info does not log', () => {
            logger.setLevel('warn');
            logger.info('info message');
            expect(consoleInfoSpy).not.toHaveBeenCalled();
        });

        it('warn logs', () => {
            logger.setLevel('warn');
            logger.warn('warning message');
            expect(consoleWarnSpy).toHaveBeenCalled();
        });

        it('error logs', () => {
            logger.setLevel('warn');
            logger.error('error message');
            expect(consoleErrorSpy).toHaveBeenCalled();
        });
    });

    describe('setLevel("debug") enables all levels', () => {
        beforeEach(() => {
            logger.setLevel('debug');
        });

        it('debug logs via console.log', () => {
            logger.debug('test debug');
            expect(consoleLogSpy).toHaveBeenCalled();
        });

        it('info logs via console.info', () => {
            logger.info('test info');
            expect(consoleInfoSpy).toHaveBeenCalled();
        });

        it('warn logs via console.warn', () => {
            logger.warn('test warn');
            expect(consoleWarnSpy).toHaveBeenCalled();
        });

        it('error logs via console.error', () => {
            logger.error('test error');
            expect(consoleErrorSpy).toHaveBeenCalled();
        });
    });

    describe('setLevel("error") disables warn', () => {
        beforeEach(() => {
            logger.setLevel('error');
        });

        it('warn does not log', () => {
            logger.warn('suppressed warning');
            expect(consoleWarnSpy).not.toHaveBeenCalled();
        });

        it('error still logs', () => {
            logger.error('visible error');
            expect(consoleErrorSpy).toHaveBeenCalled();
        });

        it('debug does not log', () => {
            logger.debug('suppressed debug');
            expect(consoleLogSpy).not.toHaveBeenCalled();
        });

        it('info does not log', () => {
            logger.info('suppressed info');
            expect(consoleInfoSpy).not.toHaveBeenCalled();
        });
    });

    describe('each method calls the correct console function', () => {
        beforeEach(() => {
            logger.setLevel('debug');
        });

        it('debug calls console.log', () => {
            logger.debug('msg');
            expect(consoleLogSpy).toHaveBeenCalledTimes(1);
            expect(consoleInfoSpy).not.toHaveBeenCalled();
            expect(consoleWarnSpy).not.toHaveBeenCalled();
            expect(consoleErrorSpy).not.toHaveBeenCalled();
        });

        it('info calls console.info', () => {
            logger.info('msg');
            expect(consoleInfoSpy).toHaveBeenCalledTimes(1);
            expect(consoleLogSpy).not.toHaveBeenCalled();
            expect(consoleWarnSpy).not.toHaveBeenCalled();
            expect(consoleErrorSpy).not.toHaveBeenCalled();
        });

        it('warn calls console.warn', () => {
            logger.warn('msg');
            expect(consoleWarnSpy).toHaveBeenCalledTimes(1);
            expect(consoleLogSpy).not.toHaveBeenCalled();
            expect(consoleInfoSpy).not.toHaveBeenCalled();
            expect(consoleErrorSpy).not.toHaveBeenCalled();
        });

        it('error calls console.error', () => {
            logger.error('msg');
            expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
            expect(consoleLogSpy).not.toHaveBeenCalled();
            expect(consoleInfoSpy).not.toHaveBeenCalled();
            expect(consoleWarnSpy).not.toHaveBeenCalled();
        });
    });

    describe('messages are prefixed with [Eigennamen]', () => {
        beforeEach(() => {
            logger.setLevel('debug');
        });

        it('debug includes prefix', () => {
            logger.debug('my debug message');
            expect(consoleLogSpy).toHaveBeenCalledWith('[Eigennamen]', 'my debug message');
        });

        it('info includes prefix', () => {
            logger.info('my info message');
            expect(consoleInfoSpy).toHaveBeenCalledWith('[Eigennamen]', 'my info message');
        });

        it('warn includes prefix', () => {
            logger.warn('my warn message');
            expect(consoleWarnSpy).toHaveBeenCalledWith('[Eigennamen]', 'my warn message');
        });

        it('error includes prefix', () => {
            logger.error('my error message');
            expect(consoleErrorSpy).toHaveBeenCalledWith('[Eigennamen]', 'my error message');
        });

        it('passes multiple arguments after prefix', () => {
            logger.debug('arg1', 'arg2', 42);
            expect(consoleLogSpy).toHaveBeenCalledWith('[Eigennamen]', 'arg1', 'arg2', 42);
        });
    });

    describe('setLevel("info") enables info, warn, error but not debug', () => {
        beforeEach(() => {
            logger.setLevel('info');
        });

        it('debug does not log', () => {
            logger.debug('hidden');
            expect(consoleLogSpy).not.toHaveBeenCalled();
        });

        it('info logs', () => {
            logger.info('visible');
            expect(consoleInfoSpy).toHaveBeenCalled();
        });

        it('warn logs', () => {
            logger.warn('visible');
            expect(consoleWarnSpy).toHaveBeenCalled();
        });

        it('error logs', () => {
            logger.error('visible');
            expect(consoleErrorSpy).toHaveBeenCalled();
        });
    });
});
