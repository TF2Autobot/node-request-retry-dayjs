'use strict';

const status = require('http-status');

const request = require('requestretry').defaults({
    timeout: 3000,
    maxAttempts: 3,
    retryStrategy: retryStrategy,
    delayStrategy: delayStrategy
});

function retryStrategy (err, response, body) {
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
    } else if (500 <= response.statusCode && response.statusCode <= 599 && this.attempts >= 2) {
        // Internal server error, should only try two times
        return errorHandler.call(this, err, response, body);
    } else if (response.statusCode === 429 && this.attempts >= 2) {
        // Ratelimited, will only retry once
        return errorHandler.call(this, err, response, body);
    } else if (400 <= response.statusCode && response.statusCode <= 499) {
        // Bad request, should not retry
        return errorHandler.call(this, err, response, body);
    } else if (this.attempts >= this.options.maxAttempts) {
        // Stop the loop from going maxAttempts does not end the retry loop if you have a retry strategy)
        return errorHandler.call(this, err, response, body);
    }

    return true;
}

function delayStrategy (err, response, body) {
    // TODO: Check for retry headers
    return this.options.retryDelay;
}

function errorHandler (err, response, body) {
    if (!err) {
        if (response) {
            err = new Error(status[response.statusCode]);
        } else {
            err = new Error('Too many attempts');
        }
    }

    if (response) {
        err.statusCode = response.statusCode;
    }
    if (body) {
        err.body = body;
    }

    err.attempts = this.attempts;

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
