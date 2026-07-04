import "dotenv/config";
import { query } from "../lib/db";

/**
 * Lists current niches, or adds one:
 *   tsx scripts/seed-niches.ts --add "Name" "Description" "Prompt style guidance"
 */
async function main() {
  if (process.argv[2] === "--add") {
    const [, , , name, description, promptStyle] = process.argv;
    if (!name) throw new Error('Usage: --add "Name" "Description" "Prompt style"');
    await query(
      `insert into niches (name, description, prompt_style) values ($1, $2, $3)
       on conflict (name) do update set description = excluded.description, prompt_style = excluded.prompt_style`,
      [name, description ?? "", promptStyle ?? ""]
    );
    console.log(`Upserted niche "${name}".`);
    return;
  }

  const niches = await query(`select id, name, active, last_used_at from niches order by id`);
  console.table(niches);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
