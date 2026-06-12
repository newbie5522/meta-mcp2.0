import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function runAudit() {
  const store = await prisma.store.findUnique({
    where: { name: "Romanticed" }
  });

  if (!store) {
    console.log("No store found");
    return;
  }

  const orders = await prisma.order.findMany({
    where: { storeId: store.id },
    take: 10
  });

  console.log("Sample Orders from database:");
  orders.forEach(o => {
    console.log(`id: ${o.id}, orderId: ${o.orderId}, revenue: ${o.revenue}, total: ${o.orderTotal}, createdAt (Date object): ${o.createdAt.toISOString()}, storeLocalField: ${o.store_local_date}`);
  });

  await prisma.$disconnect();
}

runAudit();
