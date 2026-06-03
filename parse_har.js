const acorn = require("acorn");
const walk = require("acorn-walk");
const fs = require("fs");
const nunjucks = require("nunjucks");
const path = require("path");
const prettier = require("prettier");

/*
 *
 *
 * Notes -
 * Chunks of this (especially regexes) were vibe-coded.
 * Right now it only analyze the first page of the HAR file.
 * Right now it only analyzes the JS files, not HTML or CSS.
 *
 *
 */

function handlePathsInJS(str) {
  // More comprehensive SVG path detection - looks for common SVG path commands
  const isSvg = /^M\s*[\d.-]+\s*[\d.-]+\s*[aAcClLmMhHvVsSqQtTzZ0-9\s,.-]+$/i.test(str);

  if (str.toLowerCase().startsWith("m365")) {
    return null;
  }
  if (isSvg) {
    try {
      // Sanity check: a real path has numeric coordinates.
      const numbers = str.match(/[+-]?\d+(\.\d+)?/g);
      if (!numbers || numbers.length === 0) {
        return null;
      }

      // Emit a tight, self-scaling SVG. The viewBox here is only a placeholder:
      // a small client-side script computes each path's real bounding box via
      // getBBox() and rewrites the viewBox so every icon is framed consistently
      // regardless of its original coordinate range. preserveAspectRatio keeps
      // the glyph centered and proportional within its box.
      const svgContent =
        '<svg class="svg-autofit" xmlns="http://www.w3.org/2000/svg" ' +
        'viewBox="0 0 24 24" ' +
        'preserveAspectRatio="xMidYMid meet">' +
        '<path d="' + str + '" fill="currentColor"></path>' +
        '</svg>';

      return {
        type: "svg_path",
        content: svgContent,
      };
    } catch (e) {
      console.log("Error processing SVG path:", e);
      return null;
    }
  }
  return null;
}

