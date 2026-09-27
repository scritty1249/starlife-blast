import { build } from "esbuild";
import { readdir, writeFile } from "fs/promises";
import { existsSync } from "fs";
import path from "path";
import { DEV_FLAG, resolveAbsolutePathsPluginFactory } from "./utils.js";

const libPath = path.normalize("./src/lib");
const outDir = path.normalize("./dist/lib");

async function recurseFiles(dir) {
    let results = [];
    const list = await readdir(dir, { withFileTypes: true });
    for (const file of list) {
        const res = path.join(dir, file.name);
        if (file.isDirectory()) {
            results = results.concat(await recurseFiles(res));
        } else if (file.isFile() && file.name.endsWith(".js")) {
            results.push(res);
        }
    }
    return results;
}

if (existsSync(libPath)) {
    const libFiles = await recurseFiles(libPath);
    if (libFiles.length === 0) {
        console.warn(`Warning: No modules found inside: ${libPath}`);
        process.exit(0);
    }
    console.log(`Building ${libFiles.length} files...\n`);
    const buildArgs = {
        bundle: true,
        minify: !DEV_FLAG, // shake off unused bits of imported game engine
        format: "esm",
        platform: "node", // target env
        packages: "external", // don't bundle in node/npm stuff
        plugins: [resolveAbsolutePathsPluginFactory()],
        define: { "process.env.DEV_FLAG": `${DEV_FLAG}` }
    };
    await Promise.all(
        libFiles.map(async (filePath) => {
            const relative = path.relative(libPath, filePath);
            const dest = path.join(outDir, relative);
            buildArgs.entryPoints = [filePath];
            buildArgs.outfile = dest;
            await build(buildArgs);
            console.log(`Bundled: ${filePath} > ${dest}`);
        }),
    );
    await writeFile(
        path.join(outDir, "package.json"),
        JSON.stringify({ type: "module" }),
    );
    console.log(`\nSuccessfully built to: ${outDir}`);
    process.exit(0);
} else {
    console.error(`Error: Missing lib source directory: ${libPath}`);
    process.exit(1);
}
