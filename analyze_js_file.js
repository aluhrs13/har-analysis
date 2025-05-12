const acorn = require("acorn");
const walk = require("acorn-walk");
const { count } = require("console");
const fs = require("fs");
const path = require("path");


/**
 * Calculates appropriate viewBox dimensions from an SVG path string
 * @param {string} pathData - The SVG path data string
 * @return {Object} Object containing width and height for the viewBox
 */
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
    height: Math.ceil(height * 1.1)
  };
}




function handlePathsInJS(str, count, svgOutputDir) {
    const isSvg = /^M\d+(\.\d+)?([ ,]\d+(\.\d+)?)+/i.test(str);

    //Kinda hacky, but 🤷‍♂️
    if (str.startsWith("M365") || str.startsWith("m365")) {
      return 0;
    }

    if (isSvg) {
      const svgFileName = `svg_extracted_${count}.svg`;
      const svgFilePath = path.join(svgOutputDir, svgFileName);

      // Calculate viewbox from path coordinates
      const { width, height } = calculateViewBoxFromPath(str);

      const viewBoxWidth = width;
      const viewBoxHeight = height;

      const output =
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' +
        viewBoxHeight +
        " " +
        viewBoxWidth +
        '"><path d="' +
        str +
        '"></path></svg>';

      fs.writeFileSync(svgFilePath, output, "utf8");
      return 1;
    }else{
        return 0;
    }
}

function handleBase64Images(str, count, svgOutputDir) {
    // Check for direct base64 data - supporting optional charset parameter
    let isBase64 = /^data:image\/(png|jpeg|jpg|gif|svg\+xml)(?:;charset=[^;]+)?;base64,/.test(str);
    
    // Check for CSS url() pattern - supporting optional charset parameter
    const urlMatch = str.match(/url\(['"]?(data:image\/(png|jpeg|jpg|gif|svg\+xml)(?:;charset=[^;]+)?;base64,[^'"]+)['"]?\)/i);
    if (urlMatch) {
        isBase64 = true;
        str = urlMatch[1]; // Extract the data URL from inside url()
    }

    if (isBase64) {
      // Modified regex to capture format with optional charset parameter
      const matches = str.match(/data:image\/(png|jpeg|jpg|gif|svg\+xml)(?:;charset=[^;]+)?;base64,(.+)$/);
      if (matches) {
        const format = matches[1]; // Extract the image format (e.g., png, jpeg)
        const base64Data = matches[2]; // Extract the base64 data
        const binaryData = Buffer.from(base64Data, "base64"); // Convert base64 to binary

        // Handle format naming for SVG files
        const extension = format === "svg+xml" ? "svg" : format;
        
        // Create appropriate filename based on format
        const base64FileName = `base64_image_${count}.${extension}`;
        const base64FilePath = path.join(svgOutputDir, base64FileName);

        fs.writeFileSync(base64FilePath, binaryData); // Write binary data to file
        return 1;
      }
    }
    return 0;
}

function handleInlineSVGs(str, count, svgOutputDir) {
    // Check for inline SVGs
    const svgMatch = str.match(/<svg[^>]*>([\s\S]*?)<\/svg>/i);
    if (svgMatch) {
      const svgContent = svgMatch[0];
      const svgFileName = `inline_svg_${count}.svg`;
      const svgFilePath = path.join(svgOutputDir, svgFileName);

      fs.writeFileSync(svgFilePath, svgContent, "utf8");
      return 1;
    }
    return 0;
}



function analyzeFile(fileName, svgOutputDir) {
  const filePath = path.join(
    "q:",
    "har-analysis",
    "output",
    "extracted_js",
    fileName
  );

  const fileContent = fs.readFileSync(filePath, "utf8");

  const ast = acorn.parse(fileContent, {
    sourceType: "module",
    ecmaVersion: 2024,
  });

  list = [];


  walk.simple(ast, {
    Literal(node) {
      if (node.value != null && node.value !== "") {
        list.push(node.value);

        if (typeof node.value === "string") {
          const trimmedStr = node.value.trim();
          count_paths_in_js += handlePathsInJS(trimmedStr, count_paths_in_js, svgOutputDir);
          count_base64_images += handleBase64Images(
            trimmedStr,
            count_base64_images,
            svgOutputDir
          );
          count_inline_svgs += handleInlineSVGs(trimmedStr, count_inline_svgs, svgOutputDir);
        }
      }
    },
  });

  list.sort((a, b) => {
    const strA = String(a);
    const strB = String(b);
    return strB.length - strA.length;
  });

  // Create output filename based on the input file
  const outputFileName = `uncategorized_literals_${fileName.replace(
    /\.js$/,
    ""
  )}.txt`;
  const outputPath = path.join("q:", "har-analysis", "output", outputFileName);
  fs.writeFileSync(outputPath, list.join("\n"), "utf8");
  console.log(`Output saved to: ${outputPath}`);
  console.log("Total literals: ", list.length);
  console.log("SVGs in js: ", count_paths_in_js);
  console.log("Base64 images: ", count_base64_images);
  console.log("<svg> elements: ", count_inline_svgs);
}


//TODO: Code Comments
//TODO: Sourcemaps
output_base64_images = [];
count_base64_images = 0;
output_paths_in_js = [];
count_paths_in_js = 0;
output_inline_svgs = [];
count_inline_svgs = 0;



if (process.argv.length < 3) {
  const folder = path.join("q:", "har-analysis", "output", "extracted_js");

  const files = fs.readdirSync(folder);
  files.forEach((file) => {
    if (file.endsWith(".js")) {
      const svgOutputDir = path.join(
        "q:",
        "har-analysis",
        "output",
        "extracted_images",
        file.replace(/\.js$/, "")
      );

      if (fs.existsSync(svgOutputDir)) {
        fs.rmSync(svgOutputDir, { recursive: true, force: true });
      }
      fs.mkdirSync(svgOutputDir, { recursive: true });

      console.log(`Analyzing file: ${file}`);
      analyzeFile(file, svgOutputDir);
    }
  });
}else{
  const fileName = process.argv[2];

  const svgOutputDir = path.join(
    "q:",
    "har-analysis",
    "output",
    "extracted_images",
    fileName.replace(/\.js$/, "")
  );

  if (fs.existsSync(svgOutputDir)) {
    fs.rmSync(svgOutputDir, { recursive: true, force: true });
  }
  fs.mkdirSync(svgOutputDir, { recursive: true });

  console.log(`Analyzing file: ${fileName}`);

  analyzeFile(fileName, svgOutputDir);
}
