import "dotenv/config";
import { prisma } from "./db.js";
import { createApp } from "./app.js";
import { seedDatabase } from "../prisma/seed.js";

const PORT = Number(process.env.PORT) || 4000;
const app = createApp();

async function start() {
  if ((await prisma.plan.count()) === 0) {
    console.log("Database empty; seeding initial plans, features, tenants, and demo users...");
    await seedDatabase(prisma);
  }

  app.listen(PORT, () => {
    console.log(`API running on http://localhost:${PORT}`);
    console.log(`Swagger docs on http://localhost:${PORT}/api-docs`);
  });
}

if (!process.env.VERCEL) {
  start().catch((err) => {
    console.error("Failed to start server:", err);
    process.exit(1);
  });
}

export default app;
