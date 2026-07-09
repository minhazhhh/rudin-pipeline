// Runs as part of the production build (see package.json "build" script).
// Only seeds the database from data/legacy-data.json the very first time —
// once any Project rows exist, this is a no-op so redeploys don't duplicate data.
import { prisma } from "../app/lib/prisma";
import { seedAll } from "./seed";

async function main() {
  const count = await prisma.project.count();
  if (count > 0) {
    console.log(`Database already has ${count} projects — skipping seed.`);
    return;
  }
  console.log("Database is empty — running initial seed...");
  await seedAll();
}

main()
  .catch((e) => {
    console.error("seed-if-empty failed:", e);
    // Don't fail the whole build/deploy if seeding has a problem —
    // the site can still serve (empty) and be seeded manually later.
  })
  .finally(() => prisma.$disconnect());
