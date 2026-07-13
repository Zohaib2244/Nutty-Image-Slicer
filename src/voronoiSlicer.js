import { Delaunay } from 'd3-delaunay';

export function getImagePixelData(image) {
  const canvas = document.createElement('canvas');
  canvas.width = image.width;
  canvas.height = image.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(image, 0, 0);
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return imageData;
}

export function trimImageToOpaqueBounds(image, alphaThreshold = 8) {
  const canvas = document.createElement('canvas');
  canvas.width = image.width;
  canvas.height = image.height;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(image, 0, 0);
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

  let minX = canvas.width;
  let minY = canvas.height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < canvas.height; y++) {
    for (let x = 0; x < canvas.width; x++) {
      const idx = (y * canvas.width + x) * 4 + 3;
      if (imageData.data[idx] >= alphaThreshold) {
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
  }

  if (maxX < 0 || maxY < 0) {
    return { needsTrim: false };
  }

  const width = maxX - minX + 1;
  const height = maxY - minY + 1;
  const trimmedCanvas = document.createElement('canvas');
  trimmedCanvas.width = width;
  trimmedCanvas.height = height;
  trimmedCanvas.getContext('2d').drawImage(
    image,
    minX,
    minY,
    width,
    height,
    0,
    0,
    width,
    height
  );

  return {
    needsTrim: true,
    dataUrl: trimmedCanvas.toDataURL(),
    offset: { x: minX, y: minY },
  };
}

function trimCanvasToOpaqueBounds(sourceCanvas, alphaThreshold = 8) {
  const width = sourceCanvas.width;
  const height = sourceCanvas.height;
  const ctx = sourceCanvas.getContext('2d', { willReadFrequently: true });
  const imageData = ctx.getImageData(0, 0, width, height);

  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4 + 3;
      if (imageData.data[idx] >= alphaThreshold) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }

  if (maxX < 0 || maxY < 0) {
    return { needsTrim: false };
  }

  const trimmedW = maxX - minX + 1;
  const trimmedH = maxY - minY + 1;

  const trimmedCanvas = document.createElement('canvas');
  trimmedCanvas.width = trimmedW;
  trimmedCanvas.height = trimmedH;
  trimmedCanvas
    .getContext('2d')
    .drawImage(sourceCanvas, minX, minY, trimmedW, trimmedH, 0, 0, trimmedW, trimmedH);

  return {
    needsTrim: true,
    canvas: trimmedCanvas,
    offset: { x: minX, y: minY },
  };
}

function findOpaquePivotInCanvas(sourceCanvas, alphaThreshold = 8) {
  const width = sourceCanvas.width;
  const height = sourceCanvas.height;
  const ctx = sourceCanvas.getContext('2d', { willReadFrequently: true });
  const imageData = ctx.getImageData(0, 0, width, height);

  let sumX = 0;
  let sumY = 0;
  let count = 0;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4 + 3;
      if (imageData.data[idx] >= alphaThreshold) {
        sumX += x + 0.5;
        sumY += y + 0.5;
        count++;
      }
    }
  }

  if (count === 0) {
    return { hasOpaque: false, x: width / 2, y: height / 2 };
  }

  const cx = sumX / count;
  const cy = sumY / count;

  // Pick an *actual* opaque pixel closest to the centroid.
  let bestX = Math.floor(cx);
  let bestY = Math.floor(cy);
  let bestDist2 = Infinity;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4 + 3;
      if (imageData.data[idx] < alphaThreshold) continue;
      const dx = (x + 0.5) - cx;
      const dy = (y + 0.5) - cy;
      const d2 = dx * dx + dy * dy;
      if (d2 < bestDist2) {
        bestDist2 = d2;
        bestX = x;
        bestY = y;
      }
    }
  }

  return { hasOpaque: true, x: bestX + 0.5, y: bestY + 0.5 };
}

function recenterCanvasSoPointIsCenter(sourceCanvas, pointX, pointY) {
  const width = sourceCanvas.width;
  const height = sourceCanvas.height;

  const halfW = Math.max(1, Math.ceil(Math.max(pointX, width - pointX)));
  const halfH = Math.max(1, Math.ceil(Math.max(pointY, height - pointY)));
  const outW = Math.max(1, halfW * 2);
  const outH = Math.max(1, halfH * 2);

  const offsetX = halfW - pointX;
  const offsetY = halfH - pointY;

  // If it is already centered enough, avoid allocating a new canvas.
  const alreadyCentered =
    outW === width &&
    outH === height &&
    Math.abs(offsetX) < 1e-6 &&
    Math.abs(offsetY) < 1e-6;
  if (alreadyCentered) {
    return { canvas: sourceCanvas, offset: { x: 0, y: 0 } };
  }

  const outCanvas = document.createElement('canvas');
  outCanvas.width = outW;
  outCanvas.height = outH;
  outCanvas.getContext('2d').drawImage(sourceCanvas, offsetX, offsetY);
  return { canvas: outCanvas, offset: { x: offsetX, y: offsetY } };
}

