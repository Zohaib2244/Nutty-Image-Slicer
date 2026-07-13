import React, { useCallback, useEffect, useRef, useState } from 'react';
import JSZip from 'jszip';
import './App.css';
import {
  canvasToBlob,
  createVoronoi,
  drawPieces,
  generateGridCells,
  generateHexCells,
  generateVoronoiPoints,
  generateVoronoiPointsFromAlpha,
  getImagePixelData,
  normalizeAlphaMask,
  sliceImageIntoPolygonPieces,
  sliceImageIntoVoronoiPieces,
  sliceImageWithMask,
  trimImageToOpaqueBounds,
} from './voronoiSlicer';

const MODES = [
  { id: 'voronoi', name: 'Voronoi', glyph: 'V', detail: 'Organic cells' },
  { id: 'cubes', name: 'Cubes', glyph: 'C', detail: 'Clean grid' },
  { id: 'hexagons', name: 'Hexagons', glyph: 'H', detail: 'Honeycomb' },
  { id: 'custom', name: 'Custom', glyph: '+', detail: 'Alpha mask' },
];

function Icon({ name }) {
  const paths = {
    upload: <><path d="M12 16V4"/><path d="m7 9 5-5 5 5"/><path d="M5 20h14"/></>,
    image: <><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/></>,
    cut: <><circle cx="6" cy="7" r="3"/><circle cx="6" cy="17" r="3"/><path d="m8.6 8.5 10.4 6"/><path d="m8.6 15.5 10.4-6"/></>,
    download: <><path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/></>,
    moon: <path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8Z"/>,
    sun: <><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.42 1.42M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.42-1.42M17.66 6.34l1.41-1.41"/></>,
    check: <path d="m5 12 4 4L19 6"/>,
  };
  return <svg className="icon" viewBox="0 0 24 24" aria-hidden="true">{paths[name]}</svg>;
}

