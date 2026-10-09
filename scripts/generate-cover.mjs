import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import sharp from "sharp";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const photo = await readFile(path.join(root, "public/dataset/images/da-058d10c61b87.jpg"));
const image = `data:image/jpeg;base64,${photo.toString("base64")}`;
const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="1920" height="1080" viewBox="0 0 1920 1080">
<defs>
<linearGradient id="paper" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#faf8f1"/><stop offset="1" stop-color="#eeeede"/></linearGradient>
<pattern id="grid" width="38" height="38" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r="1.2" fill="#586449" opacity=".13"/></pattern>
<filter id="shadow" x="-20%" y="-20%" width="150%" height="150%"><feDropShadow dx="0" dy="24" stdDeviation="20" flood-color="#263820" flood-opacity=".12"/></filter>
<clipPath id="photo"><rect x="1038" y="189" width="702" height="636" rx="12"/></clipPath>
</defs>
<rect width="1920" height="1080" fill="url(#paper)"/>
<rect x="920" y="0" width="1000" height="1080" fill="url(#grid)"/>
<path d="M929 0V1080" stroke="#d4dac8" stroke-width="2"/>
<g transform="translate(103 91)"><rect width="50" height="50" rx="13" fill="#242b28"/><g fill="none" stroke="#f5bd73" stroke-width="2.3" stroke-linecap="round"><path d="M18 10h-4a4 4 0 0 0-4 4v4m22-8h4a4 4 0 0 1 4 4v4M10 32v4a4 4 0 0 0 4 4h4m22-8v4a4 4 0 0 1-4 4h-4"/><circle cx="24" cy="24" r="7"/><path d="m29 29 6 6"/></g><text x="67" y="36" font-family="Arial,sans-serif" font-size="38" font-weight="700" fill="#242b28" letter-spacing="-1">webytex</text><rect x="268" y="5" width="175" height="41" rx="20" fill="#f5bd73"/><text x="356" y="33" text-anchor="middle" font-family="Arial,sans-serif" font-size="24" font-weight="600" fill="#403019">BUSINESS</text></g>
<text x="103" y="267" font-family="Arial,sans-serif" font-size="82" font-weight="600" letter-spacing="-4" fill="#242b28">Defect Atlas</text>
<text x="102" y="393" font-family="Georgia,serif" font-size="87" fill="#30382d" letter-spacing="-3">See the defect.</text>
<text x="102" y="493" font-family="Georgia,serif" font-size="87" font-style="italic" fill="#84734d" letter-spacing="-3">Know the limits.</text>
<text x="105" y="573" font-family="Arial,sans-serif" font-size="29" fill="#5f695c">A visual inspection lab that knows</text>
<text x="105" y="615" font-family="Arial,sans-serif" font-size="29" fill="#5f695c">when to ask for a human.</text>
<path d="M106 674H810" stroke="#cbd2bf" stroke-width="2"/>
<g font-family="Arial,sans-serif" fill="#414d39"><text x="105" y="727" font-size="24" letter-spacing="2">REAL PHOTOS</text><path d="M312 719h49m-9-8 9 8-9 8" fill="none" stroke="#8d9a80" stroke-width="2"/><text x="386" y="727" font-size="24" letter-spacing="2">AI ESTIMATES</text><path d="M598 719h49m-9-8 9 8-9 8" fill="none" stroke="#8d9a80" stroke-width="2"/><text x="674" y="727" font-size="24" letter-spacing="2">REVIEW</text></g>
<g transform="rotate(2 1390 500)" filter="url(#shadow)"><rect x="1018" y="129" width="742" height="719" rx="24" fill="#fffdf6" stroke="#d4dbc6" stroke-width="2"/><text x="1042" y="168" font-family="Arial,sans-serif" font-size="23" fill="#607052">A REAL VISA PHOTOGRAPH</text><image x="1038" y="189" width="702" height="636" preserveAspectRatio="xMidYMid slice" xlink:href="${image}" clip-path="url(#photo)"/></g>
<g transform="translate(991 797)" filter="url(#shadow)"><rect width="776" height="127" rx="16" fill="#fffdf7" stroke="#cdd6bf" stroke-width="2"/><g transform="translate(26 27)"><rect width="221" height="73" rx="9" fill="#e5efe3"/><circle cx="35" cy="36" r="13" fill="none" stroke="#316442" stroke-width="2.5"/><path d="m29 36 4 4 8-9" fill="none" stroke="#316442" stroke-width="2.5"/><text x="64" y="45" font-family="Arial,sans-serif" font-size="28" fill="#316442">Clear</text><rect x="238" width="211" height="73" rx="9" fill="#f7e5dc"/><path d="m270 23 16 27h-32z" fill="none" stroke="#944c37" stroke-width="2.5"/><path d="M270 33v7m0 4v2" stroke="#944c37" stroke-width="2.5"/><text x="298" y="45" font-family="Arial,sans-serif" font-size="28" fill="#944c37">Flag</text><rect x="466" width="258" height="73" rx="9" fill="#ede6f3"/><path d="M486 36q16-21 32 0-16 21-32 0z" fill="none" stroke="#725389" stroke-width="2.5"/><circle cx="502" cy="36" r="5" fill="#725389"/><text x="532" y="45" font-family="Arial,sans-serif" font-size="28" fill="#725389">Review</text></g></g>
<text x="105" y="880" font-family="Arial,sans-serif" font-size="27" font-weight="500" fill="#424d3b">Open-source. Built with OpenAI Decisions.</text>
<text x="105" y="922" font-family="Arial,sans-serif" font-size="24" fill="#66715c">Inspect · Calibrate · Compare</text>
<path d="M105 974H1815" stroke="#cbd3be" stroke-width="2"/>
<text x="105" y="1020" font-family="Arial,sans-serif" font-size="22" fill="#67715e">A Webytex experiment in evidence-led AI</text>
<text x="1815" y="1020" text-anchor="end" font-family="Arial,sans-serif" font-size="22" fill="#67715e">Photo: VisA / Amazon Science · CC BY 4.0 · Resized</text>
</svg>`;
await writeFile(path.join(root, "public/social-preview.svg"), svg);
await sharp(Buffer.from(svg)).png().toFile(path.join(root, "public/social-preview.png"));
process.stdout.write("Created original 1920 × 1080 Defect Atlas cover with attributed VisA photograph.\n");
