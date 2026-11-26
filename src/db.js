import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

if (process.env.VERCEL) {
  const tmpDb = "/tmp/prod.db";
  if (!fs.existsSync(tmpDb)) {
    const templateDb = path.resolve(process.cwd(), "prisma", "template.db");
    if (fs.existsSync(templateDb)) {
      fs.copyFileSync(templateDb, tmpDb);
    }
  }
  if (!process.env.DATABASE_URL || !process.env.DATABASE_URL.startsWith("postgres")) {
    process.env.DATABASE_URL = `file:${tmpDb}`;
  }
}

export const prisma = new PrismaClient();
