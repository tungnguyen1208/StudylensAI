import { copyFileSync } from "node:fs";
import { resolve } from "node:path";

copyFileSync(resolve("manifest.json"), resolve("dist", "manifest.json"));

