import { prisma } from './src/utils/prisma';

async function clearVanStock() {
  try {
    console.log('⏳ Clearing VanInventory...');
    const inventoryResult = await prisma.vanInventory.deleteMany({});
    console.log(`✅ Deleted ${inventoryResult.count} records from VanInventory.`);

    console.log('⏳ Clearing StockLoadQueue...');
    const queueResult = await prisma.stockLoadQueue.deleteMany({});
    console.log(`✅ Deleted ${queueResult.count} records from StockLoadQueue.`);

    console.log('🎉 Successfully cleared all van stock and warehouse load queue data.');
  } catch (error) {
    console.error('❌ Error clearing van stock:', error);
  } finally {
    // If we wanted to disconnect, but prisma adapter manages the pool
    console.log('Finished.');
    process.exit(0);
  }
}

clearVanStock();
