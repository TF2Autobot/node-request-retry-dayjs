'use strict';

const status = require('http-status');
const moment = require('moment');

const request = require('requestretry').defaults({
    timeout: 10000,
    maxAttempts: 5 + 1, // retry the request 5 times
    retryStrategy: retryStrategy,
    delayStrategy: delayStrategy
});

/**
 * A retry strategy let you specify when request-retry should retry a request
 * @param {Error|null} err
 * @param {Object|undefined} response
 * @param {String|Object|undefined} body
 * @return {Boolean} true if the request should be retried
 */
function retryStrategy (err, response, body) {
    if (err) {
        if (err.message.startsWith('tunneling socket could not be established')) {
            // Proxy failed
            return errorHandler.call(this, err, response, body);
        }
        return this.attempts >= this.options.maxAttempts ? errorHandler.call(this, err, response, body) : true;
    }

    const networkError = request.RetryStrategies.NetworkError(err, response, body);
    if (networkError !== null) {
        // Retry as long as there is a network error, until the max attempts has been reached.
        return this.attempts >= this.options.maxAttempts ? errorHandler.call(this, err, response, body) : true;
    }

    if (this.options.json === true && (!body || typeof body !== 'object')) {
        // We were expecting json but did not receive that
        err = new Error('Expected JSON');
        return errorHandler.call(this, err, response, body);
    }

    if (200 <= response.statusCode && response.statusCode <= 399) {
        // Successful response
        return false;
    } else if (response.statusCode == 500 && this.options.method !== 'GET') {
        // Only allow retrying when using GET
        return errorHandler.call(this, err, response, body);
    } else if (response.statusCode !== 429 && 400 <= response.statusCode && response.statusCode <= 499) {
        // Bad request, should not retry
        return errorHandler.call(this, err, response, body);
    } else if (this.attempts >= this.options.maxAttempts) {
        // Stop the loop from going maxAttempts does not end the retry loop if you have a retry strategy)
        return errorHandler.call(this, err, response, body);
    }

    return true;
}

/**
 * A delay strategy let you specify how long request-retry should wait before trying again the request
 * @param {Error|null} err
 * @param {Object|undefined} response
 * @param {String|Object|undefined} body
 * @return {Number} Milliseconds to wait
 */
function delayStrategy (err, response, body) {
    delete this.retryAfter;
    if (!response || response.statusCode !== 429) {
        return exponentialBackoff(this.attempts);
    }

    const retryAfter = response.headers['Retry-After'] || response.headers['retry-after'];
    if (retryAfter === undefined) {
        return exponentialBackoff(this.attempts);
    }

    let wait;

    if (/^\d+$/.test(retryAfter)) {
        // Retry in seconds
        wait = parseInt(retryAfter) * 1000;
    } else {
        const date = moment(retryAfter, 'ddd, DD MMM YYYY HH:mm:ss Z');

        if (date.isInvalid()) {
            // Unknown value for the retry after header, using default retry delay
            return exponentialBackoff(this.attempts);
        } else {
            // Retry using date
            wait = date.diff(moment(), 'milliseconds');
        }
    }

    // Set retry time for error
    this.retryAfter = wait;

    return wait;
}

function exponentialBackoff (attempts) {
    return (Math.pow(2, attempts - 1) * 1000) + Math.floor(Math.random() * 1000);
}

/**
 * Handles errors and replies to the caller
 * @param {Error|null} err
 * @param {Object|undefined} response
 * @param {String|Object|undefined} body
 * @return {Boolean}
 */
function errorHandler (err, response, body) {
    if (!err) {
        if (response) {
            err = new Error(status[response.statusCode]);
        } else {
            err = new Error('Too many failed attempts');
        }
    }

    if (response !== undefined) {
        err.statusCode = response.statusCode;
    }
    if (body !== undefined) {
        err.body = body;
    }

    err.attempts = this.attempts;
    if (this.retryAfter !== undefined) {
        err.retryAfter = this.retryAfter;
    }

    // Reply with either callback or promise (function from requestretry)
    this.reply(err, response, body);
    // Replace callbacks with dummy functions
    if (this._callback) {
        this._callback = noop;
    } else if (this._reject) {
        this._reject = noop;
    }

    // Stop retrying
    return false;
}

function noop () {}

module.exports = request;