function isOpaqueAt(imageData, x, y, alphaThreshold) {
  const ix = Math.max(0, Math.min(imageData.width - 1, Math.floor(x)));
  const iy = Math.max(0, Math.min(imageData.height - 1, Math.floor(y)));
  const idx = (iy * imageData.width + ix) * 4 + 3;
  return imageData.data[idx] >= alphaThreshold;
}

function pickRandomOpaquePoint(imageData, width, height, alphaThreshold, maxTries = 200) {
  for (let t = 0; t < maxTries; t++) {
    const x = Math.random() * width;
    const y = Math.random() * height;
    if (isOpaqueAt(imageData, x, y, alphaThreshold)) return [x, y];
  }
  return [Math.random() * width, Math.random() * height];
}

function polygonArea(cell) {
  if (!cell || cell.length < 3) return 0;
  let area = 0;
  for (let i = 0; i < cell.length; i++) {
    const [x1, y1] = cell[i];
    const [x2, y2] = cell[(i + 1) % cell.length];
    area += x1 * y2 - x2 * y1;
  }
  return Math.abs(area) / 2;
}

/**
 * Generate random Voronoi diagram points
 * @param {number} width - Canvas width
 * @param {number} height - Canvas height
 * @param {number} numPoints - Number of Voronoi cells (puzzle pieces)
 * @returns {Array} Array of [x, y] points
 */
export function generateVoronoiPoints(width, height, numPoints) {
  const points = [];
  for (let i = 0; i < numPoints; i++) {
    points.push([
      Math.random() * width,
      Math.random() * height
    ]);
  }
  return points;
}

/**
 * Generate random Voronoi points biased to the opaque pixels of an RGBA image.
 * Falls back to uniform random if no opaque pixels are found quickly.
 */
export function generateVoronoiPointsFromAlpha(imageData, width, height, numPoints, alphaThreshold = 8) {
  const points = [];
  for (let i = 0; i < numPoints; i++) {
    points.push(pickRandomOpaquePoint(imageData, width, height, alphaThreshold));
  }
  return points;
}

/**
 * Create Voronoi diagram from points
 * @param {Array} points - Array of [x, y] points
 * @param {number} width - Canvas width
 * @param {number} height - Canvas height
 * @returns {Delaunay.Voronoi} Voronoi diagram
 */
export function createVoronoi(points, width, height) {
  const delaunay = Delaunay.from(points);
  return delaunay.voronoi([0, 0, width, height]);
}

/**
 * Slice image into Voronoi pieces
 * @param {HTMLImageElement} image - Source image
 * @param {Delaunay.Voronoi} voronoi - Voronoi diagram
 * @param {number} numCells - Number of cells
 * @returns {Array} Array of puzzle piece data
 */
