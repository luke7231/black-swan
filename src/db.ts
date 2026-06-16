import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const connectionString = process.env.DATABASE_URL || "postgresql://postgres:postgres@localhost:5432/black_swan";
const adapter = new PrismaPg({ connectionString });

export const prisma = new PrismaClient({ adapter });
