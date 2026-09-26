// Calibrated building dimensions (metres). Each value names the frame or data
// it was calibrated from; README → "Calibration" repeats this table.
//
// Hotel position: the Salim Inn building is the three-bay block at the north
// end of the Farley NW block's west arm, facing WNW onto the guest car park.
// Its north end is the ring's NW corner (OSM way 269472228 vertex
// 2.26659 N, 111.86241 E); a covered walkway separates its south end from the
// rest of the arm. Established from OSM + two Street View panoramas (Mar 2026).
//
// Camera-matched calibration (milestone 2, perf/calib): a pinhole camera was
// solved by least squares against 15 facade points picked in rec2_t190s
// (window corners, pilasters, the fascia edge and both front columns). The
// solved camera is a plausible Street View rig (2.37 m high, 7.1 m out,
// pitched up 25.6°, 61.5° vertical FOV) with a 7.2 px mean reprojection
// error, and the vertical profile below fits to under 1 px. Horizontal scale
// from the same solve gives a 6.31 m bay — the 7.1 m of milestone 1 came from
// the coarser panorama triangulation and was wrong.

export const DIM = {
  groundFloor: 3.9, // rec2_t190s fit: L1 window head at 6.20 m (sub-pixel)
  upperFloor: 3.2, // rec2_t190s fit: L2 window head at 9.40 m, sill at 8.05 m
  parapet: 1.5, // roof slab 10.3 → parapet top 11.8 m (back-projected 11.7–11.9)
  capping: 1.45, // charcoal parapet band 10.35 → 11.8 m (luminance profiles across rec2_t190s)
  slab: 0.25,

  // Farley shophouse rows (all blocks share one 3-storey datum — V16 rule).
  bayWidth: 6.1, // 20 ft module, used where OSM gives no lot lines
  fiveFootWay: 2.4, // shopfront line 2.4 m behind the facade (rec2_t190s fit)
  canopyProjection: 1.8, // fascia face 1.8 m beyond the facade line (fit)
  canopyHeight: 3.6, // soffit 3.6 m (fit: shopfront/soffit junction at 3.52 m)

  // Salim Inn block (west arm, NW corner). Four lots, left to right from the
  // car park: the hotel's corner lot (solid tiled frontage), the hotel
  // entrance lot, and cafe.cafe's two lots — the southern one narrower, with
  // a single window group (pane count along the L2 band in rec2_t180s; the
  // rec2_t180s solve then fits at 3.2 px). Read facing outward from the
  // frontage this is V16's "cafe.cafe, cafe.cafe, Salim Inn (rightmost)".
  salim: {
    startAlong: 2.4, // corner end, measured from the OSM NW-corner vertex
    bays: 4,
    bayWidth: 6.3, // rec2_t190s solve: 6.31 m (≈ 20 ft 8 in)
    length: 22.47, // rec2_t180s solve (south end); satellite reference ≈ 22.5 m
    bayLines: [0, 6.3, 12.6, 18.9, 22.47],
    pilasters: [6.3, 12.6], // charcoal; the 18.9 lot line is a white pier
    depth: 18.5, // OSM outer → inner edge is 20.5 m at this end; rear service lane
    lobbyBay: 1, // the glazed entrance + SALIM INN letters are in the second lot (rec2_t190s)
    // Back-projected from the rec2_t190s camera onto the shopfront plane:
    entrance: { x0: 6.87, x1: 9.45, head: 2.69 }, // glazed door, 2.6 m wide
    wallLetters: { x0: 10.21, x1: 11.91, base: 2.44, cap: 0.26 },
    stonePanel: { x0: 1.2, x1: 3.3, top: 2.7 },
    glassBlocks: { x0: 1.4, x1: 2.56, y0: 2.86, y1: 3.27 }, // 6 × 2 standard 190 mm blocks
    cafeGlazingFrom: 12.37,
    // Louvred sign cabinet fixed flat on the charcoal parapet band, centred
    // on the second pilaster in both frames (t190s: 9.9–16.0, t180s: 9.4–15.2).
    roofSign: { x0: 9.6, x1: 15.7, y0: 10.4, y1: 11.95, face: 0.42 },
    // Condensed lettering on the fascia top: absent from rec2_t190s' frame edge
    // (so x ≥ 14.0) and ending at ≈ 19.7 m in rec2_t180s; x-height ≈ 1.1 m.
    cafeLetters: { x0: 14.0, x1: 19.7, size: 1.1 },
    // Window groups per lot, measured from the lot line (rec2_t190s solve for
    // lots 0–2: 2.72 m + 2.15 m; rec2_t180s solve for the south lot: 2.54 m).
    windowGroups: [[0.44, 3.16], [3.94, 6.09]],
    southLotGroups: [[0.49, 3.03]],
    dropOffCanopy: 4.2, // a thinner canopy runs past the corner end on two dark columns (rec2_t180s)
    walkwayGap: 6.5, // covered walkway to the next block (satellite: next roof starts ≈ 7 m on; rec2_t180s)
  },

  // Supermarket (Farley Sibu): taller single volume with green fin screen.
  supermarket: { height: 14.5, finDepth: 0.45 },

  // People / vehicles used as calibration references.
  eyeHeight: 1.6,
  door: 2.1,
  sedanRoof: 1.5,
  person: 1.65,
} as const;

export const FLOOR_Y = {
  ground: 0,
  level1: DIM.groundFloor,
  level2: DIM.groundFloor + DIM.upperFloor,
  roof: DIM.groundFloor + 2 * DIM.upperFloor,
  parapetTop: DIM.groundFloor + 2 * DIM.upperFloor + DIM.parapet,
} as const;