export function sliceImageIntoVoronoiPieces(image, voronoi, numCells, options = {}) {
  const {
    alphaThreshold = 8,
    minOpaqueRatio = 0.01,
    includeOutline = true,
    recenterPivotToOpaque = true,
  } = options;

  const pieces = [];
  
  for (let i = 0; i < numCells; i++) {
    const cell = voronoi.cellPolygon(i);
    if (!cell) continue;
    
    // Get bounds of this cell
    let minX = Infinity, minY = Infinity;
    let maxX = -Infinity, maxY = -Infinity;
    
    cell.forEach(([x, y]) => {
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    });
    
    const width = Math.max(1, Math.ceil(maxX - minX));
    const height = Math.max(1, Math.ceil(maxY - minY));
    
    // Create a canvas for this piece
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    
    // Translate cell coordinates to be relative to piece bounds
    const localCell = cell.map(([x, y]) => [x - minX, y - minY]);
    
    // Create clipping path for this cell
    ctx.beginPath();
    localCell.forEach(([x, y], idx) => {
      if (idx === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    });
    ctx.closePath();
    ctx.clip();
    
    // Draw the portion of the image
    ctx.drawImage(
      image,
      minX, minY, width, height,  // Source rectangle
      0, 0, width, height          // Destination rectangle
    );

    // Fix for "edge" pieces with lots of transparent/negative space:
    // 1) trim transparent borders
    // 2) shift/pad so the *sprite center* lands on an opaque pixel
    // This keeps center-pivot workflows usable in engines like Unity.
    let finalCanvas = canvas;
    let finalX = minX;
    let finalY = minY;

    const trimmed = trimCanvasToOpaqueBounds(finalCanvas, alphaThreshold);
    if (trimmed.needsTrim) {
      finalCanvas = trimmed.canvas;
      finalX += trimmed.offset.x;
      finalY += trimmed.offset.y;
    }

    if (recenterPivotToOpaque) {
      const pivot = findOpaquePivotInCanvas(finalCanvas, alphaThreshold);
      if (pivot.hasOpaque) {
        const recentered = recenterCanvasSoPointIsCenter(finalCanvas, pivot.x, pivot.y);
        finalCanvas = recentered.canvas;
        // If we draw the old canvas at (offsetX, offsetY), the new (0,0)
        // corresponds to source shifted by (-offsetX, -offsetY).
        finalX -= recentered.offset.x;
        finalY -= recentered.offset.y;
      }
    }

    // NOTE:
    // We intentionally do not discard pieces based on transparency.
    // This guarantees that no visible parts of the sprite are lost due to filtering.
    
    pieces.push({
      id: i,
      canvas: finalCanvas,
      originalX: finalX,
      originalY: finalY,
      width: finalCanvas.width,
      height: finalCanvas.height,
      cell: cell
    });
  }
  
  return pieces;
}

/**
 * Draw all pieces on a canvas (reassembled)
 * @param {CanvasRenderingContext2D} ctx - Canvas context
 * @param {Array} pieces - Array of puzzle pieces
 */
export function drawPieces(ctx, pieces, options = {}) {
  const { includeOutline = true } = options;
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  
  pieces.forEach((piece) => {
    ctx.drawImage(piece.canvas, piece.originalX, piece.originalY);

    if (includeOutline) {
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 2;
      ctx.beginPath();
      piece.cell.forEach(([px, py], idx) => {
        if (idx === 0) {
          ctx.moveTo(px, py);
        } else {
          ctx.lineTo(px, py);
        }
      });
      ctx.closePath();
      ctx.stroke();
    }
  });
}

function polygonBounds(cell) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  cell.forEach(([x, y]) => {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  });
  return { minX, minY, maxX, maxY };
}

function hasOpaquePixels(canvas, threshold = 8) {
  const { data } = canvas
    .getContext('2d', { willReadFrequently: true })
    .getImageData(0, 0, canvas.width, canvas.height);
  for (let index = 3; index < data.length; index += 4) {
    if (data[index] >= threshold) return true;
  }
  return false;
}

function slicePolygonCells(image, cells, options = {}) {
  const { alphaThreshold = 8, recenterPivotToOpaque = true } = options;
  const pieces = [];

  cells.forEach((cell, id) => {
    if (!cell || cell.length < 3) return;
    const { minX, minY, maxX, maxY } = polygonBounds(cell);
    const left = Math.max(0, Math.floor(minX));
    const top = Math.max(0, Math.floor(minY));
    const right = Math.min(image.width, Math.ceil(maxX));
    const bottom = Math.min(image.height, Math.ceil(maxY));
    const width = right - left;
    const height = bottom - top;
    if (width < 1 || height < 1) return;

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.beginPath();
    cell.forEach(([x, y], index) => {
      const localX = x - left;
      const localY = y - top;
      if (index === 0) ctx.moveTo(localX, localY);
      else ctx.lineTo(localX, localY);
    });
    ctx.closePath();
    ctx.clip();
    ctx.drawImage(image, left, top, width, height, 0, 0, width, height);
    if (!hasOpaquePixels(canvas, alphaThreshold)) return;

    let finalCanvas = canvas;
    let finalX = left;
    let finalY = top;
    const trimmed = trimCanvasToOpaqueBounds(finalCanvas, alphaThreshold);
    if (trimmed.needsTrim) {
      finalCanvas = trimmed.canvas;
      finalX += trimmed.offset.x;
      finalY += trimmed.offset.y;
    }
    if (recenterPivotToOpaque) {
      const pivot = findOpaquePivotInCanvas(finalCanvas, alphaThreshold);
      if (pivot.hasOpaque) {
        const centered = recenterCanvasSoPointIsCenter(finalCanvas, pivot.x, pivot.y);
        finalCanvas = centered.canvas;
        finalX -= centered.offset.x;
        finalY -= centered.offset.y;
      }
    }

    pieces.push({
      id: pieces.length,
      canvas: finalCanvas,
      originalX: finalX,
      originalY: finalY,
      width: finalCanvas.width,
      height: finalCanvas.height,
      cell,
    });
  });

  return pieces;
}

export function generateGridCells(width, height, requestedPieces) {
  const columns = Math.max(1, Math.round(Math.sqrt(requestedPieces * (width / height))));
  const rows = Math.max(1, Math.ceil(requestedPieces / columns));
  const cellWidth = width / columns;
  const cellHeight = height / rows;
  const cells = [];
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      const x0 = column * cellWidth;
      const y0 = row * cellHeight;
      const x1 = Math.min(width, (column + 1) * cellWidth);
      const y1 = Math.min(height, (row + 1) * cellHeight);
      cells.push([[x0, y0], [x1, y0], [x1, y1], [x0, y1]]);
    }
  }
  return cells;
}

