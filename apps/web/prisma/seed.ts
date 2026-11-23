// Seeds the merchants listed in apps/web/data/merchants.json. Venues that registered
// themselves in the partner portal (ids "v_…") are left alone; older seeded demo
// venues ("m_…") that are no longer in the file are removed.
import { PrismaClient } from "@prisma/client";
import merchantsData from "../data/merchants.json";

const prisma = new PrismaClient();

async function main() {
  const { merchants } = merchantsData as {
    merchants: { id: string; name: string; osmId: string; walletAddress: string; prepay?: boolean }[];
  };
  for (const m of merchants) {
    await prisma.merchant.upsert({
      where: { id: m.id },
      create: { ...m, prepay: !!m.prepay },
      update: { name: m.name, osmId: m.osmId, walletAddress: m.walletAddress, prepay: !!m.prepay },
    });
  }
  const keep = merchants.map((m) => m.id);
  const stale = await prisma.merchant.findMany({ where: { id: { startsWith: "m_", notIn: keep } }, select: { id: true } });
  if (stale.length) {
    const ids = stale.map((m) => m.id);
    // Old trips keep their stops; they just no longer point at a venue.
    await prisma.stop.updateMany({ where: { merchantId: { in: ids } }, data: { merchantId: null } });
    await prisma.merchant.deleteMany({ where: { id: { in: ids } } });
  }
  console.log(`Seeded ${merchants.length} merchants, removed ${stale.length} old demo venues`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
