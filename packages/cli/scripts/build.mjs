import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import {publishRelease} from './publish.mjs';
export async function buildDistribution(
  output = resolve(import.meta.dirname, "../../../apps/web/public/nh"),
) {
  const root = resolve(import.meta.dirname, ".."),
    { version } = await Bun.file(join(root, "package.json")).json(),
    catalog=await Bun.file(join(root,'release-lock.json')).json();
  if (!/^\d+\.\d+\.\d+$/.test(version))
    throw Error("A stable CLI version is required");
  const artifacts=[];
  // Compile both inputs before publishing any files. A failed installer bundle
  // must not leave a new version or change an existing release.
  for (const entry of [join(root,"bin/nh.mjs"),join(root,"install.mjs")]) {
    const built = await Bun.build({
      entrypoints: [entry],
      target: "bun",
      format: "esm",
      // Bun's readable module-path comments depend on the caller's cwd. Strip
      // whitespace/comments so API and web builds publish identical releases;
      // keep identifiers and syntax unchanged for the portable Bun module.
      minify: { whitespace: true, syntax: false, identifiers: false },
      sourcemap: "none",
    });
    if (!built.success)
      throw new AggregateError(built.logs, "CLI bundling failed");
    if (built.outputs.length !== 1)
      throw Error("Expected one portable CLI module");
    artifacts.push(await built.outputs[0].arrayBuffer());
  }
  return publishRelease(output,version,artifacts[0],artifacts[1],{catalog});
}
if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url))
  console.log(
    JSON.stringify(await buildDistribution(process.argv[2]), null, 2),
  );
