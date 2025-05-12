const acorn = require("acorn");
const walk = require("acorn-walk");
const fs = require("fs");
const nunjucks = require("nunjucks");
const path = require("path");

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

/**
 * Calculates appropriate viewBox dimensions from an SVG path string
 * @param {string} pathData - The SVG path data string
 * @return {Object} Object containing width and height for the viewBox
 */
//TODO: AI generated, kinda mediocre.
function calculateViewBoxFromPath(pathData) {
  // Extract all numeric values from the path
  const numberMatches = pathData.match(/-?\d*\.?\d+/g);
  if (!numberMatches) {
    return { width: 24, height: 24 }; // Default fallback size
  }

  const numbers = numberMatches.map(Number);

  // Initialize min/max values for x and y coordinates
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;

  // Step through the numbers assuming they're coordinate pairs
  for (let i = 0; i < numbers.length; i += 2) {
    if (i + 1 < numbers.length) {
      const x = numbers[i];
      const y = numbers[i + 1];

      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
  }

  // Calculate dimensions with small padding
  const width = Math.ceil(maxX - minX) || 24;
  const height = Math.ceil(maxY - minY) || 24;

  // Apply some heuristics for common icon sizes
  if (width <= 24 && height <= 24) {
    // If dimensions are close to common icon sizes, round to that size
    if (width > 16 || height > 16) {
      return { width: 24, height: 24 };
    } else {
      return { width: 16, height: 16 };
    }
  }

  // Add a small buffer for better display
  return {
    width: Math.ceil(width * 1.1),
    height: Math.ceil(height * 1.1),
  };
}

//TODO: Might still be some oddities with stuff that starts with "M365"
function handlePathsInJS(str) {
  const isSvg = /^M\d+(\.\d+)?([ ,]\d+(\.\d+)?)+/i.test(str);

  if (isSvg) {
    const { width, height } = calculateViewBoxFromPath(str);

    const viewBoxWidth = width;
    const viewBoxHeight = height;

    const svgContent =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' +
      viewBoxHeight +
      " " +
      viewBoxWidth +
      '"><path d="' +
      str +
      '"></path></svg>';

    return {
      type: "svg_path",
      content: svgContent,
    };
  }
  return null;
}

function handleBase64Images(str) {
  // Check for direct base64 data - supporting optional charset parameter
  let isBase64 =
    /^data:image\/(png|jpeg|jpg|gif|svg\+xml)(?:;charset=[^;]+)?;base64,/.test(
      str
    );

  // Check for CSS url() pattern - supporting optional charset parameter
  const urlMatch = str.match(
    /url\(['"]?(data:image\/(png|jpeg|jpg|gif|svg\+xml)(?:;charset=[^;]+)?;base64,[^'"]+)['"]?\)/i
  );
  if (urlMatch) {
    isBase64 = true;
    str = urlMatch[1]; // Extract the data URL from inside url()
  }

  if (isBase64) {
    // Modified regex to capture format with optional charset parameter
    const matches = str.match(
      /data:image\/(png|jpeg|jpg|gif|svg\+xml)(?:;charset=[^;]+)?;base64,(.+)$/
    );
    if (matches) {
      return {
        type: "base64_image",
        content: str,
      };
    }
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

function analyzeFile(filePath) {
  const fileName = path.basename(filePath);
  const fileContent = fs.readFileSync(filePath, "utf8");

  //TODO: Code Comments
  //TODO: Sourcemaps
  count_base64_images = 0;
  count_paths_in_js = 0;
  count_inline_svgs = 0;

  const ast = acorn.parse(fileContent, {
    sourceType: "module",
    ecmaVersion: 2024,
  });

  literalsList = [];
  imagesList = [];
  otherLiteralsLength = 0;

  walk.simple(ast, {
    Literal(node) {
      if (node.value != null && node.value !== "") {
        if (typeof node.value === "string") {
          const trimmedStr = node.value.trim();

          const svgPathResult = handlePathsInJS(trimmedStr, count_paths_in_js);
          if (svgPathResult) {
            imagesList.push(svgPathResult);
            count_paths_in_js++;
          }

          const base64Result = handleBase64Images(
            trimmedStr,
            count_base64_images
          );
          if (base64Result) {
            imagesList.push(base64Result);
            count_base64_images++;
          }

          const inlineSvgResult = handleInlineSVGs(
            trimmedStr,
            count_inline_svgs
          );
          if (inlineSvgResult) {
            imagesList.push(inlineSvgResult);
            count_inline_svgs++;
          }

          if (!svgPathResult && !base64Result && !inlineSvgResult) {
            literalsList.push(trimmedStr);
            otherLiteralsLength += trimmedStr.length;
          }
        }
      }
    },
  });

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

function parseHarFile(harFilePath, responsesFolder) {
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
    first_page_id = harData.log.pages[0].id;

    const entries = harData.log.entries;
    const outputData = [];

    entries.forEach((entry) => {
      const request = entry.request;
      const response = entry.response;

      if (request.method !== "GET" || entry.pageref !== first_page_id) {
        return;
      }

      req = {
        id: entry._id,
        url: request.url,
        mimeType: response.content.mimeType,
        size: response.content.size,
        cpuTimes: entry._cpuTimes,
        hasResponse: !!response.content.text,
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
        };

        if (mimeType && mimeTypeMap[mimeType]) {
          extension = mimeTypeMap[mimeType];
        } else {
          console.log(`Unknown MIME type: ${mimeType}`);
        }

        req.extension = extension;
        outputData.push(req);

        const responseFileName = `${entry._id}.${extension}`;
        const responseFilePath = path.join(responsesFolder, responseFileName);
        fs.writeFileSync(responseFilePath, response.content.text, "utf8");
      }
    });

    return outputData;
  } catch (error) {
    if (error.code === "ENOENT") {
      console.error(`File not found: ${harFilePath}`);
    } else {
      console.error(`Error parsing HAR file: ${error.message}`);
    }
  }
}

async function generatePages(requestsData, outputFolder) {
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

  requestsData.forEach(async (request) => {
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
  });
}

nunjucks.configure(path.join(__dirname, "templates"), {
  autoescape: true,
});

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

const responsesFolder = path.join(outputFolder, "responses");

files = parseHarFile(harFile, responsesFolder);

files.forEach((file) => {
  //TODO: Handle other filetypes
  if (file.hasResponse && file.extension === "js") {
    console.log(`Analyzing file: ${file.id}`);
    file.jsAnalysis = analyzeFile(
      path.join(responsesFolder, file.id +"."+ file.extension)
    );
  }
});

// Write requests.json
const outputFilePath = path.join(outputFolder, "requests.json");
fs.writeFileSync(outputFilePath, JSON.stringify(files, null, 2), "utf8");
console.log(`Successfully wrote ${files.length} requests to ${outputFilePath}`);

generatePages(files, outputFolder);
