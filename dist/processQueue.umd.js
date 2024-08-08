(function (global, factory) {
    typeof exports === 'object' && typeof module !== 'undefined' ? module.exports = factory() :
    typeof define === 'function' && define.amd ? define(factory) :
    (global = typeof globalThis !== 'undefined' ? globalThis : global || self, global.processQueue = factory());
})(this, (function () { 'use strict';

    /******************************************************************************
    Copyright (c) Microsoft Corporation.

    Permission to use, copy, modify, and/or distribute this software for any
    purpose with or without fee is hereby granted.

    THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH
    REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY
    AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT,
    INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM
    LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR
    OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR
    PERFORMANCE OF THIS SOFTWARE.
    ***************************************************************************** */
    /* global Reflect, Promise, SuppressedError, Symbol */


    function __spreadArray(to, from, pack) {
        if (pack || arguments.length === 2) for (var i = 0, l = from.length, ar; i < l; i++) {
            if (ar || !(i in from)) {
                if (!ar) ar = Array.prototype.slice.call(from, 0, i);
                ar[i] = from[i];
            }
        }
        return to.concat(ar || Array.prototype.slice.call(from));
    }

    typeof SuppressedError === "function" ? SuppressedError : function (error, suppressed, message) {
        var e = new Error(message);
        return e.name = "SuppressedError", e.error = error, e.suppressed = suppressed, e;
    };

    var ProcessQueue = /** @class */ (function () {
        function ProcessQueue(_emplace) {
            if (_emplace === void 0) { _emplace = false; }
            var _this = this;
            this._emplace = _emplace;
            this._queue = [];
            this._inProcess = new Map();
            this.isProcessing = function (id) {
                return !!_this._inProcess.get(id);
            };
            this.queueItem = function (item) {
                if (_this.isProcessing(item.id)) {
                    return false;
                }
                var idx = _this._queue.findIndex(function (t) { return t.id === item.id; });
                if (_this._emplace) {
                    if (idx >= 0) {
                        _this._queue.splice(idx, 1, item);
                        return true;
                    }
                    _this._queue.push(item);
                    return true;
                }
                if (idx >= 0) {
                    _this._queue.splice(idx, 1);
                }
                _this._queue.unshift(item);
                return true;
            };
            this.getNextItem = function () {
                var item = _this._queue.shift();
                if (!item) {
                    return null;
                }
                // it's okay to set the item again
                _this._inProcess.set(item.id, item);
                return item;
            };
            this.getQueue = function (processing) {
                if (processing === void 0) { processing = false; }
                if (processing) {
                    _this._queue.forEach(function (t) {
                        _this._inProcess.set(t.id, t);
                    });
                    var temp = __spreadArray([], _this._queue, true);
                    _this._queue.splice(0, _this._queue.length);
                    return temp;
                }
                return __spreadArray([], _this._queue, true);
            };
            this.removeFromQueue = function (id) {
                var idx = _this._queue.findIndex(function (t) { return t.id === id; });
                if (idx !== -1) {
                    _this._queue.splice(idx, 1);
                    return true;
                }
                return false;
            };
            this.doneProcessing = function (id) {
                if (id !== undefined) {
                    _this._inProcess.delete(id);
                    return;
                }
                _this._inProcess.clear();
            };
            this.length = function (prop, val) {
                if (!_this._queue.length) {
                    return 0;
                }
                if (prop !== undefined && _this._queue.length && _this._queue[0][prop] !== undefined && val !== undefined) {
                    return _this._queue.filter(function (q) { return q[prop] === val; }).length;
                }
                return _this._queue.length;
            };
            this.busy = function () {
                return _this._inProcess.size > 0;
            };
            this.processSize = function () {
                return _this._inProcess.size;
            };
        }
        return ProcessQueue;
    }());

    return ProcessQueue;

}));