function App() {
  const [image, setImage] = useState(null);
  const [numPieces, setNumPieces] = useState(24);
  const [pieces, setPieces] = useState([]);
  const [mode, setMode] = useState('voronoi');
  const [mask, setMask] = useState(null);
  const [maskName, setMaskName] = useState('');
  const [maskMessage, setMaskMessage] = useState('');
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const [uploadedFileName, setUploadedFileName] = useState('image');
  const [exportName, setExportName] = useState('sliced-pieces');
  const [isExporting, setIsExporting] = useState(false);
  const [theme, setTheme] = useState(() => localStorage.getItem('slicer-theme') || 'dark');
  const canvasRef = useRef(null);
  const fileInputRef = useRef(null);
  const maskInputRef = useRef(null);
  const imageDataRef = useRef(null);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('slicer-theme', theme);
  }, [theme]);

  const drawSource = useCallback((source) => {
    const canvas = canvasRef.current;
    if (!canvas || !source) return;
    canvas.width = source.width;
    canvas.height = source.height;
    canvas.getContext('2d').drawImage(source, 0, 0);
  }, []);

  const loadFile = useCallback((file) => {
    if (!file?.type?.startsWith('image/')) return;
    const baseName = file.name?.replace(/\.[^.]+$/, '') || 'image';
    setUploadedFileName(baseName);
    setExportName(baseName);
    const reader = new FileReader();
    reader.onload = (event) => {
      const uploadedImage = new Image();
      uploadedImage.onload = () => {
        const trimmed = trimImageToOpaqueBounds(uploadedImage, 8);
        const finish = (finalImage) => {
          setImage(finalImage);
          setPieces([]);
          imageDataRef.current = getImagePixelData(finalImage);
          drawSource(finalImage);
        };
        if (trimmed.needsTrim) {
          const trimmedImage = new Image();
          trimmedImage.onload = () => finish(trimmedImage);
          trimmedImage.src = trimmed.dataUrl;
        } else finish(uploadedImage);
      };
      uploadedImage.src = event.target.result;
    };
    reader.readAsDataURL(file);
  }, [drawSource]);

  const loadMask = useCallback((file) => {
    if (!file?.type?.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const maskImage = new Image();
      maskImage.onload = () => {
        const normalized = normalizeAlphaMask(maskImage);
        if (!normalized.opaque) {
          setMask(null);
          setMaskMessage('No fully opaque pixels found. Use alpha 100% for the shape.');
          return;
        }
        setMask(normalized.canvas);
        setMaskName(file.name);
        setMaskMessage(normalized.transparent
          ? 'Mask ready — RGB is ignored; only fully opaque alpha is kept.'
          : 'Mask has no transparent background. Add transparency around the shape.');
        setMode('custom');
      };
      maskImage.src = event.target.result;
    };
    reader.readAsDataURL(file);
  }, []);

  const sliceNow = useCallback(() => {
    if (!image || (mode === 'custom' && !mask)) return;
    const options = { alphaThreshold: 8, recenterPivotToOpaque: true };
    let nextPieces = [];
    if (mode === 'voronoi') {
      const points = imageDataRef.current
        ? generateVoronoiPointsFromAlpha(imageDataRef.current, image.width, image.height, numPieces, 8)
        : generateVoronoiPoints(image.width, image.height, numPieces);
      const voronoi = createVoronoi(points, image.width, image.height);
      nextPieces = sliceImageIntoVoronoiPieces(image, voronoi, numPieces, options);
    } else if (mode === 'cubes') {
      nextPieces = sliceImageIntoPolygonPieces(
        image,
        generateGridCells(image.width, image.height, numPieces),
        options,
      );
    } else if (mode === 'hexagons') {
      nextPieces = sliceImageIntoPolygonPieces(
        image,
        generateHexCells(image.width, image.height, numPieces),
        options,
      );
    } else {
      nextPieces = sliceImageWithMask(image, mask, numPieces, options);
    }
    setPieces(nextPieces);
    const canvas = canvasRef.current;
    canvas.width = image.width;
    canvas.height = image.height;
    drawPieces(canvas.getContext('2d'), nextPieces, { includeOutline: mode !== 'custom' });
  }, [image, mask, mode, numPieces]);

  useEffect(() => {
    if (!image || (mode === 'custom' && !mask)) return undefined;
    const timer = setTimeout(sliceNow, 180);
    return () => clearTimeout(timer);
  }, [image, mask, mode, numPieces, sliceNow]);

  const downloadPiecesZip = async () => {
    if (!pieces.length || isExporting) return;
    setIsExporting(true);
    try {
      const base = (exportName.trim() || uploadedFileName || 'sliced-pieces')
        .replace(/[^a-z0-9-_]+/gi, '-').replace(/^-+|-+$/g, '') || 'sliced-pieces';
      const zip = new JSZip();
      const folder = zip.folder(base);
      const manifest = {
        source: { fileBaseName: uploadedFileName, width: image.width, height: image.height },
        slicer: { type: mode, requestedPieces: numPieces, exportedPieces: pieces.length, alphaThreshold: 8 },
        coordinateSystem: { origin: 'top-left', x: 'right', y: 'down', units: 'pixels' },
        unity: { pixelsPerUnit: 100, origin: 'image-center', x: 'right', y: 'up' },
        pieces: [],
      };
      await Promise.all(pieces.map(async (piece, index) => {
        const fileName = `${base}-${String(index + 1).padStart(3, '0')}.png`;
        folder.file(fileName, await canvasToBlob(piece.canvas));
        const width = piece.canvas.width;
        const height = piece.canvas.height;
        const centerX = piece.originalX + width / 2;
        const centerY = piece.originalY + height / 2;
        manifest.pieces.push({
          id: piece.id,
          file: fileName,
          boundsPx: { x: piece.originalX, y: piece.originalY, width, height },
          centerPx: { x: centerX, y: centerY },
          unityWorldCenter: {
            x: (centerX - image.width / 2) / 100,
            y: (image.height / 2 - centerY) / 100,
          },
          polygonAbsPx: piece.cell || [],
          polygonLocalPx: (piece.cell || []).map(([x, y]) => [x - piece.originalX, y - piece.originalY]),
        });
      }));
      manifest.pieces.sort((a, b) => a.id - b.id);
      folder.file(`${base}-slice-positioner.json`, JSON.stringify(manifest, null, 2));
      const url = URL.createObjectURL(await zip.generateAsync({ type: 'blob' }));
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `${base}.zip`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } finally {
      setIsExporting(false);
    }
  };

  const modeName = MODES.find((item) => item.id === mode)?.name;

  return (
    <main className="app-shell">
      <header className="namecard sticker">
        <div className="brand-lockup">
          <div className="brand-mark" aria-hidden="true"><span /><span /><span /></div>
          <div>
            <h1>Nutty Slicer</h1>
            <p>Turn one image into production-ready pieces.</p>
          </div>
        </div>
        <div className="header-actions">
          <span className="status-badge"><span className="live-dot" /> Local tool</span>
          <button className="icon-button" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} aria-label="Toggle color theme">
            <Icon name={theme === 'dark' ? 'sun' : 'moon'} />
          </button>
        </div>
      </header>

      <section className="workspace">
        <aside className="control-stack">
          <section className="sticker card accent-card">
            <div className="section-heading"><span>01</span><div><h2>Source image</h2><p>PNG, JPG or WebP</p></div></div>
            <input ref={fileInputRef} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(event) => loadFile(event.target.files?.[0])} />
            <div
              className={`dropzone ${isDraggingOver ? 'is-active' : ''} ${image ? 'has-file' : ''}`}
              onClick={() => fileInputRef.current?.click()}
              onDrop={(event) => { event.preventDefault(); setIsDraggingOver(false); loadFile(event.dataTransfer.files?.[0]); }}
              onDragOver={(event) => { event.preventDefault(); setIsDraggingOver(true); }}
              onDragLeave={() => setIsDraggingOver(false)}
              onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') fileInputRef.current?.click(); }}
              role="button"
              tabIndex="0"
            >
              <div className="drop-icon"><Icon name={image ? 'check' : 'upload'} /></div>
              <strong>{image ? uploadedFileName : 'Drop an image here'}</strong>
              <span>{image ? `${image.width} × ${image.height}px · click to replace` : 'or click to browse your files'}</span>
            </div>
          </section>

          <section className={`sticker card ${!image ? 'is-disabled' : ''}`}>
            <div className="section-heading"><span>02</span><div><h2>Slice pattern</h2><p>Choose how pieces are cut</p></div></div>
            <div className="mode-grid">
              {MODES.map((item) => (
                <button key={item.id} className={`mode-button ${mode === item.id ? 'is-selected' : ''}`} onClick={() => setMode(item.id)} disabled={!image}>
                  <span className="mode-glyph">{item.glyph}</span>
                  <span><strong>{item.name}</strong><small>{item.detail}</small></span>
                </button>
              ))}
            </div>
            {mode === 'custom' && (
              <div className="mask-panel">
                <input ref={maskInputRef} type="file" accept="image/png,image/webp" hidden onChange={(event) => loadMask(event.target.files?.[0])} />
                <button className="mask-upload" onClick={() => maskInputRef.current?.click()}>
                  <Icon name="upload" /><span>{maskName || 'Upload PNG mask'}</span>
                </button>
                <p className={mask && maskMessage.includes('ready') ? 'valid-message' : ''}>{maskMessage || 'Transparent background + fully opaque shape. Color is ignored.'}</p>
              </div>
            )}
          </section>

          <section className={`sticker card ${!image ? 'is-disabled' : ''}`}>
            <div className="range-header"><div className="section-heading compact"><span>03</span><div><h2>Piece count</h2><p>Target amount</p></div></div><output>{numPieces}</output></div>
            <input className="slider" style={{ '--value': numPieces }} type="range" min="4" max="300" value={numPieces} disabled={!image} onChange={(event) => setNumPieces(Number(event.target.value))} />
            <div className="range-labels"><span>04</span><span>300</span></div>
          </section>
        </aside>

        <section className="preview-card sticker accent-card">
          <div className="preview-header">
            <div><span className="eyebrow">Live preview</span><h2>{image ? `${modeName} composition` : 'Your canvas is ready'}</h2></div>
            {image && <div className="preview-stats"><span>{pieces.length || '—'} pieces</span><span>{image.width} × {image.height}</span></div>}
          </div>
          <div className="canvas-stage">
            {!image && <div className="empty-state"><div className="empty-icon"><Icon name="image" /></div><h3>Start with an image</h3><p>Upload a source file and your sliced preview will appear here.</p></div>}
            {mode === 'custom' && image && !mask && <div className="canvas-notice">Upload an alpha mask to preview custom pieces.</div>}
            <canvas ref={canvasRef} className={image ? 'main-canvas is-visible' : 'main-canvas'} />
          </div>
          <div className="preview-footer">
            <div className="hint"><span className="hint-key">ALPHA</span><span>Transparent source pixels stay transparent in every export.</span></div>
            <button className="primary-button" onClick={sliceNow} disabled={!image || (mode === 'custom' && !mask)}><Icon name="cut" /> Slice now</button>
          </div>
        </section>
      </section>

      <section className={`export-bar sticker ${!pieces.length ? 'is-disabled' : ''}`}>
        <div className="export-copy"><span className="step-number">04</span><div><span className="eyebrow">Export package</span><strong>{pieces.length ? `${pieces.length} transparent PNG pieces + placement JSON` : 'Slice an image to unlock export'}</strong></div></div>
        <div className="export-actions">
          <label><span>File name</span><input value={exportName} disabled={!pieces.length} onChange={(event) => setExportName(event.target.value)} /></label>
          <button className="primary-button" onClick={downloadPiecesZip} disabled={!pieces.length || isExporting}><Icon name="download" />{isExporting ? 'Packing…' : 'Download ZIP'}</button>
        </div>
      </section>
      <footer><span>Runs entirely in your browser</span><span>Images never leave this device</span></footer>
    </main>
  );
}

export default App;
