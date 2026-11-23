// Build a custom template from your own container image, then create a
// sandbox from it.
//
// Do this when every sandbox needs the same slow setup (system packages,
// language runtimes, a cloned repository). The image is built once, and each
// sandbox starts with it already in place.
//
//   export TEMPLATE_IMAGE=registry.digitalocean.com/<your-registry>/<your-image>:v1
//   npx tsx custom-template.ts

import { Sandbox, Template } from "@digitalocean/dots/sandbox";
import { exec } from "./common.js";

const image = process.env.TEMPLATE_IMAGE;
if (!image) {
    console.error("set TEMPLATE_IMAGE to an OCI image reference");
    process.exit(2);
}

const name = `example-${Date.now().toString(36)}`;
const template = await Template.create({ name, sourceOciRef: image });
console.log(`template ${template.templateId} (${template.name}) is building`);

try {
    await template.waitUntilReady(); // throws with the build error if the build fails
    console.log("template is ready");

    await using sandbox = await Sandbox.create({ template: template.name });
    const result = await exec(sandbox, "cat /etc/os-release | head -2");
    console.log(result.stdout.trim());
} catch (err) {
    const builds = await template.builds().nextItems();
    for (const build of builds) console.error(`build ${build.buildId}: ${build.status} ${build.error ?? ""}`);
    throw err;
} finally {
    console.log("template deleted:", await template.delete());
}
