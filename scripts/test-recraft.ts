import "dotenv/config";
import { generateImage } from "../lib/recraft";

async function main() {
  const prompt =
    process.argv[2] ??
    "fine continuous-line art, single botanical stem, minimalist, neutral cream background, print-ready wall art";
  console.log(`Generating image for prompt: "${prompt}"`);
  const image = await generateImage(prompt);
  console.log("Recraft image URL:", image.url);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
