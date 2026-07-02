import { PrismaClient } from '@prisma/client';
import odoo from './src/services/odoo/odoo.service';

const prisma = new PrismaClient();

async function deleteVanAndLocation(plateNumber: string) {
  try {
    const van = await prisma.van.findUnique({
      where: { plateNumber },
      include: {
        shifts: true,
        stockQueue: true,
      }
    });

    if (!van) {
      console.log(`❌ Van with plate number "${plateNumber}" not found in local database.`);
      return;
    }

    console.log(`✅ Found Van: ${van.plateNumber} (ID: ${van.id})`);

    // 1. Archive the Location in Odoo (Hard deleting locations in Odoo is usually blocked if there are past stock moves)
    if (van.odooLocationId) {
      console.log(`⏳ Attempting to archive Odoo Location ID: ${van.odooLocationId}...`);
      try {
        await odoo.write('stock.location', [van.odooLocationId], { active: false });
        console.log(`✅ Successfully archived Odoo Location ID: ${van.odooLocationId}`);
      } catch (err: any) {
        console.error(`⚠️ Failed to archive Odoo location (might already be deleted/archived):`, err.message);
      }
    } else {
      console.log(`ℹ️ No Odoo Location ID associated with this van in the database.`);
    }

    // 2. Remove dependencies from local DB before deleting the Van
    console.log(`⏳ Cleaning up related database records...`);
    
    // Delete van inventory records
    await prisma.vanInventory.deleteMany({
      where: { vanId: van.id }
    });

    // Unlink stock adjustments (vanId is optional)
    await prisma.stockAdjustment.updateMany({
      where: { vanId: van.id },
      data: { vanId: null }
    });

    // Note: If the van has past Shifts or StockLoadQueue, Prisma will block the hard delete 
    // unless you delete those too. It is usually safer to soft-delete if history exists.
    if (van.shifts.length > 0 || van.stockQueue.length > 0) {
      console.log(`⚠️ This van has past shifts or stock loads. A hard delete might fail or erase history.`);
      console.log(`⏳ Soft-deleting (deactivating) the van and unlinking Odoo location instead...`);
      
      await prisma.van.update({
        where: { id: van.id },
        data: { 
          isActive: false,
          odooLocationId: null 
        }
      });
      console.log(`✅ Van deactivated in local database.`);
    } else {
      console.log(`⏳ Hard-deleting van from local database...`);
      await prisma.van.delete({
        where: { id: van.id }
      });
      console.log(`✅ Van completely removed from local database.`);
    }

  } catch (error) {
    console.error(`❌ An error occurred:`, error);
  } finally {
    await prisma.$disconnect();
  }
}

const plateNumberArg = process.argv[2];
if (!plateNumberArg) {
  console.log('Usage: npx ts-node delete-van.ts <PLATE_NUMBER>');
  process.exit(1);
}

deleteVanAndLocation(plateNumberArg);
