import prisma from './src/utils/prisma';

async function main() {
  try {
    // get a valid van and driver
    const vanInv = await prisma.vanInventory.findFirst({
      where: { quantity: { gt: 0 } },
      include: { van: true }
    });
    if (!vanInv) {
      console.log('No van inventory found with quantity > 0');
      return;
    }
    const vanId = vanInv.vanId;
    const driverId = vanInv.van.driverId;
    const productId = vanInv.productId;
    const quantity = 1;
    const reason = 'DAMAGE';
    const notes = undefined;

    console.log(`Using Driver: ${driverId}, Van: ${vanId}, Product: ${productId}`);

    await prisma.$transaction(async (tx) => {
      await tx.vanInventory.update({
        where: { vanId_productId: { vanId, productId } },
        data: { quantity: { decrement: Math.abs(quantity) } },
      });
      await tx.stockAdjustment.create({
        data: { 
          driverId: driverId as string, 
          vanId,
          productId, 
          quantity: -Math.abs(quantity), 
          reason: reason as any, 
          notes,
          status: 'PENDING'
        },
      });
      
      // Rollback
      throw new Error('ROLLBACK_TEST');
    });

  } catch(e: any) {
    if (e.message === 'ROLLBACK_TEST') {
      console.log('Transaction succeeded, rolled back intentionally');
    } else {
      console.error("Error:", e);
    }
  } finally {
    await prisma.$disconnect();
  }
}
main();
