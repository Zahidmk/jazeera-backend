"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const helmet_1 = __importDefault(require("helmet"));
const morgan_1 = __importDefault(require("morgan"));
const dotenv_1 = __importDefault(require("dotenv"));
const path_1 = __importDefault(require("path"));
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
dotenv_1.default.config({ path: path_1.default.resolve(__dirname, '../.env') });
const errorHandler_1 = require("./middleware/errorHandler");
const auth_routes_1 = __importDefault(require("./routes/auth.routes"));
const driver_routes_1 = __importDefault(require("./routes/driver.routes"));
const product_routes_1 = __importDefault(require("./routes/product.routes"));
const cashSale_routes_1 = __importDefault(require("./routes/cashSale.routes"));
const sync_routes_1 = __importDefault(require("./routes/sync.routes"));
const admin_routes_1 = __importDefault(require("./routes/admin.routes"));
const odoo_routes_1 = __importDefault(require("./routes/odoo.routes"));
const salesman_routes_1 = __importDefault(require("./routes/salesman.routes"));
const storekeeper_routes_1 = __importDefault(require("./routes/storekeeper.routes"));
const app = (0, express_1.default)();
const PORT = process.env.PORT || 3000;
// ─── Middleware ──────────────────────────────────────────────────────────────
app.use((0, helmet_1.default)());
app.use((0, cors_1.default)({
    origin: (process.env.ALLOWED_ORIGINS || 'http://localhost:3001').split(','),
    credentials: true,
}));
app.use((0, morgan_1.default)('dev'));
app.use(express_1.default.json());
app.use(express_1.default.urlencoded({ extended: true }));
// ─── Rate Limiting ────────────────────────────────────────────────────────────
const authLimiter = (0, express_rate_limit_1.default)({
    windowMs: 15 * 60 * 1000, // 15 min
    max: 20,
    message: { success: false, error: 'Too many requests, please try again later.' },
    standardHeaders: true,
    legacyHeaders: false,
});
const webhookLimiter = (0, express_rate_limit_1.default)({
    windowMs: 60 * 1000, // 1 min
    max: 120,
    message: { success: false, error: 'Webhook rate limit exceeded.' },
});
const apiLimiter = (0, express_rate_limit_1.default)({
    windowMs: 60 * 1000,
    max: 300,
    message: { success: false, error: 'API rate limit exceeded.' },
});
app.use('/api/v1/auth', authLimiter);
app.use('/api/v1/sync/webhook', webhookLimiter);
app.use('/api/', apiLimiter);
// Static uploads
app.use('/uploads', express_1.default.static(path_1.default.join(__dirname, '..', 'uploads')));
// ─── Health Check ────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => {
    res.json({ success: true, message: 'Jazeera API is running 🚀', timestamp: new Date() });
});
// ─── Routes ──────────────────────────────────────────────────────────────────
app.use('/api/v1/auth', auth_routes_1.default);
app.use('/api/v1/driver', driver_routes_1.default);
app.use('/api/v1/products', product_routes_1.default);
app.use('/api/v1/driver/sales', cashSale_routes_1.default);
app.use('/api/v1/sync', sync_routes_1.default);
app.use('/api/v1/admin', admin_routes_1.default);
app.use('/api/v1/odoo', odoo_routes_1.default);
app.use('/api/v1/salesman', salesman_routes_1.default);
app.use('/api/v1/storekeeper', storekeeper_routes_1.default);
// ─── 404 ─────────────────────────────────────────────────────────────────────
app.use((_req, res) => {
    res.status(404).json({ success: false, error: 'Route not found' });
});
// ─── Global Error Handler ────────────────────────────────────────────────────
app.use(errorHandler_1.errorHandler);
// ─── Start ───────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
    console.log(`✅ Server running on http://localhost:${PORT}`);
    console.log(`📋 Health: http://localhost:${PORT}/health`);
    // ── Start BullMQ workers (background job processors)
    const { startWorkers } = require('./workers/sync.worker');
    startWorkers();
    // ── Start cron polling jobs (safety-net fallback)
    const { startAllCronJobs } = require('./jobs/cron');
    startAllCronJobs();
});
exports.default = app;
//# sourceMappingURL=index.js.map