"use strict";
/**
 * Reports Controller — CSV & PDF export
 * GET /api/v1/admin/reports/export?type=csv|pdf&report=daily|deliveries|sales&date=YYYY-MM-DD
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.exportReport = void 0;
const json2csv_1 = require("json2csv");
const prisma_1 = __importDefault(require("../utils/prisma"));
// ─── Export Report ─────────────────────────────────────────────────────────────
const exportReport = async (req, res) => {
    try {
        const { type = 'csv', report = 'daily', date, driverId, startDate, endDate, } = req.query;
        // Build date range
        let from;
        let to;
        if (startDate && endDate) {
            from = new Date(startDate);
            to = new Date(endDate);
            to.setDate(to.getDate() + 1);
        }
        else {
            from = date ? new Date(date) : new Date(new Date().toISOString().split('T')[0]);
            to = new Date(from);
            to.setDate(from.getDate() + 1);
        }
        if (report === 'deliveries') {
            await exportDeliveries(res, from, to, driverId, type);
        }
        else if (report === 'sales') {
            await exportSales(res, from, to, driverId, type);
        }
        else {
            await exportDailyReport(res, from, type);
        }
    }
    catch (err) {
        console.error(err);
        res.status(500).json({ success: false, error: `Export failed: ${err.message}` });
    }
};
exports.exportReport = exportReport;
// ─── Export Deliveries ─────────────────────────────────────────────────────────
async function exportDeliveries(res, from, to, driverId, type) {
    const where = { scheduledAt: { gte: from, lt: to } };
    if (driverId)
        where.driverId = driverId;
    const deliveries = await prisma_1.default.delivery.findMany({
        where,
        include: {
            driver: { select: { name: true } },
            customer: { select: { name: true, phone: true, address: true } },
            items: { include: { product: { select: { name: true, sku: true } } } },
        },
        orderBy: { scheduledAt: 'asc' },
    });
    const rows = deliveries.map((d) => ({
        id: d.id,
        driver: d.driver.name,
        customer: d.customer.name,
        customerPhone: d.customer.phone || '',
        address: d.customer.address || '',
        status: d.status,
        scheduledAt: d.scheduledAt?.toISOString() || '',
        deliveredAt: d.deliveredAt?.toISOString() || '',
        failReason: d.failReason || '',
        items: d.items.map((i) => `${i.product.name} x${i.quantity}`).join('; '),
        odooOrderId: d.odooOrderId || '',
    }));
    if (type === 'pdf') {
        await renderPdf(res, 'Deliveries Report', rows, from, to);
    }
    else {
        renderCsv(res, rows, `deliveries_${from.toISOString().split('T')[0]}`);
    }
}
// ─── Export Sales ──────────────────────────────────────────────────────────────
async function exportSales(res, from, to, driverId, type) {
    const where = { createdAt: { gte: from, lt: to } };
    if (driverId)
        where.driverId = driverId;
    const sales = await prisma_1.default.cashSale.findMany({
        where,
        include: {
            driver: { select: { name: true } },
            customer: { select: { name: true } },
            items: { include: { product: { select: { name: true, sku: true } } } },
        },
        orderBy: { createdAt: 'desc' },
    });
    const rows = sales.map((s) => ({
        id: s.id,
        driver: s.driver.name,
        customer: s.customer?.name || 'Walk-in',
        saleType: s.saleType,
        totalAmount: s.totalAmount.toFixed(2),
        items: s.items.map((i) => `${i.product.name} x${i.quantity} @ ${i.unitPrice}`).join('; '),
        receiptUrl: s.receiptUrl || '',
        odooSaleId: s.odooSaleId || '',
        createdAt: s.createdAt.toISOString(),
    }));
    if (type === 'pdf') {
        await renderPdf(res, 'Cash Sales Report', rows, from, to);
    }
    else {
        renderCsv(res, rows, `sales_${from.toISOString().split('T')[0]}`);
    }
}
// ─── Export Daily Summary ──────────────────────────────────────────────────────
async function exportDailyReport(res, from, type) {
    const to = new Date(from);
    to.setDate(from.getDate() + 1);
    const [deliveries, cashSales, adjustments] = await Promise.all([
        prisma_1.default.delivery.groupBy({
            by: ['status'],
            where: { scheduledAt: { gte: from, lt: to } },
            _count: { status: true },
        }),
        prisma_1.default.cashSale.aggregate({
            where: { createdAt: { gte: from, lt: to } },
            _sum: { totalAmount: true },
            _count: true,
        }),
        prisma_1.default.stockAdjustment.groupBy({
            by: ['reason'],
            where: { createdAt: { gte: from, lt: to } },
            _count: { reason: true },
            _sum: { quantity: true },
        }),
    ]);
    const rows = [
        { metric: 'Date', value: from.toISOString().split('T')[0] },
        { metric: 'Total Deliveries', value: deliveries.reduce((s, d) => s + d._count.status, 0) },
        ...deliveries.map((d) => ({ metric: `Deliveries - ${d.status}`, value: d._count.status })),
        { metric: 'Cash Sales Count', value: cashSales._count },
        { metric: 'Cash Sales Revenue', value: (cashSales._sum.totalAmount ?? 0).toFixed(2) },
        ...adjustments.map((a) => ({
            metric: `Stock Adjustment - ${a.reason}`,
            value: Math.abs(a._sum.quantity ?? 0),
        })),
    ];
    if (type === 'pdf') {
        await renderPdf(res, 'Daily Summary Report', rows, from, to);
    }
    else {
        renderCsv(res, rows, `daily_report_${from.toISOString().split('T')[0]}`);
    }
}
// ─── CSV renderer ─────────────────────────────────────────────────────────────
function renderCsv(res, rows, filename) {
    if (rows.length === 0) {
        res.status(200).send('');
        return;
    }
    const parser = new json2csv_1.Parser({ fields: Object.keys(rows[0]) });
    const csv = parser.parse(rows);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}.csv"`);
    res.send(csv);
}
// ─── PDF renderer (puppeteer) ─────────────────────────────────────────────────
async function renderPdf(res, title, rows, from, to) {
    // Dynamic import to avoid loading puppeteer at startup
    const puppeteer = await Promise.resolve().then(() => __importStar(require('puppeteer')));
    const browser = await puppeteer.default.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'] });
    const page = await browser.newPage();
    const headers = rows.length > 0 ? Object.keys(rows[0]) : [];
    const tableRows = rows
        .map((row) => `<tr>${headers.map((h) => `<td>${row[h] ?? ''}</td>`).join('')}</tr>`)
        .join('');
    const html = `
    <!DOCTYPE html><html><head>
    <meta charset="utf-8"/>
    <style>
      body { font-family: Arial, sans-serif; padding: 20px; color: #333; }
      h1 { font-size: 20px; margin-bottom: 4px; }
      p.sub { font-size: 12px; color: #666; margin-bottom: 16px; }
      table { width: 100%; border-collapse: collapse; font-size: 12px; }
      th { background: #2563eb; color: white; padding: 8px; text-align: left; }
      td { padding: 6px 8px; border-bottom: 1px solid #e5e7eb; }
      tr:nth-child(even) td { background: #f9fafb; }
    </style></head><body>
    <h1>${title}</h1>
    <p class="sub">Period: ${from.toISOString().split('T')[0]} — ${to.toISOString().split('T')[0]} | Generated: ${new Date().toISOString()}</p>
    <table>
      <thead><tr>${headers.map((h) => `<th>${h}</th>`).join('')}</tr></thead>
      <tbody>${tableRows}</tbody>
    </table>
    </body></html>`;
    await page.setContent(html, { waitUntil: 'networkidle0' });
    const pdfBuffer = await page.pdf({ format: 'A4', printBackground: true });
    await browser.close();
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${title.replace(/\s+/g, '_')}_${from.toISOString().split('T')[0]}.pdf"`);
    res.send(pdfBuffer);
}
//# sourceMappingURL=reports.controller.js.map