(() => {
  const canvas = document.getElementById("ca");
  const ctx = canvas.getContext("2d");

  const toggleBtn = document.getElementById("toggle");
  const randomizeBtn = document.getElementById("randomize");
  const clearBtn = document.getElementById("clear");

  const scaleSlider = document.getElementById("scale");
  const speedSlider = document.getElementById("speed");
  const inertiaSlider = document.getElementById("inertia");
  const updateSlider = document.getElementById("update");
  const rSlider = document.getElementById("r");

  const scaleValue = document.getElementById("scaleValue");
  const speedValue = document.getElementById("speedValue");
  const inertiaValue = document.getElementById("inertiaValue");
  const updateValue = document.getElementById("updateValue");
  const rValue = document.getElementById("rValue");

  function updateLabels() {
    scaleValue.textContent = `×${scaleSlider.value}`;
    speedValue.textContent = speedSlider.value;
    inertiaValue.textContent = inertiaSlider.value;
    updateValue.textContent = updateSlider.value;
    rValue.textContent = rSlider.value;
  }

  [scaleSlider, speedSlider, inertiaSlider, updateSlider, rSlider].forEach(el => {
    el.addEventListener("input", () => {
      if (el === scaleSlider) {
        resizeGrid();
      }
      updateLabels();
    });
  });

  updateLabels();

  let cols = 0;
  let rows = 0;
  let grid = null;
  let next = null;

  function idx(x, y) {
    return y * cols + x;
  }

  // ---- 1/f ノイズ（Voss 風・時間方向） ----
  const PINK_SOURCES = 16;
  const pinkVals = new Float32Array(PINK_SOURCES);
  let pinkCounter = 0;
  for (let i = 0; i < PINK_SOURCES; i++) {
    pinkVals[i] = Math.random() * 2 - 1;
  }
  function nextPink() {
    pinkCounter++;
    let sum = 0;
    for (let i = 0; i < PINK_SOURCES; i++) {
      const mask = (1 << i) - 1;
      if ((pinkCounter & mask) === 0) {
        pinkVals[i] = Math.random() * 2 - 1;
      }
      sum += pinkVals[i];
    }
    return sum / PINK_SOURCES; // ≒ [-1,1]
  }

  // ---- レンマ辞書：patternId → lemma ----
  // lemma = {
  //   phase: number (0..LEMMA_PHASES-1),
  //   cycle: Int8Array(LEMMA_PHASES)  // 各段の ±1 補正
  //   rOffset: number                 // ロジスティック r の局所バイアス
  //   bias: number                    // 明るさバイアス（-1..1）
  //   useCount: number                // 使用回数
  //   flatScore: number               // 出力の単調さ指標（小さいほど単調）
  //   lastV: number                   // 最後に出力した値
  // }
  const LEMMA_PHASES = 3;
  const lemmaMap = new Map();
  let globalStep = 0;

  function makeRandomCycle() {
    const arr = new Int8Array(LEMMA_PHASES);
    for (let k = 0; k < LEMMA_PHASES; k++) {
      const r = Math.random();
      let delta;
      if (r < 0.25) delta = -1;
      else if (r < 0.75) delta = 0;
      else delta = 1;
      arr[k] = delta;
    }
    return arr;
  }

  function makeLemma() {
    return {
      phase: 0,
      cycle: makeRandomCycle(),
      rOffset: (Math.random() * 0.3) - 0.15,   // [-0.15, 0.15]
      bias: (Math.random() * 2 - 1) * 0.3,     // [-0.3, 0.3] 程度
      useCount: 0,
      flatScore: 1.0,
      lastV: (Math.random() * 4) | 0
    };
  }

  function getLemma(patternId) {
    let l = lemmaMap.get(patternId);
    if (!l) {
      l = makeLemma();
      lemmaMap.set(patternId, l);
    }
    return l;
  }

  function resizeGrid() {
    const scale = parseInt(scaleSlider.value, 10);
    cols = Math.floor(canvas.width / scale);
    rows = Math.floor(canvas.height / scale);
    const n = cols * rows;
    grid = new Uint8Array(n);
    next = new Uint8Array(n);
    randomizeGrid();
  }

  function randomizeGrid() {
    if (!grid) return;
    for (let i = 0; i < grid.length; i++) {
      const r = Math.random();
      if (r < 0.25) grid[i] = 0;
      else if (r < 0.5) grid[i] = 1;
      else if (r < 0.75) grid[i] = 2;
      else grid[i] = 3;
    }
  }

  function clearGrid() {
    if (!grid) return;
    grid.fill(0);
  }

  resizeGrid();

  const palette = new Uint8ClampedArray([
    0, 0, 0, 255,
    80, 80, 80, 255,
    170, 170, 170, 255,
    255, 255, 255, 255
  ]);

  function step() {
    if (!grid) return;
    globalStep++;

    const inertia = parseFloat(inertiaSlider.value);
    const baseR = parseFloat(rSlider.value);
    const updateProb = parseFloat(updateSlider.value);

    // グローバル 1/f ノイズ（r のゆっくり変動）
    const pink = nextPink();
    const globalPinkAmp = 0.05;
    const rGlobal = baseR + pink * globalPinkAmp;

    const total = cols * rows;
    let count0 = 0;
    let count1 = 0;
    let count2 = 0;
    let count3 = 0;

    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const i = idx(x, y);
        const oldV = grid[i];

        // --- 3×3 パターンID & 近傍平均 ---
        let patternId = 0;
        let sum = 0;
        for (let dy = -1; dy <= 1; dy++) {
          const yy = (y + dy + rows) % rows;
          for (let dx = -1; dx <= 1; dx++) {
            const xx = (x + dx + cols) % cols;
            const v = grid[idx(xx, yy)];
            sum += v;
            patternId = patternId * 4 + v; // base-4 符号化
          }
        }

        const lemma = getLemma(patternId);
        lemma.useCount++;

        // レンマ・ループ：phase を 1 つ進めて delta を取得
        const delta = lemma.cycle[lemma.phase];
        lemma.phase = (lemma.phase + 1) % LEMMA_PHASES;

        // 近傍平均（0〜3）
        const m = sum / 9;
        let u = m / 3;
        if (u < 0) u = 0;
        else if (u > 1) u = 1;

        // レンマ局所オフセット付きロジスティック r
        let rLocal = rGlobal + lemma.rOffset;
        if (rLocal < 3.0) rLocal = 3.0;
        if (rLocal > 4.0) rLocal = 4.0;

        // ロジスティック写像
        let uPrime = rLocal * u * (1 - u);
        if (uPrime < 0) uPrime = 0;
        else if (uPrime > 1) uPrime = 1;

        // lemma.bias も連続値に足し込む（弱く）
        uPrime += lemma.bias * 0.15;
        if (uPrime < 0) uPrime = 0;
        else if (uPrime > 1) uPrime = 1;

        let vBase = Math.floor(uPrime * 4);
        if (vBase < 0) vBase = 0;
        else if (vBase > 3) vBase = 3;

        // レンマによる ±1 修飾（delta）
        let vLemmaFloat = vBase + delta * 0.7;
        if (vLemmaFloat < 0) vLemmaFloat = 0;
        else if (vLemmaFloat > 3) vLemmaFloat = 3;
        let vLemma = Math.round(vLemmaFloat);

        // 慣性ブレンド
        let mixed = (1 - inertia) * oldV + inertia * vLemma;
        let vNew = Math.round(mixed);
        if (vNew < 0) vNew = 0;
        else if (vNew > 3) vNew = 3;

        // 部分更新
        if (Math.random() > updateProb) {
          vNew = oldV;
        }

        next[i] = vNew;

        // レンマの flatScore 更新（出力の「変化の多さ」）
        const diff = Math.abs(vNew - lemma.lastV);
        lemma.flatScore = lemma.flatScore * 0.9 + diff * 0.1;
        lemma.lastV = vNew;

        if (vNew === 0) count0++;
        else if (vNew === 1) count1++;
        else if (vNew === 2) count2++;
        else count3++;
      }
    }

    // --- レンマの「学習／変異」 ---
    // 長く使われていて flatScore が小さい（＝単調）なレンマは、
    // cycle と bias / rOffset を少しだけ変異させる。
    if (globalStep % 50 === 0) { // 毎 50 ステップごとに少しだけ評価
      const FLAT_THRESHOLD = 0.15;
      const USE_THRESHOLD = 100;
      for (const [patternId, lemma] of lemmaMap) {
        if (lemma.useCount > USE_THRESHOLD && lemma.flatScore < FLAT_THRESHOLD) {
          // cycle のうち 1 つだけランダムに変える
          const k = (Math.random() * LEMMA_PHASES) | 0;
          const r = Math.random();
          let delta;
          if (r < 0.3) delta = -1;
          else if (r < 0.7) delta = 0;
          else delta = 1;
          lemma.cycle[k] = delta;

          // bias と rOffset も少しだけランダムウォークさせる
          lemma.bias += (Math.random() * 2 - 1) * 0.05;
          if (lemma.bias < -0.6) lemma.bias = -0.6;
          if (lemma.bias > 0.6) lemma.bias = 0.6;

          lemma.rOffset += (Math.random() * 2 - 1) * 0.03;
          if (lemma.rOffset < -0.3) lemma.rOffset = -0.3;
          if (lemma.rOffset > 0.3) lemma.rOffset = 0.3;

          // flatScore をリセット気味にして、また様子を見る
          lemma.flatScore = 0.8;
          lemma.useCount = Math.floor(lemma.useCount * 0.5);
        }
      }
    }

    // --- スワップ ---
    const tmp = grid;
    grid = next;
    next = tmp;

    // --- 黒のリシード（場の死防止） ---
    const frac0 = count0 / total;
    if (frac0 < 0.02) {
      const reseedCount = Math.floor(total * 0.002);
      for (let k = 0; k < reseedCount; k++) {
        const j = (Math.random() * total) | 0;
        grid[j] = 0;
      }
    }
  }

  function draw() {
    if (!grid) return;
    const scale = parseInt(scaleSlider.value, 10);
    const img = ctx.createImageData(cols * scale, rows * scale);
    const data = img.data;

    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const v = grid[idx(x, y)];
        const pr = palette[v * 4];
        const pg = palette[v * 4 + 1];
        const pb = palette[v * 4 + 2];
        const pa = palette[v * 4 + 3];

        for (let yy = 0; yy < scale; yy++) {
          const py = y * scale + yy;
          for (let xx = 0; xx < scale; xx++) {
            const px = x * scale + xx;
            const di = (py * cols * scale + px) * 4;
            data[di] = pr;
            data[di + 1] = pg;
            data[di + 2] = pb;
            data[di + 3] = pa;
          }
        }
      }
    }

    ctx.putImageData(img, 0, 0);
  }

  let running = true;
  let lastTime = performance.now();
  let acc = 0;

  function loop(now) {
    const dt = (now - lastTime) / 1000;
    lastTime = now;
    const stepsPerSec = parseInt(speedSlider.value, 10);
    const stepDt = 1 / Math.max(1, stepsPerSec);
    if (running) {
      acc += dt;
      const maxSteps = 5;
      let steps = 0;
      while (acc >= stepDt && steps < maxSteps) {
        step();
        acc -= stepDt;
        steps++;
      }
    } else {
      acc = 0;
    }

    draw();
    requestAnimationFrame(loop);
  }

  requestAnimationFrame(loop);

  toggleBtn.addEventListener("click", () => {
    running = !running;
    toggleBtn.textContent = running ? "⏸ 停止" : "▶ 再生";
    if (running) {
      lastTime = performance.now();
    }
  });

  randomizeBtn.addEventListener("click", () => {
    randomizeGrid();
  });

  clearBtn.addEventListener("click", () => {
    clearGrid();
  });

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("sw.js").catch(() => {});
    });
  }
})();