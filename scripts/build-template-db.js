import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { seedDatabase } from "../prisma/seed.js";

const templatePath = path.resolve(process.cwd(), "prisma", "template.db");
if (fs.existsSync(templatePath)) {
  fs.unlinkSync(templatePath);
}

const dbUrl = `file:${templatePath}`;
const env = { ...process.env, DATABASE_URL: dbUrl };

execFileSync("npx", ["prisma", "db", "push", "--skip-generate"], {
  stdio: "inherit",
  shell: process.platform === "win32",
  env,
});

const prisma = new PrismaClient({ datasources: { db: { url: dbUrl } } });
try {
  await seedDatabase(prisma);
  console.log(`Seeded Vercel template DB at ${templatePath}`);
} finally {
  await prisma.$disconnect();
}