export function generateHexCells(width, height, requestedPieces) {
  const radius = Math.max(4, Math.sqrt((width * height) / (Math.max(1, requestedPieces) * 2.598)));
  const horizontalStep = Math.sqrt(3) * radius;
  const verticalStep = 1.5 * radius;
  const cells = [];
  let row = 0;
  for (let cy = -radius; cy <= height + radius; cy += verticalStep, row++) {
    const offset = row % 2 ? horizontalStep / 2 : 0;
    for (let cx = -horizontalStep + offset; cx <= width + horizontalStep; cx += horizontalStep) {
      const cell = [];
      for (let side = 0; side < 6; side++) {
        const angle = (Math.PI / 180) * (60 * side - 30);
        cell.push([cx + radius * Math.cos(angle), cy + radius * Math.sin(angle)]);
      }
      cells.push(cell);
    }
  }
  return cells;
}

export function sliceImageIntoPolygonPieces(image, cells, options = {}) {
  return slicePolygonCells(image, cells, options);
}

export function normalizeAlphaMask(image) {
  const canvas = document.createElement('canvas');
  canvas.width = image.width;
  canvas.height = image.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(image, 0, 0);
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  let opaque = 0;
  let transparent = 0;
  for (let index = 0; index < imageData.data.length; index += 4) {
    const isOpaque = imageData.data[index + 3] === 255;
    imageData.data[index] = 255;
    imageData.data[index + 1] = 255;
    imageData.data[index + 2] = 255;
    imageData.data[index + 3] = isOpaque ? 255 : 0;
    if (isOpaque) opaque++;
    else transparent++;
  }
  ctx.putImageData(imageData, 0, 0);
  return { canvas, opaque, transparent };
}

export function sliceImageWithMask(image, maskCanvas, requestedPieces, options = {}) {
  const { alphaThreshold = 8, recenterPivotToOpaque = true } = options;
  const columns = Math.max(1, Math.round(Math.sqrt(requestedPieces * (image.width / image.height))));
  const rows = Math.max(1, Math.ceil(requestedPieces / columns));
  const tileWidth = image.width / columns;
  const tileHeight = image.height / rows;
  const pieces = [];

  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      const left = Math.floor(column * tileWidth);
      const top = Math.floor(row * tileHeight);
      const right = Math.min(image.width, Math.ceil((column + 1) * tileWidth));
      const bottom = Math.min(image.height, Math.ceil((row + 1) * tileHeight));
      const width = right - left;
      const height = bottom - top;
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(image, left, top, width, height, 0, 0, width, height);
      ctx.globalCompositeOperation = 'destination-in';
      ctx.imageSmoothingEnabled = false;
      const scale = Math.min(width / maskCanvas.width, height / maskCanvas.height);
      const maskWidth = maskCanvas.width * scale;
      const maskHeight = maskCanvas.height * scale;
      const maskX = (width - maskWidth) / 2;
      const maskY = (height - maskHeight) / 2;
      ctx.drawImage(maskCanvas, maskX, maskY, maskWidth, maskHeight);
      ctx.globalCompositeOperation = 'source-over';
      if (!hasOpaquePixels(canvas, alphaThreshold)) continue;

      let finalCanvas = canvas;
      let finalX = left;
      let finalY = top;
      const trimmed = trimCanvasToOpaqueBounds(finalCanvas, alphaThreshold);
      if (trimmed.needsTrim) {
        finalCanvas = trimmed.canvas;
        finalX += trimmed.offset.x;
        finalY += trimmed.offset.y;
      }
      if (recenterPivotToOpaque) {
        const pivot = findOpaquePivotInCanvas(finalCanvas, alphaThreshold);
        if (pivot.hasOpaque) {
          const centered = recenterCanvasSoPointIsCenter(finalCanvas, pivot.x, pivot.y);
          finalCanvas = centered.canvas;
          finalX -= centered.offset.x;
          finalY -= centered.offset.y;
        }
      }

      pieces.push({
        id: pieces.length,
        canvas: finalCanvas,
        originalX: finalX,
        originalY: finalY,
        width: finalCanvas.width,
        height: finalCanvas.height,
        cell: [[left, top], [right, top], [right, bottom], [left, bottom]],
      });
    }
  }
  return pieces;
}

export function canvasToBlob(canvas, type = 'image/png', quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error('Failed to export canvas'));
        return;
      }
      resolve(blob);
    }, type, quality);
  });
}
