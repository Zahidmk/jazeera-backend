"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const prisma_1 = __importDefault(require("./prisma"));
const bcryptjs_1 = __importDefault(require("bcryptjs"));
async function main() {
    console.log('🌱 Seeding database...');
    // ─── Create test driver ───────────────────────────────────────────────────
    const passwordHash = await bcryptjs_1.default.hash('password123', 10);
    const driver = await prisma_1.default.user.upsert({
        where: { email: 'driver@jazeera.com' },
        update: {},
        create: {
            name: 'Ahmed Al-Rashid',
            email: 'driver@jazeera.com',
            phone: '+971501234567',
            passwordHash,
            role: 'DRIVER',
        },
    });
    console.log(`✅ Driver created: ${driver.email}`);
    const manager = await prisma_1.default.user.upsert({
        where: { email: 'manager@jazeera.com' },
        update: {},
        create: {
            name: 'Mohammed Al-Hussain',
            email: 'manager@jazeera.com',
            phone: '+971509876543',
            passwordHash,
            role: 'MANAGER',
        },
    });
    console.log(`✅ Manager created: ${manager.email}`);
    const admin = await prisma_1.default.user.upsert({
        where: { email: 'admin@jazeera.com' },
        update: {},
        create: {
            name: 'Jazeera Admin',
            email: 'admin@jazeera.com',
            phone: '+971500000001',
            passwordHash,
            role: 'ADMIN',
        },
    });
    console.log(`✅ Admin created: ${admin.email}`);
    // ─── Create van and assign to driver ─────────────────────────────────────
    const van = await prisma_1.default.van.upsert({
        where: { plateNumber: 'DXB-A-12345' },
        update: { driverId: driver.id },
        create: {
            plateNumber: 'DXB-A-12345',
            model: 'Toyota Hiace',
            driverId: driver.id,
        },
    });
    console.log(`✅ Van created: ${van.plateNumber}`);
    // ─── Create products ──────────────────────────────────────────────────────
    const products = [
        { sku: 'WTR-500ML', name: 'Mineral Water 500ml', nameAr: 'مياه معدنية 500 مل', category: 'Water', unit: 'pcs', priceRetail: 1.5, priceWhole: 1.2, barcode: '6281234500001' },
        { sku: 'WTR-1.5L', name: 'Mineral Water 1.5L', nameAr: 'مياه معدنية 1.5 لتر', category: 'Water', unit: 'pcs', priceRetail: 2.5, priceWhole: 2.0, barcode: '6281234500002' },
        { sku: 'JCE-ONG-1L', name: 'Orange Juice 1L', nameAr: 'عصير برتقال 1 لتر', category: 'Juice', unit: 'pcs', priceRetail: 5.0, priceWhole: 4.0, barcode: '6281234500003' },
        { sku: 'JCE-MNG-1L', name: 'Mango Juice 1L', nameAr: 'عصير مانجو 1 لتر', category: 'Juice', unit: 'pcs', priceRetail: 5.0, priceWhole: 4.0, barcode: '6281234500004' },
        { sku: 'MLK-FUL-1L', name: 'Full Fat Milk 1L', nameAr: 'حليب كامل الدسم 1 لتر', category: 'Dairy', unit: 'pcs', priceRetail: 4.5, priceWhole: 3.5, barcode: '6281234500005' },
        { sku: 'YGT-PLN-200', name: 'Plain Yogurt 200g', nameAr: 'زبادي سادة 200 جرام', category: 'Dairy', unit: 'pcs', priceRetail: 3.0, priceWhole: 2.5, barcode: '6281234500006' },
        { sku: 'SFD-CLN-330', name: 'Cola Soft Drink 330ml', nameAr: 'كولا 330 مل', category: 'Drinks', unit: 'pcs', priceRetail: 2.0, priceWhole: 1.6, barcode: '6281234500007' },
        { sku: 'SFD-SPR-330', name: 'Sprite 330ml', nameAr: 'سبرايت 330 مل', category: 'Drinks', unit: 'pcs', priceRetail: 2.0, priceWhole: 1.6, barcode: '6281234500008' },
    ];
    for (const p of products) {
        await prisma_1.default.product.upsert({
            where: { sku: p.sku },
            update: {},
            create: p,
        });
    }
    console.log(`✅ ${products.length} products created`);
    // ─── Create route ─────────────────────────────────────────────────────────
    const route = await prisma_1.default.route.create({
        data: { name: 'Dubai South Route', area: 'Dubai South', description: 'Covers Dubai South area' },
    });
    console.log(`✅ Route created: ${route.name}`);
    // ─── Create customers ─────────────────────────────────────────────────────
    const customer1 = await prisma_1.default.customer.create({
        data: { name: 'Al Madina Supermarket', phone: '+97142345678', address: 'Dubai South, Block A', lat: 24.8976, lng: 55.1578 },
    });
    const customer2 = await prisma_1.default.customer.create({
        data: { name: 'City Star Grocery', phone: '+97142345679', address: 'Dubai South, Block B', lat: 24.9010, lng: 55.1620 },
    });
    console.log('✅ 2 customers created');
    // ─── Create active shift for driver ──────────────────────────────────────
    const shift = await prisma_1.default.shift.create({
        data: { driverId: driver.id, vanId: van.id, routeId: route.id, status: 'ACTIVE' },
    });
    console.log(`✅ Active shift created: ${shift.id}`);
    // ─── Create van inventory (pre-loaded stock) ──────────────────────────────
    const allProducts = await prisma_1.default.product.findMany();
    for (const product of allProducts) {
        await prisma_1.default.vanInventory.upsert({
            where: { vanId_productId: { vanId: van.id, productId: product.id } },
            update: {},
            create: { vanId: van.id, productId: product.id, quantity: 50 },
        });
    }
    console.log('✅ Van inventory seeded (50 units per product)');
    // ─── Create sample deliveries ─────────────────────────────────────────────
    const productList = await prisma_1.default.product.findMany({ take: 3 });
    await prisma_1.default.delivery.create({
        data: {
            driverId: driver.id,
            customerId: customer1.id,
            routeId: route.id,
            status: 'PENDING',
            scheduledAt: new Date(),
            items: {
                create: [
                    { productId: productList[0].id, quantity: 24, unitPrice: productList[0].priceRetail },
                    { productId: productList[1].id, quantity: 12, unitPrice: productList[1].priceRetail },
                ],
            },
        },
    });
    await prisma_1.default.delivery.create({
        data: {
            driverId: driver.id,
            customerId: customer2.id,
            routeId: route.id,
            status: 'PENDING',
            scheduledAt: new Date(),
            items: {
                create: [
                    { productId: productList[2].id, quantity: 6, unitPrice: productList[2].priceRetail },
                ],
            },
        },
    });
    console.log('✅ 2 sample deliveries created');
    console.log('\n🎉 Seed complete!');
    console.log('─────────────────────────────────────────');
    console.log('🔑 Test login credentials:');
    console.log('   Driver  → email: driver@jazeera.com  | password: password123');
    console.log('   Manager → email: manager@jazeera.com | password: password123');
    console.log('   Admin   → email: admin@jazeera.com   | password: password123');
    console.log('─────────────────────────────────────────');
}
main()
    .catch(console.error)
    .finally(() => prisma_1.default.$disconnect());
//# sourceMappingURL=seed.js.map