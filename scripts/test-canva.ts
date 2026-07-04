import "dotenv/config";
import { createMockup } from "../lib/canva";

const DEFAULT_TEST_IMAGE = "https://placehold.co/1500x2000.png?text=art";

async function main() {
  const imageUrl = process.argv[2] ?? DEFAULT_TEST_IMAGE;
  console.log(`This will create a real design in your connected Canva account from CANVA_MOCKUP_TEMPLATE_ID.`);
  console.log(`Autofilling mockup template with ${imageUrl} ...`);
  const result = await createMockup(imageUrl, `test-${Date.now()}`);
  console.log("Design ID:", result.designId);
  console.log("Mockup export URL:", result.mockupUrl);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
