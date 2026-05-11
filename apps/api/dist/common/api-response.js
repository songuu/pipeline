"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.fail = exports.ok = void 0;
const ok = (data, meta) => ({
    success: true,
    data,
    ...(meta ? { meta } : {}),
});
exports.ok = ok;
const fail = (message, meta) => ({
    success: false,
    error: message,
    ...(meta ? { meta } : {}),
});
exports.fail = fail;
//# sourceMappingURL=api-response.js.map