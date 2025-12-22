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

    // If the source has transparency, skip pieces that are mostly transparent.
    // This helps "ignore" transparent background areas (e.g., PNG with alpha).
    const pieceData = ctx.getImageData(0, 0, width, height);
    let opaqueCount = 0;
    for (let p = 3; p < pieceData.data.length; p += 4) {
      if (pieceData.data[p] >= alphaThreshold) opaqueCount++;
    }
    const totalPixels = canvas.width * canvas.height;
    const opaqueRatio = totalPixels > 0 ? opaqueCount / totalPixels : 0;
    if (opaqueRatio < minOpaqueRatio) {
      continue;
    }
    
    pieces.push({
      id: i,
      canvas: canvas,
      originalX: minX,
      originalY: minY,
      width: width,
      height: height,
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
