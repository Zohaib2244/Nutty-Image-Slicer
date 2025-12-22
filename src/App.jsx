import React, { useState, useRef, useEffect, useCallback } from 'react';
import './App.css';
import JSZip from 'jszip';
import {
  generateVoronoiPoints, 
  generateVoronoiPointsFromAlpha,
  createVoronoi, 
  sliceImageIntoVoronoiPieces, 
  drawPieces,
  getImagePixelData,
  canvasToBlob,
  trimImageToOpaqueBounds,
} from './voronoiSlicer';

function App() {
  const [image, setImage] = useState(null);
  const [numPieces, setNumPieces] = useState(20);
  const [pieces, setPieces] = useState([]);
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const [uploadedFileName, setUploadedFileName] = useState('image');
  const [exportName, setExportName] = useState('sliced-pieces');
  const canvasRef = useRef(null);
  const fileInputRef = useRef(null);
  const imageDataRef = useRef(null);

  const loadFile = useCallback((file) => {
    if (!file || !file.type || !file.type.startsWith('image/')) return;

    const baseName = file.name ? file.name.replace(/\.[^.]+$/, '') : 'image';
    setUploadedFileName(baseName);
    setExportName(baseName || 'sliced-pieces');

    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const trimmed = trimImageToOpaqueBounds(img, 8);
        const handleFinalImage = (finalImage) => {
          setImage(finalImage);
          setPieces([]);
          imageDataRef.current = getImagePixelData(finalImage);
        };

        if (trimmed.needsTrim) {
          const trimmedImg = new Image();
          trimmedImg.onload = () => handleFinalImage(trimmedImg);
          trimmedImg.src = trimmed.dataUrl;
        } else {
          handleFinalImage(img);
        }
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  }, []);

  const handleImageUpload = (event) => {
    const file = event.target.files && event.target.files[0];
    loadFile(file);
  };

  const handleDrop = (event) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDraggingOver(false);
    const file = event.dataTransfer?.files?.[0];
    loadFile(file);
  };

  const handleDragOver = (event) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDraggingOver(true);
  };

  const handleDragLeave = (event) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDraggingOver(false);
  };

  const sliceNow = useCallback(() => {
    if (!image) return;

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    // Set canvas size to match image
    canvas.width = image.width;
    canvas.height = image.height;

    // Generate Voronoi points
    const imageData = imageDataRef.current;
    const points = imageData
      ? generateVoronoiPointsFromAlpha(imageData, image.width, image.height, numPieces, 8)
      : generateVoronoiPoints(image.width, image.height, numPieces);
    const voronoi = createVoronoi(points, image.width, image.height);

    // Slice image into pieces
    const slicedPieces = sliceImageIntoVoronoiPieces(image, voronoi, numPieces, {
      alphaThreshold: 8,
      minOpaqueRatio: 0,
      includeOutline: true,
    });
    setPieces(slicedPieces);

    // Draw pieces on canvas
    drawPieces(ctx, slicedPieces, { includeOutline: true });
  }, [image, numPieces]);

  // Re-slice in realtime as slider moves (debounced)
  useEffect(() => {
    if (!image) return;
    const t = setTimeout(() => {
      sliceNow();
    }, 200);
    return () => clearTimeout(t);
  }, [image, numPieces, sliceNow]);

  const downloadPiecesZip = async () => {
    if (!pieces.length) return;

    const baseExportName = (exportName?.trim() || uploadedFileName || 'sliced-pieces').replace(/\s+/g, '-');
    const zip = new JSZip();
    const folder = zip.folder(baseExportName);
    if (!folder) return;

    const manifest = {
      source: {
        fileBaseName: uploadedFileName,
        width: image?.width ?? null,
        height: image?.height ?? null,
        coordinateSystem: {
          name: 'image',
          origin: 'top-left',
          x: 'right',
          y: 'down',
          units: 'pixels',
        },
      },
      unity: {
        pixelsPerUnit: 100,
        coordinateSystem: {
          name: 'unity-2d-world',
          origin: 'image-center',
          x: 'right',
          y: 'up',
          units: 'world',
        },
        placement: {
          spritePivot: 'center',
          positionUses: 'piece center',
          formula: {
            worldX: '(centerPx.x - source.width/2) / pixelsPerUnit',
            worldY: '(source.height/2 - centerPx.y) / pixelsPerUnit',
          },
        },
      },
      ugui: {
        intendedUse: 'Canvas Screen Space (pixel-perfect placement)',
        coordinateSystem: {
          name: 'recttransform-anchored',
          origin: 'parent-rect-center',
          x: 'right',
          y: 'up',
          units: 'pixels',
        },
        placement: {
          recommendedCanvas: {
            renderMode: 'ScreenSpaceOverlay',
            canvasScaler: 'ConstantPixelSize',
          },
          parentRect: {
            sizeDeltaPx: { width: 'source.width', height: 'source.height' },
            anchors: 'center',
            pivot: 'center',
          },
          pieceRect: {
            anchors: 'center',
            pivot: 'center',
            positionUses: 'piece center',
            formula: {
              anchoredX: 'centerPx.x - source.width/2',
              anchoredY: 'source.height/2 - centerPx.y',
            },
          },
        },
      },
      slicer: {
        type: 'voronoi',
        requestedPieces: numPieces,
        alphaThreshold: 8,
        minOpaqueRatio: 0.01,
      },
      pieces: [],
    };

      const exportJobs = pieces.map(async (piece, idx) => {
      const blob = await canvasToBlob(piece.canvas, 'image/png');
      const padded = String(idx + 1).padStart(3, '0');

        const fileName = `${baseExportName}-${padded}-piece-${piece.id}.png`;
      folder.file(fileName, blob);

      const width = piece.canvas?.width ?? piece.width;
      const height = piece.canvas?.height ?? piece.height;
      const centerX = piece.originalX + width / 2;
      const centerY = piece.originalY + height / 2;

      const srcW = image?.width ?? null;
      const srcH = image?.height ?? null;
      const ppu = manifest.unity.pixelsPerUnit;
      const worldCenterX = srcW != null ? (centerX - srcW / 2) / ppu : null;
      const worldCenterY = srcH != null ? (srcH / 2 - centerY) / ppu : null;

      const anchoredX = srcW != null ? (centerX - srcW / 2) : null;
      const anchoredY = srcH != null ? (srcH / 2 - centerY) : null;

      const polygonAbs = (piece.cell || []).map(([x, y]) => [x, y]);
      const polygonLocal = (piece.cell || []).map(([x, y]) => [x - piece.originalX, y - piece.originalY]);

      manifest.pieces.push({
        id: piece.id,
        file: fileName,
        boundsPx: {
          x: piece.originalX,
          y: piece.originalY,
          width,
          height,
        },
        centerPx: { x: centerX, y: centerY },
        unityWorldCenter: { x: worldCenterX, y: worldCenterY },
        uguiAnchoredCenterPx: { x: anchoredX, y: anchoredY },
        uguiSizePx: { width, height },
        polygonAbsPx: polygonAbs,
        polygonLocalPx: polygonLocal,
      });
    });

    await Promise.all(exportJobs);

    // Keep manifest ordering stable for editor tools
    manifest.pieces.sort((a, b) => a.id - b.id);
    folder.file(`${baseExportName}-slice-positioner.json`, JSON.stringify(manifest, null, 2));

    const zipBlob = await zip.generateAsync({ type: 'blob' });

    const url = URL.createObjectURL(zipBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${baseExportName}.zip`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  return (
    <div className="App">
      <header className="App-header">
        <h1>🥜 Nutty Image Slicer</h1>
        <p>Slice your images into Voronoi puzzle pieces</p>
      </header>

      <div className="app-layout">
        <div className="controls">
          <div className="control-group">
            <input
              type="file"
              ref={fileInputRef}
              accept="image/png,image/jpeg,image/jpg"
              onChange={handleImageUpload}
              style={{ display: 'none' }}
            />
            <div
              className={`dropzone ${isDraggingOver ? 'dropzone--active' : ''}`}
              onClick={() => fileInputRef.current?.click()}
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') fileInputRef.current?.click();
              }}
            >
              <div className="dropzone__title">Drag & drop an image here</div>
              <div className="dropzone__subtitle">or click to browse (PNG/JPG)</div>
            </div>
          </div>

          {image && (
            <>
              <div className="control-group">
                <label htmlFor="numPieces">
                  Number of Pieces: <strong>{numPieces}</strong>
                </label>
                  <input
                    id="numPieces"
                    type="range"
                    min="5"
                    max="300"
                    value={numPieces}
                    onChange={(e) => setNumPieces(parseInt(e.target.value))}
                    className="slider"
                  />
                <div className="range-labels">
                  <span>Fewer (Bigger)</span>
                  <span>More (Smaller)</span>
                </div>
              </div>

              <div className="control-group">
                <button
                  className="btn btn-success"
                  onClick={sliceNow}
                >
                  ✂️ Slice Image
                </button>
              </div>

              {pieces.length > 0 && (
                <>
                  <div className="control-group">
                    <label htmlFor="exportName">Export Name</label>
                    <input
                      id="exportName"
                      className="text-input"
                      type="text"
                      value={exportName}
                      onChange={(e) => setExportName(e.target.value)}
                      placeholder="enter filename"
                    />
                  </div>
                  <div className="control-group actions-row">
                    <button className="btn btn-primary" onClick={downloadPiecesZip}>
                      ⬇️ Export
                    </button>
                  </div>
                </>
              )}
            </>
          )}
        </div>

        <div className="preview">
          <div className="canvas-container">
            {!image && (
              <div className="placeholder">
                <p>👆 Upload an image to get started!</p>
              </div>
            )}
            <canvas ref={canvasRef} className="main-canvas"></canvas>
          </div>
        </div>
      </div>

      {pieces.length > 0 && (
        <div className="info">
          <p>✅ Image sliced into {pieces.length} Voronoi pieces!</p>
        </div>
      )}
    </div>
  );
}

export default App;