// Matches a base64 data URI of any media type, optionally wrapped in CSS url(...).
// Captures: 1=full data URI, 2=mime type (e.g. "audio/mpeg", "image/avif").
const DATA_URI_RE =
  /(data:([a-z0-9.+-]+\/[a-z0-9.+-]+)(?:;[a-z0-9.+-]+=[^;,'"`)\s]+)*;base64,[A-Za-z0-9+/=]+)/i;

// Maps a media type to how the gallery should render it.
function assetTypeForMime(mime) {
  const m = mime.toLowerCase();
  if (m.startsWith("image/")) return "base64_image";
  if (m.startsWith("audio/")) return "base64_audio";
  if (m.startsWith("video/")) return "base64_video";
  return "base64_data"; // application/json, fonts, octet-stream, etc.
}

// Detects any base64-encoded data URI (images, audio, video, JSON, fonts, ...).
// Previously this only recognized a fixed list of image formats; it now surfaces
// every embedded base64 resource so things like data:audio/mpeg clips show up.
function handleDataUri(str) {
  // Prefer a CSS url(...) wrapper if present, otherwise match a bare data URI.
  const urlMatch = str.match(
    /url\(\s*['"]?\s*(data:[a-z0-9.+-]+\/[a-z0-9.+-]+(?:;[a-z0-9.+-]+=[^;,'"`)\s]+)*;base64,[A-Za-z0-9+/=]+)\s*['"]?\s*\)/i
  );
  const dataUri = urlMatch ? urlMatch[1] : null;

  let match;
  if (dataUri) {
    match = dataUri.match(DATA_URI_RE);
  } else {
    // Only treat as an asset when the whole string is the data URI, to avoid
    // false positives from prose that merely mentions a data URI.
    match = str.match(
      new RegExp("^" + DATA_URI_RE.source + "$", "i")
    );
  }

  if (match) {
    const mediaType = match[2].toLowerCase();
    return {
      type: assetTypeForMime(mediaType),
      content: match[1],
      mediaType,
    };
  }
  return null;
}

function handleInlineSVGs(str) {
  // Check for inline SVGs
  const svgMatch = str.match(/<svg[^>]*>([\s\S]*?)<\/svg>/i);
  if (svgMatch) {
    const svgContent = svgMatch[0];

    return {
      type: "inline_svg",
      content: svgContent,
    };
  }
  return null;
}

function handleLibraries(str){
  let libs = {};

  if (str.startsWith("R0lGOD")) {
    libs.base64gif = true;
  }

  if (str.startsWith("iVBOR")) {
    libs.base64png = true;
  }

  if (str.startsWith("/9j/")) {
    libs.base64jpg = true;
  }

  if (str.startsWith("eyJ")) {
    libs.json = true;
  }

  if (str.startsWith("PD94")) {
    libs.base64xml = true;
  }

  if (str.startsWith("MII")) {
    libs.base64cert = true;
  }

  if (str.match(/react.production.min.js/)) {
    libs.react = true;
  }

  if (str.match(/__REACT_DEVTOOLS_GLOBAL_HOOK__/)){
    libs.react = true
  }

  if(str.match(/lodash.*\.js/)){
    libs.lodash = true;
  }

  if(str.match(/https:\/\/reactjs\.org\/docs\//)){
    libs.react = true;
  }

  if (str.toLowerCase().includes("lottie")) {
    libs.lottie = true;
  }

  if (str.toLowerCase().includes("purify")) {
    libs.domPurify = true;
  }

  if (str.match(/\.Motion\b/)) {
    libs.motion = true;
  }

  if (str.match(/mappings:/)) {
    libs.sourcemaps = true;
  }

  return libs;
}

// Returns the decoded byte length of a HAR response body, honoring base64
// encoding so binary/base64 entries aren't measured as their base64 text.
function decodedBodyBytes(content) {
  if (!content || !content.text) {
    return 0;
  }
  if (content.encoding === "base64") {
    try {
      return Buffer.from(content.text, "base64").length;
    } catch (e) {
      return Buffer.byteLength(content.text, "utf8");
    }
  }
  return Buffer.byteLength(content.text, "utf8");
}

// Maps a request to a coarse composition category for the page-level treemap.
function categoryForRequest(extension, mimeType) {
  const mt = (mimeType || "").toLowerCase();
  switch (extension) {
    case "js":
      return "JavaScript";
    case "css":
      return "CSS";
    case "json":
      return "JSON";
    case "html":
      return "HTML";
    case "svg":
      return "SVG";
    case "png":
    case "jpg":
    case "gif":
      return "Images";
    case "xml":
      return "XML";
    case "txt":
      return "Text";
  }
  if (mt.startsWith("image/")) return "Images";
  if (mt.startsWith("font/") || mt.includes("font")) return "Fonts";
  return "Other";
}

// Byte-accurate composition of a JS bundle. Parses the ORIGINAL (pre-Prettier)
// source and attributes each string literal's *source span* bytes to either
// embedded-image or other-string buckets using the same detectors as the
// gallery analysis. Because spans come from the original text, the buckets are
// guaranteed not to exceed the file's decoded byte size.
function computeBundleBytes(source) {
  let imageBytes = 0;
  let stringBytes = 0;
  try {
    const ast = acorn.parse(source, {
      sourceType: "module",
      ecmaVersion: 2025,
      strict: false,
    });

    walk.simple(ast, {
      Literal(node) {
        if (typeof node.value !== "string" || node.value === "") {
          return;
        }
        const spanBytes = Buffer.byteLength(
          source.slice(node.start, node.end),
          "utf8"
        );
        const trimmed = node.value.trim();
        const isImage =
          !!handlePathsInJS(trimmed) ||
          !!handleDataUri(trimmed) ||
          !!handleInlineSVGs(trimmed);
        if (isImage) {
          imageBytes += spanBytes;
        } else {
          stringBytes += spanBytes;
        }
      },
      TemplateLiteral(node) {
        // Mirror the analyzeFile walk: attribute static (non-interpolated)
        // template literal spans too. Single-quasi templates contain no nested
        // Literal nodes, so their spans never overlap other counted nodes.
        if (node.expressions.length !== 0 || node.quasis.length !== 1) {
          return;
        }
        const cooked = node.quasis[0].value.cooked;
        if (typeof cooked !== "string" || cooked === "") {
          return;
        }
        const spanBytes = Buffer.byteLength(
          source.slice(node.start, node.end),
          "utf8"
        );
        const trimmed = cooked.trim();
        const isImage =
          !!handlePathsInJS(trimmed) ||
          !!handleDataUri(trimmed) ||
          !!handleInlineSVGs(trimmed);
        if (isImage) {
          imageBytes += spanBytes;
        } else {
          stringBytes += spanBytes;
        }
      },
    });
  } catch (error) {
    return null;
  }
  return { imageBytes, stringBytes };
}

function analyzeFile(filePath) {
  const fileName = path.basename(filePath);
  const fileContent = fs.readFileSync(filePath, "utf8");
  //console.log(`Analyzing file: ${fileName}`);

  //TODO: Code Comments
  //TODO: Sourcemaps
  let count_base64_images = 0;
  let count_paths_in_js = 0;
  let count_inline_svgs = 0;
  const literalsList = [];
  const imagesList = [];
  let otherLiteralsLength = 0;

  try {
    const ast = acorn.parse(fileContent, {
      sourceType: "module",
      ecmaVersion: 2025,
      strict: false,
    });

    // Shared per-string analysis so both plain string literals and (single-quasi)
    // template literals are scanned. Minified bundlers like rolldown/esbuild emit
    // strings as template literals (backticks), so icon path data, base64 images,
    // and inline SVGs frequently live in TemplateLiteral nodes, not Literal nodes.
    const processString = (rawStr) => {
      const trimmedStr = rawStr.trim();
      if (trimmedStr === "") return;

      const svgPathResult = handlePathsInJS(trimmedStr);
      if (svgPathResult) {
        imagesList.push(svgPathResult);
        count_paths_in_js++;
      }

      const base64Result = handleDataUri(trimmedStr);
      if (base64Result) {
        imagesList.push(base64Result);
        count_base64_images++;
      }

      const inlineSvgResult = handleInlineSVGs(trimmedStr);
      if (inlineSvgResult) {
        imagesList.push(inlineSvgResult);
        count_inline_svgs++;
      }

      if (!svgPathResult && !base64Result && !inlineSvgResult) {
        literalsList.push(trimmedStr);
        otherLiteralsLength += trimmedStr.length;
      }
    };

    walk.simple(ast, {
      Literal(node) {
        if (node.value != null && node.value !== "") {
          if (typeof node.value === "string") {
            processString(node.value);
          }
        }
      },
      TemplateLiteral(node) {
        // Only static templates with no interpolation. These contain no nested
        // Literal nodes, so there's no risk of double-scanning.
        if (node.expressions.length === 0 && node.quasis.length === 1) {
          const cooked = node.quasis[0].value.cooked;
          if (typeof cooked === "string" && cooked !== "") {
            processString(cooked);
          }
        }
      },
    });
  } catch (error) {
    console.error(`Error analyzing file ${fileName}: ${error.message}`);
  }

  literalsList.sort((a, b) => {
    const strA = String(a);
    const strB = String(b);
    return strB.length - strA.length;
  });

  return {
    fileName,
    imagesCount: imagesList.length,
    svgPaths: count_paths_in_js,
    base64Images: count_base64_images,
    inlineSvgs: count_inline_svgs,
    images: imagesList,
    otherLiteralsLength: otherLiteralsLength,
    otherLiterals: literalsList,
  };
}

async function parseHarFile(harFilePath, responsesFolder) {
  try {
    if (fs.existsSync(responsesFolder)) {
      fs.rmSync(responsesFolder, { recursive: true, force: true });
    }
    fs.mkdirSync(responsesFolder, { recursive: true });

    const harContent = fs.readFileSync(harFilePath, "utf8");
    const harData = JSON.parse(harContent);

    if (!harData.log || !harData.log.entries) {
      console.error("Invalid HAR file format: missing log.entries property");
      return;
    }

    /*
     *
     *
     * Important: Right now we're only getting the first page.
     *
     *
     */
    const pages = harData.log.pages;
    const first_page_id =
      pages && pages.length > 0 ? pages[0].id : null;

    const entries = harData.log.entries;
    const outputData = [];

    for (const entry of entries) {
      const request = entry.request;
      const response = entry.response;

      // When the HAR has page metadata, restrict to the first page. Otherwise
      // (no pages defined) fall back to processing every GET entry.
      const matchesFirstPage =
        first_page_id == null || entry.pageref === first_page_id;
      if (request.method !== "GET" || !matchesFirstPage) {
        continue;
      }

      const req = {
        id: entry._id,
        url: request.url,
        mimeType: response.content.mimeType,
        size: response.content.size,
        cpuTimes: entry._cpuTimes,
        hasResponse: !!response.content.text,
        time: entry.time
      };

      // Save the response content to a file
      if (response.content && response.content.text) {
        let extension = "unknown"; // Default extension
        const mimeType = response.content.mimeType;

        // Map common MIME types to file extensions
        const mimeTypeMap = {
          "application/json": "json",
          "application/javascript": "js",
          "text/javascript": "js",
          "application/x-javascript": "js",
          "image/svg+xml": "svg",
          "text/html": "html",
          "text/css": "css",
          "text/plain": "txt",
          "image/png": "png",
          "image/jpeg": "jpg",
          "image/gif": "gif",
          "application/xml": "xml",
          "text/xml": "xml",
          "application/manifest+json": "json",
          "application/graphql-response+json": "json"
        };

        if (mimeType && mimeTypeMap[mimeType]) {
          extension = mimeTypeMap[mimeType];
        } else {
          console.log(`Unknown MIME type: ${mimeType}`);
        }

        req.extension = extension;
        req.decodedSize = decodedBodyBytes(response.content);
        outputData.push(req);

        req.libraryInfo = handleLibraries(response.content.text);

        // Byte-accurate composition for JS bundles, computed on the original
        // (unformatted) source so segments sum to the decoded file size.
        if (extension === "js") {
          req.byteBreakdown = computeBundleBytes(response.content.text);
        }

        const responseFileName = `${entry._id}.${extension}`;
        const responseFilePath = path.join(responsesFolder, responseFileName);
        let formattedContent = response.content.text;

        // Try to format content with Prettier if the file type is supported.
        try {
          // Only format files Prettier can handle
          if (
            ["js", "json", "css", "html", "svg", "xml"].includes(extension)
          ) {
            formattedContent = await prettier.format(response.content.text, {
              filepath: responseFilePath, // Let Prettier infer parser from file path
            });
          }
        } catch (error) {
          console.log(
            `Could not format ${responseFileName}: ${error.message}`
          );
        }

        fs.writeFileSync(responseFilePath, formattedContent, "utf8");
      }else{
        console.log(
          `No response content for ${req.mimeType} - ${req.url}`
        );
      }
    }

    return outputData;
  } catch (error) {
    if (error.code === "ENOENT") {
      console.error(`File not found: ${harFilePath}`);
    } else {
      console.error(`Error parsing HAR file: ${error.message}`);
    }
  }
}

// Aggregates per-request decoded bytes into a page-level composition summary
// and a sorted per-bundle breakdown for the composition view.
function buildComposition(files) {
  const palette = {
    JavaScript: "#f0db4f",
    CSS: "#2965f1",
    JSON: "#8e44ad",
    HTML: "#e34c26",
    SVG: "#ff9800",
    Images: "#16a085",
    Fonts: "#c0392b",
    XML: "#7f8c8d",
    Text: "#95a5a6",
    Other: "#bdc3c7",
  };

  const categories = {};
  const items = [];
  let totalBytes = 0;

  for (const f of files) {
    const bytes = f.decodedSize || 0;
    if (bytes <= 0) {
      continue;
    }
    const category = categoryForRequest(f.extension, f.mimeType);
    totalBytes += bytes;
    if (!categories[category]) {
      categories[category] = { name: category, bytes: 0, count: 0 };
    }
    categories[category].bytes += bytes;
    categories[category].count += 1;
    items.push({
      id: f.id,
      url: f.url,
      category,
      bytes,
      color: palette[category] || palette.Other,
    });
  }

  const categoryList = Object.values(categories)
    .map((c) => ({
      ...c,
      color: palette[c.name] || palette.Other,
      pct: totalBytes ? (c.bytes / totalBytes) * 100 : 0,
    }))
    .sort((a, b) => b.bytes - a.bytes);

  items.sort((a, b) => b.bytes - a.bytes);

  // Per-bundle (JS) breakdown: code vs strings vs embedded images.
  const bundles = [];
  for (const f of files) {
    if (f.extension !== "js") {
      continue;
    }
    const total = f.decodedSize || 0;
    const bb = f.byteBreakdown;
    if (!bb) {
      bundles.push({
        id: f.id,
        url: f.url,
        total,
        analyzed: false,
        code: total,
        strings: 0,
        images: 0,
        codePct: 100,
        stringsPct: 0,
        imagesPct: 0,
        mismatch: 0,
      });
      continue;
    }
    const strings = bb.stringBytes;
    const images = bb.imageBytes;
    const accounted = strings + images;
    const mismatch = accounted > total ? accounted - total : 0;
    const code = Math.max(0, total - accounted);
    const denom = code + strings + images || 1;
    bundles.push({
      id: f.id,
      url: f.url,
      total,
      analyzed: true,
      code,
      strings,
      images,
      codePct: (code / denom) * 100,
      stringsPct: (strings / denom) * 100,
      imagesPct: (images / denom) * 100,
      mismatch,
    });
  }
  bundles.sort((a, b) => b.total - a.total);

  return {
    totalBytes,
    categories: categoryList,
    items,
    bundles,
    palette,
  };
}

async function generatePages(requestsData, outputFolder, composition) {
  // Create the output folder if it doesn't exist
  if (!fs.existsSync(path.join(outputFolder, "ssg", "pages"))) {
    fs.mkdirSync(path.join(outputFolder, "ssg", "pages"), { recursive: true });
  }

  const outputPath = path.join(outputFolder, "ssg", "index.html");
  console.log(`Generating pages for ${requestsData.length} requests...`);

  // Render the template
  const html = nunjucks.render("index.njk", {
    requests: requestsData,
  });

  await fs.promises.writeFile(outputPath, html);

  // Render the gallery
  const outputPath3 = path.join(outputFolder, "ssg", "gallery.html");
  const html3 = nunjucks.render("gallery.njk", {
    requests: requestsData,
  });

  await fs.promises.writeFile(outputPath3, html3);

  // Render the composition view
  const compositionPath = path.join(outputFolder, "ssg", "composition.html");
  const compositionHtml = nunjucks.render("composition.njk", {
    composition: composition,
  });
  await fs.promises.writeFile(compositionPath, compositionHtml);

  await Promise.all(
    requestsData.map(async (request) => {
      const html2 = nunjucks.render("page.njk", {
        request: request,
      });
      const outputPath2 = path.join(
        outputFolder,
        "ssg",
        "pages",
        request.id + ".html"
      );
      await fs.promises.writeFile(outputPath2, html2);
    })
  );
}

nunjucks.configure(path.join(__dirname, "templates"), {
  autoescape: true,
});

(async () => {
  const harFile = process.argv[2];
  if (!harFile) {
    console.error("Please provide a HAR file path as an argument");
    console.error("Usage: node parse_har.js path/to/file.har");
    process.exit(1);
  }

  const inputFilename = path.basename(harFile, path.extname(harFile));
  const outputFolder = path.join("output", inputFilename);

  if (fs.existsSync(outputFolder)) {
    fs.rmSync(outputFolder, { recursive: true, force: true });
  }
  fs.mkdirSync(outputFolder, { recursive: true });

  const responsesFolder = path.join(outputFolder, "ssg", "responses");

  const files = await parseHarFile(harFile, responsesFolder);

  if (!files) {
    console.error("Failed to parse HAR file; no output generated.");
    process.exit(1);
  }

  files.forEach((file) => {
    //TODO: Handle other filetypes
    if (file.hasResponse && file.extension === "js") {
      //console.log(`Analyzing file: ${file.id}`);
      file.jsAnalysis = analyzeFile(
        path.join(responsesFolder, file.id + "." + file.extension)
      );
    }
  });

  // Write requests.json
  const outputFilePath = path.join(outputFolder, "requests.json");
  fs.writeFileSync(outputFilePath, JSON.stringify(files, null, 2), "utf8");
  console.log(
    `Successfully wrote ${files.length} requests to ${outputFilePath}`
  );

  const composition = buildComposition(files);

  await generatePages(files, outputFolder, composition);
})();
