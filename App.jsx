// ═══════════════════════════════════════════════════════════════
//  App.jsx  —  OPPO Birthday Mosaic  (Firebase Realtime Edition)
//  Tích hợp: Firebase Storage (ảnh) + Firestore (metadata + realtime)
// ═══════════════════════════════════════════════════════════════

import { useState, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence }                   from "framer-motion";
import {
  subscribeToPixels,
  savePixelToFirestore,
  uploadImageToStorage,
  PIXELS_COLLECTION,
} from "./firebase";

/* ─────────────────────────────────────────────────────────────
   GLOBAL CSS (injected once)
   ───────────────────────────────────────────────────────────── */
const GLOBAL_CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Sora:wght@200;300;400;600;700;800&display=swap');

  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  html, body {
    background: rgb(51 48 48)!important;
    color: bg-[#06141d];
    font-family: 'Sora', sans-serif;
    overflow-x: hidden;
  }
  ::-webkit-scrollbar { width: 4px; }
  ::-webkit-scrollbar-track { background: #000; }
  ::-webkit-scrollbar-thumb { background: #00ffc8; border-radius: 2px; }

  @keyframes breath {
    0%,100% { opacity:.35; box-shadow:0 0 4px #00ffc822; }
    50%      { opacity:.6;  box-shadow:0 0 10px #00ffc855; }
  }
  @keyframes scanline {
    0%   { left:-10%; opacity:1; }
    100% { left:110%; opacity:.6; }
  }
  @keyframes reveal-glow {
    0%  { filter:brightness(1); }
    40% { filter:brightness(2.8) saturate(1.6); }
    100%{ filter:brightness(1.4) saturate(1.2); }
  }
  @keyframes grid-in {
    from { opacity:0; transform:translateY(30px); }
    to   { opacity:1; transform:translateY(0); }
  }
  @keyframes ticker {
    from { transform:translateX(0); }
    to   { transform:translateX(-50%); }
  }
  @keyframes spin { to { transform:rotate(360deg); } }
  @keyframes pulse-ring {
    0%   { box-shadow:0 0 0 0 rgba(0,255,200,.5); }
    70%  { box-shadow:0 0 0 8px rgba(0,255,200,0); }
    100% { box-shadow:0 0 0 0 rgba(0,255,200,0); }
  }
  @keyframes new-pixel-in {
    0%   { transform:scale(0) rotate(-15deg); filter:brightness(3); opacity:0; }
    65%  { transform:scale(1.18) rotate(4deg); filter:brightness(2); opacity:1; }
    100% { transform:scale(1) rotate(0); filter:brightness(1); opacity:1; }
  }

  .pixel-empty   { animation: breath 3.2s ease-in-out infinite; }
  .pixel-reveal  { animation: reveal-glow 1.3s ease forwards; }
  .pixel-new     { animation: new-pixel-in .65s cubic-bezier(.36,.07,.19,.97) forwards; }
  .scanline-bar  { animation: scanline 1.7s cubic-bezier(.4,0,.2,1) forwards; }
  .ticker-wrap   { overflow:hidden; white-space:nowrap; }
  .ticker-inner  { display:inline-flex; animation:ticker 30s linear infinite; }
  .spin          { animation:spin 1s linear infinite; }
  .pulse-ring    { animation:pulse-ring 1.5s ease-out infinite; }
`;

/* ─────────────────────────────────────────────────────────────
   OPPO PIXEL MATRIX  7 × 23
   1 = active pixel   0 = transparent gap
   ───────────────────────────────────────────────────────────── */
const MATRIX = [
  [0,1,1,1,0, 0, 0,1,1,1,0, 0, 0,1,1,1,0, 0, 0,1,1,1,0],
  [1,0,0,0,1, 0, 1,0,0,0,1, 0, 1,0,0,0,1, 0, 1,0,0,0,1],
  [1,0,0,0,1, 0, 1,0,0,0,1, 0, 1,0,0,0,1, 0, 1,0,0,0,1],
  [1,0,0,0,1, 0, 1,1,1,1,0, 0, 1,1,1,1,0, 0, 1,0,0,0,1],
  [1,0,0,0,1, 0, 1,0,0,0,0, 0, 1,0,0,0,0, 0, 1,0,0,0,1],
  [1,0,0,0,1, 0, 1,0,0,0,0, 0, 1,0,0,0,0, 0, 1,0,0,0,1],
  [0,1,1,1,0, 0, 1,0,0,0,0, 0, 1,0,0,0,0, 0, 0,1,1,1,0],
];
const ROWS = MATRIX.length;
const COLS = MATRIX[0].length;
const ACTIVE_COORDS = [];
MATRIX.forEach((row, r) =>
  row.forEach((v, c) => { if (v === 1) ACTIVE_COORDS.push([r, c]); })
);
const TOTAL = ACTIVE_COORDS.length;  // tổng ô active

/* ─────────────────────────────────────────────────────────────
   COMPONENT: OnlineIndicator
   ───────────────────────────────────────────────────────────── */
function OnlineIndicator() {
  return (
    <div style={{ display:"flex", alignItems:"center", gap:6 }}>
      <div className="pulse-ring" style={{ width:7, height:7, borderRadius:"50%", background:"#00ffc8" }} />
      <span style={{ fontSize:9, letterSpacing:2, color:"#00ffc888", fontWeight:300 }}>LIVE</span>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   COMPONENT: Header
   ───────────────────────────────────────────────────────────── */
function Header({ filled, total }) {
  const pct = total > 0 ? Math.round((filled / total) * 100) : 0;
  return (
    <header style={{ position:"sticky", top:0, zIndex:100, background:"rgba(0,0,0,0.9)", backdropFilter:"blur(24px)", borderBottom:"1px solid rgba(0,255,200,0.1)" }}>
      {/* Energy Bar */}
      <div style={{ height:2, background:"#111", overflow:"hidden" }}>
        <motion.div
          animate={{ width:`${pct}%` }}
          transition={{ duration:.9, ease:"easeOut" }}
          style={{ height:"100%", background:"linear-gradient(90deg,#00ffc8,#008a6c)", boxShadow:"0 0 14px #00ffc8bb" }}
        />
      </div>

      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"11px 24px" }}>
        {/* Logo */}
        <div style={{ display:"flex", alignItems:"center", gap:12 }}>
          <div style={{ width:32, height:32, borderRadius:8, background:"linear-gradient(135deg,#008a6c,#00ffc8)", display:"flex", alignItems:"center", justifyContent:"center", fontWeight:800, fontSize:13, color:"#000", letterSpacing:1 }}>OP</div>
          <div>
            <div style={{ fontWeight:700, fontSize:13, letterSpacing:3 }}>OPPO</div>
            <div style={{ fontSize:9, letterSpacing:2, color:"text-[#00ffcc]", fontWeight:300 }}>BIRTHDAY MOSAIC</div>
          </div>
        </div>
        {/* Right: online + pct */}
        <div style={{ display:"flex", alignItems:"center", gap:16 }}>
          <OnlineIndicator />
          <div style={{ textAlign:"right" }}>
            <div style={{ fontSize:9, letterSpacing:2, color:"#00ffc877", fontWeight:300 }}>POWERING THE MOMENT</div>
            <div style={{ fontSize:19, fontWeight:800, background:"linear-gradient(90deg,#00ffc8,#008a6c)", WebkitBackgroundClip:"text", WebkitTextFillColor:"transparent" }}>{pct}%</div>
          </div>
        </div>
      </div>

      {/* Ticker */}
      <div className="ticker-wrap" style={{ borderTop:"1px solid rgba(0,255,200,0.05)", padding:"5px 0", background:"rgba(0,255,200,0.015)" }}>
        <div className="ticker-inner">
          {Array(8).fill("✦ HAPPY BIRTHDAY OPPO  ·  SHARE YOUR MOMENT  ·  POWER THE MOSAIC  ·  REALTIME COLLECTIVE ART  ·  ").map((t,i) => (
            <span key={i} style={{ fontSize:9, letterSpacing:3, color:"#00ffc844", marginRight:40, fontWeight:300 }}>{t}</span>
          ))}
        </div>
      </div>
    </header>
  );
}

/* ─────────────────────────────────────────────────────────────
   COMPONENT: Tooltip
   ───────────────────────────────────────────────────────────── */
function Tooltip({ name, wish }) {
  return (
    <motion.div
      initial={{ opacity:0, y:8, scale:.9 }}
      animate={{ opacity:1, y:0, scale:1 }}
      exit={{ opacity:0, y:4, scale:.9 }}
      transition={{ duration:.14 }}
      style={{
        position:"absolute", bottom:"calc(100% + 12px)", left:"50%", transform:"translateX(-50%)",
        background:"rgba(0,0,0,0.94)", backdropFilter:"blur(20px)",
        border:"1px solid rgba(0,255,200,0.28)", borderRadius:10,
        padding:"10px 14px", minWidth:155, maxWidth:220, zIndex:60,
        pointerEvents:"none", boxShadow:"0 0 30px #00ffc820, 0 10px 40px #000c",
        whiteSpace:"nowrap",
      }}
    >
      {/* Arrow */}
      <div style={{ position:"absolute", bottom:-6, left:"50%", transform:"translateX(-50%)", width:10, height:6, overflow:"hidden" }}>
        <div style={{ width:8, height:8, background:"rgba(0,0,0,0.94)", transform:"rotate(45deg)", marginTop:2, marginLeft:1, border:"1px solid rgba(0,255,200,.28)" }} />
      </div>
      <div style={{ fontSize:10, fontWeight:600, color:"#00ffc8", letterSpacing:1, marginBottom:5 }}>{name}</div>
      <div style={{ fontSize:10, color:"rgba(255,255,255,.55)", fontWeight:300, lineHeight:1.5, overflow:"hidden", textOverflow:"ellipsis" }}>{wish || "Happy Birthday OPPO! 🎉"}</div>
    </motion.div>
  );
}

/* ─────────────────────────────────────────────────────────────
   COMPONENT: Pixel
   ───────────────────────────────────────────────────────────── */
function Pixel({ data, cellSize, onClickEmpty, isRevealing, highlighted, isNew, pixelRef }) {
  const [hovered, setHovered] = useState(false);

  /* ── skeleton / not yet loaded from Firestore ── */
  if (!data) {
    return (
      <div
        onClick={onClickEmpty}
        className="pixel-empty"
        style={{ width:cellSize, height:cellSize, borderRadius:4, cursor:"pointer",
                 background:"rgba(0,255,200,0.04)", border:"1px solid rgba(0,255,200,.16)",
                 backdropFilter:"blur(4px)" }}
      />
    );
  }

  /* ── empty ── */
  if (data.state === "empty") {
    return (
      <motion.div
        onClick={onClickEmpty}
        onHoverStart={() => setHovered(true)}
        onHoverEnd={() => setHovered(false)}
        whileHover={{ scale:1.13 }}
        whileTap={{ scale:.93 }}
        className="pixel-empty"
        style={{
          width:cellSize, height:cellSize, borderRadius:4, cursor:"pointer",
          background:`rgba(0,255,200,${hovered?.08:.03})`,
          border:`1px solid rgba(0,255,200,${hovered?.5:.16})`,
          backdropFilter:"blur(4px)",
          boxShadow: hovered ? "0 0 18px #00ffc840,inset 0 0 8px #00ffc810" : "none",
          display:"flex", alignItems:"center", justifyContent:"center",
          transition:"border-color .2s,box-shadow .2s",
        }}
      >
        {hovered && (
          <motion.span initial={{ opacity:0,scale:.4 }} animate={{ opacity:1,scale:1 }}
            style={{ fontSize:cellSize>30?14:9, color:"#00ffc8", fontWeight:700 }}>+</motion.span>
        )}
      </motion.div>
    );
  }

  /* ── loading (uploading) ── */
  if (data.state === "loading") {
    return (
      <div style={{ width:cellSize, height:cellSize, borderRadius:4,
                    background:"rgba(0,255,200,0.06)", border:"1px solid rgba(0,255,200,.4)",
                    display:"flex", alignItems:"center", justifyContent:"center", overflow:"hidden" }}>
        <div className="spin" style={{ width:"38%", height:"38%", borderRadius:"50%",
                                       border:"2px solid transparent", borderTopColor:"#00ffc8" }} />
        {data.uploadPct > 0 && data.uploadPct < 100 && (
          <span style={{ position:"absolute", fontSize:8, color:"#00ffc8aa" }}>{data.uploadPct}%</span>
        )}
      </div>
    );
  }

  /* ── filled ── */
  return (
    <motion.div
      ref={pixelRef}
      onHoverStart={() => setHovered(true)}
      onHoverEnd={() => setHovered(false)}
      whileHover={{ scale:1.09, zIndex:30 }}
      className={[isNew?"pixel-new":"", isRevealing?"pixel-reveal":""].join(" ")}
      style={{
        width:cellSize, height:cellSize, borderRadius:4,
        overflow:"visible", position:"relative", cursor:"default",
        outline: highlighted ? "2px solid #ffd700" : "none",
        outlineOffset:2,
        boxShadow: highlighted ? "0 0 22px #ffd70088" : "none",
        zIndex: hovered ? 20 : 1,
      }}
    >
      <div style={{ width:"100%", height:"100%", borderRadius:4, overflow:"hidden", position:"relative" }}>
        <img
          src={data.imageUrl}
          alt={data.name}
          style={{ width:"100%", height:"100%", objectFit:"cover", display:"block" }}
          loading="lazy"
        />
        {/* OPPO Tint — fades on hover */}
        <motion.div
          animate={{ opacity: hovered ? 0 : 0.52 }}
          transition={{ duration:.22 }}
          style={{ position:"absolute", inset:0,
                   background:"linear-gradient(135deg,rgba(0,138,108,.72),rgba(0,255,200,.28))",
                   pointerEvents:"none" }}
        />
        {/* Neon border */}
        <div style={{ position:"absolute", inset:0, borderRadius:4,
                      border:`1px solid rgba(0,255,200,${hovered?.85:.28})`,
                      boxShadow: hovered ? "0 0 14px #00ffc866" : "none",
                      transition:"all .22s", pointerEvents:"none" }} />
      </div>

      <AnimatePresence>
        {hovered && data.name && <Tooltip name={data.name} wish={data.wish} />}
      </AnimatePresence>
    </motion.div>
  );
}

/* ─────────────────────────────────────────────────────────────
   COMPONENT: MosaicGrid
   ───────────────────────────────────────────────────────────── */
function MosaicGrid({ pixels, onClickEmpty, revealActive, highlightKey, newKey }) {
  const containerRef = useRef(null);
  const [cellSize, setCellSize] = useState(44);
  const pixelRefs   = useRef({});

  useEffect(() => {
    if (!containerRef.current) return;
    const calc = () => {
      const w = containerRef.current.offsetWidth - 56;
      setCellSize(Math.min(Math.max(Math.floor(w / (COLS * 1.08)), 16), 54));
    };
    calc();
    const ro = new ResizeObserver(calc);
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  // Auto-scroll to highlighted cell
  useEffect(() => {
    if (highlightKey && pixelRefs.current[highlightKey]) {
      pixelRefs.current[highlightKey].scrollIntoView({ behavior:"smooth", block:"center", inline:"center" });
    }
  }, [highlightKey]);

  const GAP = Math.max(2, Math.floor(cellSize * 0.08));

  return (
    <div ref={containerRef} style={{ width:"100%", animation:"grid-in .55s ease both" }}>
      <div style={{
        display:"grid",
        gridTemplateColumns:`repeat(${COLS},${cellSize}px)`,
        gridTemplateRows:`repeat(${ROWS},${cellSize}px)`,
        gap:GAP,
        margin:"0 auto", width:"fit-content",
        padding:18,
        background:"rgba(255,255,255,0.012)",
        backdropFilter:"blur(12px)",
        borderRadius:16,
        border:"1px solid rgba(0,255,200,0.07)",
        boxShadow:"0 0 90px rgba(0,255,200,0.04),inset 0 0 60px rgba(0,0,0,.55)",
        position:"relative", overflow:"visible",
      }}>
        {/* Digital Scanline beam */}
        {revealActive && (
          <div className="scanline-bar" style={{
            position:"absolute", top:0, width:"16%", height:"100%",
            background:"linear-gradient(90deg,transparent,rgba(0,255,200,.28),rgba(0,255,200,.55),rgba(0,255,200,.28),transparent)",
            pointerEvents:"none", zIndex:40, borderRadius:4,
          }} />
        )}

        {MATRIX.map((row, ri) =>
          row.map((val, ci) => {
            const key = `${ri}-${ci}`;
            return (
              <div key={key} style={{ width:cellSize, height:cellSize, overflow:"visible", position:"relative" }}>
                {val === 1 ? (
                  <Pixel
                    data={pixels[key]}
                    cellSize={cellSize}
                    onClickEmpty={() => onClickEmpty(ri, ci)}
                    isRevealing={revealActive}
                    highlighted={highlightKey === key}
                    isNew={newKey === key}
                    pixelRef={el => { pixelRefs.current[key] = el; }}
                  />
                ) : (
                  <div style={{ width:cellSize, height:cellSize }} />
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   COMPONENT: UploadModal
   ───────────────────────────────────────────────────────────── */
function UploadModal({ onClose, onConfirm }) {
  const inputRef = useRef(null);
  const [preview,  setPreview]  = useState(null);
  const [dragging, setDragging] = useState(false);
  const [name,     setName]     = useState("");
  const [wish,     setWish]     = useState("Happy Birthday OPPO! 🎉");

  const handleFile = (file) => {
    if (!file?.type.startsWith("image/")) return;
    const reader = new FileReader();
    reader.onload = e => setPreview(e.target.result);
    reader.readAsDataURL(file);
  };

  const canSubmit = preview && name.trim();

  return (
    <motion.div
      initial={{ opacity:0 }} animate={{ opacity:1 }} exit={{ opacity:0 }}
      onClick={onClose}
      style={{ position:"fixed", inset:0, zIndex:200, display:"flex", alignItems:"center",
               justifyContent:"center", padding:20, background:"rgba(0,0,0,0.88)",
               backdropFilter:"blur(28px)" }}
    >
      <motion.div
        initial={{ scale:.86, y:28, opacity:0 }}
        animate={{ scale:1, y:0, opacity:1 }}
        exit={{ scale:.9, y:16, opacity:0 }}
        transition={{ type:"spring", stiffness:340, damping:28 }}
        onClick={e => e.stopPropagation()}
        style={{ width:"100%", maxWidth:400,
                 background:"rgba(6,16,12,0.97)",
                 border:"1px solid rgba(0,255,200,0.22)",
                 borderRadius:20, padding:28,
                 boxShadow:"0 0 100px rgba(0,255,200,0.1),0 32px 80px rgba(0,0,0,.85)" }}
      >
        {/* Header */}
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:22 }}>
          <div>
            <div style={{ fontSize:9, letterSpacing:3, color:"#00ffc877", fontWeight:300, marginBottom:4 }}>CONTRIBUTE TO MOSAIC</div>
            <div style={{ fontSize:17, fontWeight:700 }}>Add Your Photo</div>
          </div>
          <button onClick={onClose} style={{ width:30, height:30, borderRadius:"50%", background:"rgba(255,255,255,.05)", border:"1px solid rgba(255,255,255,.1)", color:"#ffffff88", cursor:"pointer", fontSize:14, display:"flex", alignItems:"center", justifyContent:"center" }}>✕</button>
        </div>

        {/* Drop zone */}
        <div
          onClick={() => inputRef.current?.click()}
          onDragOver={e => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={e => { e.preventDefault(); setDragging(false); handleFile(e.dataTransfer.files[0]); }}
          style={{ border:`1.5px dashed rgba(0,255,200,${dragging?.75:.22})`,
                   background: dragging ? "rgba(0,255,200,0.07)" : "rgba(0,255,200,0.02)",
                   borderRadius:12, height:140, display:"flex", flexDirection:"column",
                   alignItems:"center", justifyContent:"center", cursor:"pointer",
                   overflow:"hidden", transition:"all .2s" }}
        >
          {preview
            ? <img src={preview} alt="" style={{ width:"100%", height:"100%", objectFit:"cover" }} />
            : <>
                <div style={{ fontSize:28, marginBottom:8, opacity:.55 }}>⬆</div>
                <div style={{ fontSize:12, fontWeight:500, color:"#ffffff77" }}>Drop image or click to browse</div>
                <div style={{ fontSize:10, color:"#00ffc855", marginTop:4, fontWeight:300 }}>PNG · JPG · WEBP</div>
              </>
          }
        </div>
        <input ref={inputRef} type="file" accept="image/*" style={{ display:"none" }} onChange={e => handleFile(e.target.files[0])} />
        {preview && (
          <button onClick={() => setPreview(null)} style={{ fontSize:10, color:"#ff6b6b77", background:"none", border:"none", cursor:"pointer", width:"100%", padding:"4px 0", letterSpacing:1 }}>
            REMOVE IMAGE
          </button>
        )}

        {/* Fields */}
        {[
          { label:"YOUR NAME *",  val:name, set:setName, ph:"Enter your name...",   max:30 },
          { label:"YOUR WISH",    val:wish, set:setWish, ph:"A birthday wish...",   max:70 },
        ].map(({ label, val, set, ph, max }) => (
          <div key={label} style={{ marginTop:14 }}>
            <div style={{ fontSize:9, letterSpacing:2, color:"#00ffc877", fontWeight:300, marginBottom:5 }}>{label}</div>
            <input
              value={val} onChange={e => set(e.target.value)}
              placeholder={ph} maxLength={max}
              style={{ width:"100%", padding:"10px 14px", borderRadius:8,
                       border:`1px solid rgba(0,255,200,${val.trim()?.32:.1})`,
                       background:"rgba(0,255,200,0.03)", color:"#fff",
                       fontSize:13, fontFamily:"Sora,sans-serif", fontWeight:300,
                       outline:"none", transition:"border .2s" }}
            />
          </div>
        ))}

        {/* Actions */}
        <div style={{ display:"flex", gap:10, marginTop:20 }}>
          <button onClick={onClose} style={{ flex:1, padding:"11px 0", borderRadius:9, border:"1px solid rgba(255,255,255,.08)", background:"transparent", color:"#ffffff44", fontSize:12, cursor:"pointer", fontFamily:"Sora,sans-serif", letterSpacing:1 }}>CANCEL</button>
          <motion.button
            whileHover={canSubmit ? { scale:1.02 } : {}}
            whileTap={canSubmit ? { scale:.97 } : {}}
            onClick={() => canSubmit && onConfirm(preview, name.trim(), wish.trim())}
            disabled={!canSubmit}
            style={{ flex:2, padding:"11px 0", borderRadius:9, border:"none",
                     background: canSubmit ? "linear-gradient(135deg,#008a6c,#00ffc8)" : "#111",
                     color: canSubmit ? "#000" : "#333",
                     fontSize:12, fontWeight:700, cursor: canSubmit ? "pointer" : "not-allowed",
                     fontFamily:"Sora,sans-serif", letterSpacing:2, transition:"background .2s" }}
          >CONFIRM →</motion.button>
        </div>
      </motion.div>
    </motion.div>
  );
}

/* ─────────────────────────────────────────────────────────────
   COMPONENT: SearchBar
   ───────────────────────────────────────────────────────────── */
function SearchBar({ pixels, onFound }) {
  const [q,      setQ]      = useState("");
  const [status, setStatus] = useState(null); // "found"|"not_found"

  const search = () => {
    const query = q.trim().toLowerCase();
    if (!query) return;
    let found = null;
    for (const [key, data] of Object.entries(pixels)) {
      if (data?.state === "filled" && data?.name?.toLowerCase().includes(query)) {
        found = key; break;
      }
    }
    if (found) { setStatus("found");     onFound(found); }
    else        { setStatus("not_found"); onFound(null); }
    setTimeout(() => setStatus(null), 3500);
  };

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
      <div style={{ display:"flex", gap:8 }}>
        <div style={{ flex:1, position:"relative" }}>
          <span style={{ position:"absolute", left:12, top:"50%", transform:"translateY(-50%)", fontSize:12, color:"#00ffc844" }}>⌕</span>
          <input
            value={q}
            onChange={e => { setQ(e.target.value); setStatus(null); }}
            onKeyDown={e => e.key === "Enter" && search()}
            placeholder="Search contributor name..."
            style={{ width:"100%", padding:"9px 12px 9px 32px", borderRadius:9,
                     border:`1px solid rgba(0,255,200,${status==="found"?.55:status==="not_found"?.15:.12})`,
                     background:"rgba(0,255,200,0.025)", color:"#fff",
                     fontSize:11, fontFamily:"Sora,sans-serif", fontWeight:300,
                     outline:"none", letterSpacing:1, transition:"border .2s", boxSizing:"border-box" }}
          />
        </div>
        <motion.button
          whileHover={{ scale:1.04 }} whileTap={{ scale:.96 }}
          onClick={search}
          style={{ padding:"9px 18px", borderRadius:9, background:"rgba(0,255,200,0.08)",
                   border:"1px solid rgba(0,255,200,.22)", color:"#00ffc8",
                   fontSize:11, cursor:"pointer", fontFamily:"Sora,sans-serif",
                   letterSpacing:2, fontWeight:600, whiteSpace:"nowrap" }}
        >FIND</motion.button>
      </div>
      <AnimatePresence>
        {status === "found" && (
          <motion.div initial={{ opacity:0,y:-4 }} animate={{ opacity:1,y:0 }} exit={{ opacity:0 }}
            style={{ fontSize:10, color:"#00ffc8", letterSpacing:1, fontWeight:300 }}>
            ✦ LOCATED — scrolling to pixel ↓
          </motion.div>
        )}
        {status === "not_found" && (
          <motion.div initial={{ opacity:0,y:-4 }} animate={{ opacity:1,y:0 }} exit={{ opacity:0 }}
            style={{ fontSize:10, color:"#ff6b6b88", letterSpacing:1, fontWeight:300 }}>
            ✗ NOT FOUND IN MOSAIC
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   ROOT: App
   ───────────────────────────────────────────────────────────── */
export default function App() {
  // pixels: local state được sync từ Firestore realtime
  const [pixels,        setPixels]        = useState({});
  const [fbLoaded,      setFbLoaded]      = useState(false); // Firestore đã load lần đầu chưa
  const [modal,         setModal]         = useState(null);  // { row, col }
  const [revealActive,  setRevealActive]  = useState(false);
  const [highlightKey,  setHighlightKey]  = useState(null);
  const [newKey,        setNewKey]        = useState(null);  // key vừa upload xong
  const [scale,         setScale]         = useState(1);
  const prevFilledRef = useRef(0);

  // ── Inject CSS ──────────────────────────────────────────────
  useEffect(() => {
    const el = document.createElement("style");
    el.textContent = GLOBAL_CSS;
    document.head.appendChild(el);
    return () => document.head.removeChild(el);
  }, []);

  // ── Subscribe Firestore realtime ────────────────────────────
  useEffect(() => {
    const unsub = subscribeToPixels((firestoreMap) => {
      // Merge Firestore data vào toàn bộ active pixels
      setPixels(prev => {
        const merged = { ...prev };
        ACTIVE_COORDS.forEach(([r, c]) => {
          const key = `${r}-${c}`;
          const fsData = firestoreMap[key];
          if (fsData) {
            // Pixel đã có data từ Firestore → override (trừ state loading đang upload)
            if (merged[key]?.state !== "loading") {
              merged[key] = { state: "filled", ...fsData };
            }
          } else if (!merged[key]) {
            // Pixel chưa có gì cả → set empty
            merged[key] = { state: "empty" };
          }
        });
        return merged;
      });
      setFbLoaded(true);
    });
    return () => unsub();
  }, []);

  // ── 100% Digital Scanline Reveal ───────────────────────────
  const filled = Object.values(pixels).filter(p => p?.state === "filled").length;
  useEffect(() => {
    if (filled > 0 && filled === TOTAL && prevFilledRef.current < TOTAL) {
      setRevealActive(true);
      setTimeout(() => setRevealActive(false), 2400);
    }
    prevFilledRef.current = filled;
  }, [filled]);

  // ── Handle Upload → Storage → Firestore ────────────────────
  const handleConfirm = useCallback(async (dataURL, name, wish) => {
    const { row, col } = modal;
    const key = `${row}-${col}`;
    setModal(null);

    // 1. Set loading state với upload progress
    setPixels(p => ({ ...p, [key]: { state:"loading", uploadPct:0 } }));

    try {
      // 2. Upload ảnh lên Firebase Storage, theo dõi %
      const imageUrl = await uploadImageToStorage(key, dataURL, (pct) => {
        setPixels(p => ({ ...p, [key]: { state:"loading", uploadPct:pct } }));
      });

      // 3. Lưu metadata vào Firestore (sẽ trigger realtime cho tất cả client)
      await savePixelToFirestore(key, {
        state:    "filled",
        imageUrl,
        name,
        wish,
      });

      // 4. Hiệu ứng "pixel mới" trên client này
      setNewKey(key);
      setTimeout(() => setNewKey(null), 900);

    } catch (err) {
      console.error("Upload failed:", err);
      // Rollback về empty nếu lỗi
      setPixels(p => ({ ...p, [key]: { state:"empty" } }));
      alert(`Upload thất bại: ${err.message}`);
    }
  }, [modal]);

  const pct = TOTAL > 0 ? Math.round((filled / TOTAL) * 100) : 0;

  return (
    <div style={{ minHeight:"100vh", background:"#000", fontFamily:"Sora,sans-serif" }}>
      <Header filled={filled} total={TOTAL} />

      <main style={{ maxWidth:1100, margin:"0 auto", padding:"32px 20px 80px" }}>

        {/* Hero */}
        <motion.div initial={{ opacity:0,y:20 }} animate={{ opacity:1,y:0 }} transition={{ delay:.1 }}
          style={{ textAlign:"center", marginBottom:36 }}>
          <div style={{ fontSize:9, letterSpacing:4, color:"#00ffc855", fontWeight:300, marginBottom:10 }}>
            LIMITED EDITION · BIRTHDAY EDITION · 2025
          </div>
          <h1 style={{ fontSize:"clamp(24px,5vw,44px)", fontWeight:800, letterSpacing:-1, marginBottom:10, lineHeight:1.1 }}>
            {" "}
            <span style={{ background:"linear-gradient(90deg,#008a6c,#00ffc8)", WebkitBackgroundClip:"text", WebkitTextFillColor:"transparent" }}>
              Happy Birthday Mosaic
            </span>
          </h1>
          <p style={{ fontSize:12, color:"rgba(255,255,255,.33)", fontWeight:300, letterSpacing:1, maxWidth:420, margin:"0 auto" }}>
            Click any glowing pixel · upload your photo · power the moment together
          </p>
          {!fbLoaded && (
            <div style={{ marginTop:12, display:"flex", alignItems:"center", justifyContent:"center", gap:8 }}>
              <div className="spin" style={{ width:12, height:12, borderRadius:"50%", border:"2px solid transparent", borderTopColor:"#00ffc8" }} />
              <span style={{ fontSize:10, color:"#00ffc866", letterSpacing:2 }}>CONNECTING TO FIREBASE...</span>
            </div>
          )}
        </motion.div>

        {/* Controls */}
        <motion.div initial={{ opacity:0 }} animate={{ opacity:1 }} transition={{ delay:.2 }}
          style={{ display:"flex", flexWrap:"wrap", gap:12, marginBottom:24, alignItems:"center", justifyContent:"space-between" }}>
          {/* Zoom */}
          <div style={{ display:"flex", alignItems:"center", gap:8 }}>
            <span style={{ fontSize:9, letterSpacing:2, color:"#00ffc855", fontWeight:300 }}>ZOOM</span>
            <div style={{ display:"flex", gap:6 }}>
              {[["−",-.2],["+", .2]].map(([lbl, d]) => (
                <button key={lbl}
                  onClick={() => setScale(s => Math.min(2, Math.max(.4, +(s+d).toFixed(1))))}
                  style={{ width:30, height:30, borderRadius:6, background:"rgba(0,255,200,.05)", border:"1px solid rgba(0,255,200,.18)", color:"#00ffc8", fontSize:16, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center" }}>
                  {lbl}
                </button>
              ))}
              <button onClick={() => setScale(1)} style={{ padding:"0 10px", height:30, borderRadius:6, background:"transparent", border:"1px solid rgba(0,255,200,.1)", color:"#00ffc855", fontSize:9, cursor:"pointer", letterSpacing:2 }}>RESET</button>
            </div>
            <span style={{ fontSize:10, color:"#00ffc844", minWidth:34 }}>{Math.round(scale*100)}%</span>
          </div>
          {/* Stats */}
          <div style={{ display:"flex", gap:16 }}>
            {[["FILLED",filled],["EMPTY",TOTAL-filled],["TOTAL",TOTAL]].map(([lbl,val]) => (
              <div key={lbl} style={{ textAlign:"center" }}>
                <div style={{ fontSize:16, fontWeight:800, color: lbl==="FILLED"?"#00ffc8":"#ffffff44" }}>{val}</div>
                <div style={{ fontSize:8, letterSpacing:2, color:"#ffffff22", fontWeight:300 }}>{lbl}</div>
              </div>
            ))}
          </div>
        </motion.div>

        {/* Search */}
        <motion.div initial={{ opacity:0 }} animate={{ opacity:1 }} transition={{ delay:.28 }}
          style={{ maxWidth:380, marginBottom:28 }}>
          <SearchBar
            pixels={pixels}
            onFound={key => {
              setHighlightKey(key);
              if (key) setTimeout(() => setHighlightKey(null), 4200);
            }}
          />
        </motion.div>

        {/* Grid */}
        <div style={{ transform:`scale(${scale})`, transformOrigin:"top center", transition:"transform .3s ease" }}>
          <MosaicGrid
            pixels={pixels}
            onClickEmpty={(r, c) => {
              const key = `${r}-${c}`;
              if (pixels[key]?.state !== "filled" && pixels[key]?.state !== "loading") {
                setModal({ row:r, col:c });
              }
            }}
            revealActive={revealActive}
            highlightKey={highlightKey}
            newKey={newKey}
          />
        </div>

        {/* Legend */}
        <motion.div initial={{ opacity:0 }} animate={{ opacity:1 }} transition={{ delay:.5 }}
          style={{ display:"flex", flexWrap:"wrap", gap:20, justifyContent:"center", marginTop:32 }}>
          {[
            { sw:"rgba(0,255,200,0.06)", br:"1px solid rgba(0,255,200,.22)", label:"EMPTY — click to fill" },
            { sw:"linear-gradient(135deg,#008a6c,#00ffc8)",                  label:"FILLED — hover for info" },
            { sw:"#ffd70033", br:"2px solid #ffd700",                        label:"SEARCH RESULT" },
          ].map(({ sw, br, label }) => (
            <div key={label} style={{ display:"flex", alignItems:"center", gap:8 }}>
              <div style={{ width:14, height:14, borderRadius:3, background:sw, border:br, flexShrink:0 }} />
              <span style={{ fontSize:9, letterSpacing:2, color:"rgba(255,255,255,.3)", fontWeight:300 }}>{label}</span>
            </div>
          ))}
        </motion.div>

        {/* Firebase info strip */}
        <motion.div initial={{ opacity:0 }} animate={{ opacity:1 }} transition={{ delay:.7 }}
          style={{ marginTop:28, display:"flex", alignItems:"center", justifyContent:"center", gap:8, opacity:.4 }}>
          <div style={{ width:6, height:6, borderRadius:"50%", background:"#00ffc8" }} />
          <span style={{ fontSize:9, letterSpacing:2, color:"#00ffc8", fontWeight:300 }}>
            SYNCED VIA FIREBASE REALTIME · STORAGE + FIRESTORE
          </span>
          <div style={{ width:6, height:6, borderRadius:"50%", background:"#00ffc8" }} />
        </motion.div>

        {/* 100% Banner */}
        <AnimatePresence>
          {pct === 100 && (
            <motion.div
              initial={{ opacity:0,y:24 }} animate={{ opacity:1,y:0 }} exit={{ opacity:0 }}
              style={{ marginTop:32, textAlign:"center", padding:"28px 24px",
                       background:"rgba(0,255,200,0.04)", border:"1px solid rgba(0,255,200,.28)",
                       borderRadius:16, boxShadow:"0 0 80px rgba(0,255,200,0.1)" }}
            >
              <div style={{ fontSize:9, letterSpacing:4, color:"#00ffc8", fontWeight:300, marginBottom:10 }}>MOSAIC COMPLETE</div>
              <div style={{ fontSize:"clamp(22px,4vw,36px)", fontWeight:800,
                            background:"linear-gradient(90deg,#008a6c,#00ffc8,#ffffff)",
                            WebkitBackgroundClip:"text", WebkitTextFillColor:"transparent" }}>
                Happy Birthday OPPO 🎂
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Upload Modal */}
      <AnimatePresence>
        {modal && <UploadModal onClose={() => setModal(null)} onConfirm={handleConfirm} />}
      </AnimatePresence>
    </div>
  );
}
