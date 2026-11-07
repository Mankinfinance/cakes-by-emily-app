// Writes supabase/seed.sql. Run with: npm run seed:sql
import { writeFileSync } from "node:fs";
import path from "node:path";
import { buildSeedSql } from "./seed-sql";

writeFileSync(path.join(process.cwd(), "supabase/seed.sql"), buildSeedSql());
console.log("Wrote supabase/seed.sql");
