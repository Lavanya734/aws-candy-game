(() => {
    const ROWS = 9;
    const COLS = 9;
    const GAME_SECONDS = 120;
    const TICK_MS = 90;          // speed of falling / crushing animation
    const POINTS_PER_CANDY = 10; // a match of 3 = 30 points, like the original

    const CANDIES = ["rds", "lake", "ec2", "s3", "event", "cloud9"];
    const MESSAGES = {
        rds: "Aurora DB service crushed!",
        lake: "Lake Formation service crushed!",
        ec2: "EC2 service crushed!",
        s3: "S3 service crushed!",
        event: "EventBridge service crushed!",
        cloud9: "Cloud9 IDE service crushed!"
    };

    const boardEl = document.getElementById("board");
    const matchFx = document.getElementById("matchFx");
    const scoreEl = document.getElementById("score");
    const timerEl = document.getElementById("timer");
    const commentsEl = document.getElementById("comments");
    const crushSound = document.getElementById("crushSound");
    const gameOverEl = document.getElementById("gameOver");
    const finalScoreEl = document.getElementById("finalScore");
    const movesEl = document.getElementById("moves");
    const bestScoreEl = document.getElementById("bestScore");
    const finalBestScoreEl = document.getElementById("finalBestScore");
    const playAgainBtn = document.getElementById("playAgain");

    let grid = [];   // grid[r][c] = candy name, or null while empty
    let tiles = [];  // tiles[r][c] = <img> element
    let score = 0;
    let moves = 0;
    let bestScore = readBestScore();
    let timeLeft = GAME_SECONDS;
    let running = false;
    let settled = true;  // true when nothing is falling or waiting to be crushed
    let busy = false;    // true during the "invalid move" bounce-back
    let selected = null; // tile chosen by tapping
    let drag = null;     // current pointer gesture
    let tickId = null;
    let clockId = null;
    let commentTimeout = null;
    let processingMatches = false;

    const randomCandy = () => CANDIES[Math.floor(Math.random() * CANDIES.length)];

    function readBestScore() {
        try { return Number(localStorage.getItem("awsCandyCrushBest") || 0); }
        catch (error) { return 0; }
    }

    function saveBestScore() {
        if (score > bestScore) {
            bestScore = score;
            try { localStorage.setItem("awsCandyCrushBest", String(bestScore)); }
            catch (error) { /* storage can be unavailable in private browsing */ }
        }
    }

    /* ---------- setup ---------- */

    function createTiles() {
        for (let r = 0; r < ROWS; r++) {
            tiles.push([]);
            for (let c = 0; c < COLS; c++) {
                const img = document.createElement("img");
                img.draggable = false;
                img.alt = "";
                img.dataset.r = r;
                img.dataset.c = c;
                boardEl.append(img);
                tiles[r].push(img);
            }
        }
    }

    function fillBoardWithoutMatches() {
        grid = [];
        for (let r = 0; r < ROWS; r++) {
            grid.push([]);
            for (let c = 0; c < COLS; c++) {
                let type;
                do {
                    type = randomCandy();
                } while (
                    (c >= 2 && grid[r][c - 1] === type && grid[r][c - 2] === type) ||
                    (r >= 2 && grid[r - 1][c] === type && grid[r - 2][c] === type)
                );
                grid[r].push(type);
            }
        }
    }

    function newGame() {
        clearInterval(tickId);
        clearInterval(clockId);
        fillBoardWithoutMatches();
        score = 0;
        moves = 0;
        timeLeft = GAME_SECONDS;
        running = true;
        settled = true;
        busy = false;
        processingMatches = false;
        matchFx.innerHTML = "";
        selected = null;
        drag = null;
        gameOverEl.hidden = true;
        showComment("Make your first match!");
        updateHud();
        render();
        tickId = setInterval(tick, TICK_MS);
        clockId = setInterval(clockTick, 1000);
    }

    function endGame() {
        running = false;
        clearInterval(tickId);
        clearInterval(clockId);
        saveBestScore();
        finalScoreEl.textContent = score;
        finalBestScoreEl.textContent = bestScore;
        bestScoreEl.textContent = bestScore;
        gameOverEl.hidden = false;
    }

    /* ---------- drawing ---------- */

    function render() {
        for (let r = 0; r < ROWS; r++) {
            for (let c = 0; c < COLS; c++) {
                const img = tiles[r][c];
                const type = grid[r][c];
                if ((img.dataset.type || "") !== (type || "")) {
                    img.dataset.type = type || "";
                    if (type) img.src = `./images/${type}.png`;
                }
                img.classList.toggle("empty", !type);
                img.classList.toggle("selected", !!selected && selected.r === r && selected.c === c);
            }
        }
    }

    function updateHud() {
        scoreEl.textContent = score;
        movesEl.textContent = moves;
        bestScoreEl.textContent = bestScore;
        const m = Math.floor(timeLeft / 60);
        const s = String(timeLeft % 60).padStart(2, "0");
        timerEl.textContent = `${m}:${s}`;
    }

    function showComment(text) {
        clearTimeout(commentTimeout);
        commentsEl.textContent = text;
        commentsEl.classList.toggle("show", !!text);
        if (text) {
            commentTimeout = setTimeout(() => commentsEl.classList.remove("show"), 1500);
        }
    }

    function playCrushSound() {
        try {
            crushSound.currentTime = 0;
            const p = crushSound.play();
            if (p && p.catch) p.catch(() => {}); // browsers may block audio until the player interacts
        } catch (e) { /* ignore */ }
    }

    /* ---------- game rules ---------- */

    // length of the same-candy run through (r, c) along one direction
    function runLength(r, c, dr, dc) {
        const type = grid[r][c];
        if (!type) return 0;
        let n = 1;
        for (let i = 1; ; i++) {
            const rr = r + dr * i, cc = c + dc * i;
            if (rr < 0 || rr >= ROWS || cc < 0 || cc >= COLS || grid[rr][cc] !== type) break;
            n++;
        }
        for (let i = 1; ; i++) {
            const rr = r - dr * i, cc = c - dc * i;
            if (rr < 0 || rr >= ROWS || cc < 0 || cc >= COLS || grid[rr][cc] !== type) break;
            n++;
        }
        return n;
    }

    function makesMatchAt(r, c) {
        return runLength(r, c, 0, 1) >= 3 || runLength(r, c, 1, 0) >= 3;
    }

    function findMatches() {
        const found = new Set();
        for (let r = 0; r < ROWS; r++) {
            for (let c = 0; c < COLS; c++) {
                if (grid[r][c] && makesMatchAt(r, c)) found.add(r * COLS + c);
            }
        }
        return found;
    }

    function animateMatches(indices) {
        const boardRect = boardEl.getBoundingClientRect();
        const points = indices.map(i => {
            const r = Math.floor(i / COLS), c = i % COLS;
            const rect = tiles[r][c].getBoundingClientRect();
            tiles[r][c].classList.add("matching");
            return { r, c, x: rect.left - boardRect.left + rect.width / 2, y: rect.top - boardRect.top + rect.height / 2 };
        });
        matchFx.style.left = `${boardEl.offsetLeft}px`;
        matchFx.style.top = `${boardEl.offsetTop}px`;
        matchFx.style.width = `${boardEl.clientWidth}px`;
        matchFx.style.height = `${boardEl.clientHeight}px`;
        matchFx.setAttribute("viewBox", `0 0 ${boardRect.width} ${boardRect.height}`);
        matchFx.innerHTML = "";
        const groups = [];
        const remaining = new Set(points.map(p => `${p.r},${p.c}`));
        while (remaining.size) {
            const seed = remaining.values().next().value;
            const [sr, sc] = seed.split(",").map(Number);
            const group = [];
            const queue = [[sr, sc]];
            remaining.delete(seed);
            while (queue.length) {
                const [r, c] = queue.shift();
                const point = points.find(p => p.r === r && p.c === c);
                if (point) group.push(point);
                for (const [nr, nc] of [[r-1,c],[r+1,c],[r,c-1],[r,c+1]]) {
                    const key = `${nr},${nc}`;
                    if (remaining.has(key)) { remaining.delete(key); queue.push([nr,nc]); }
                }
            }
            if (group.length >= 2) groups.push(group);
        }
        const ns = "http://www.w3.org/2000/svg";
        groups.forEach(group => {
            group.sort((a,b) => a.r === b.r ? a.c-b.c : a.r-b.r);
            const path = document.createElementNS(ns,"path");
            path.setAttribute("class","match-line");
            path.setAttribute("d", group.map((pt,i) => `${i ? "L" : "M"} ${pt.x} ${pt.y}`).join(" "));
            const length = group.reduce((sum,pt,i) => i ? sum + Math.hypot(pt.x-group[i-1].x,pt.y-group[i-1].y) : sum,0);
            path.style.strokeDasharray = String(length);
            path.style.strokeDashoffset = String(length);
            matchFx.append(path);
        });
        points.forEach(pt => {
            const spark = document.createElementNS(ns,"circle");
            spark.setAttribute("class","match-spark"); spark.setAttribute("cx",pt.x); spark.setAttribute("cy",pt.y); spark.setAttribute("r","5");
            matchFx.append(spark);
        });
    }

    function hasEmpty() {
        return grid.some(row => row.some(cell => cell === null));
    }

    // one animation step: fall one row, or crush whatever matches
    function tick() {
        if (!running || processingMatches) return;

        if (hasEmpty()) {
            for (let c = 0; c < COLS; c++) {
                for (let r = ROWS - 2; r >= 0; r--) {
                    if (grid[r][c] && !grid[r + 1][c]) {
                        grid[r + 1][c] = grid[r][c];
                        grid[r][c] = null;
                    }
                }
                if (!grid[0][c]) grid[0][c] = randomCandy();
            }
            settled = false;
            render();
            return;
        }

        const matches = findMatches();
        if (matches.size) {
            if (processingMatches) return;
            processingMatches = true;
            const firstIndex = matches.values().next().value;
            const type = grid[Math.floor(firstIndex / COLS)][firstIndex % COLS];
            const indices = [...matches];
            animateMatches(indices);
            score += matches.size * POINTS_PER_CANDY;
            saveBestScore();
            showComment(MESSAGES[type] || "Service crushed!");
            playCrushSound();
            updateHud();
            setTimeout(() => {
                indices.forEach(i => {
                    const r = Math.floor(i / COLS), c = i % COLS;
                    grid[r][c] = null;
                    tiles[r][c].classList.remove("matching");
                });
                matchFx.innerHTML = "";
                processingMatches = false;
                settled = false;
                render();
            }, 330);
            return;
        }

        settled = true;
    }

    function clockTick() {
        if (!running) return;
        timeLeft--;
        updateHud();
        if (timeLeft <= 0) endGame();
    }

    function trySwap(r1, c1, r2, c2) {
        if (!running || !settled || busy) return;
        if (r2 < 0 || r2 >= ROWS || c2 < 0 || c2 >= COLS) return;
        if (Math.abs(r1 - r2) + Math.abs(c1 - c2) !== 1) return;
        if (!grid[r1][c1] || !grid[r2][c2]) return;

        const swap = () => {
            const tmp = grid[r1][c1];
            grid[r1][c1] = grid[r2][c2];
            grid[r2][c2] = tmp;
        };

        swap();
        moves++;
        updateHud();
        if (makesMatchAt(r1, c1) || makesMatchAt(r2, c2)) {
            settled = false; // tick() will now crush and refill
            render();
            const a = tiles[r1][c1], b = tiles[r2][c2];
            a.classList.add("swap-moving");
            b.classList.add("swap-moving");
            a.style.transform = `translate(${(c2 - c1) * 100}%, ${(r2 - r1) * 100}%)`;
            b.style.transform = `translate(${(c1 - c2) * 100}%, ${(r1 - r2) * 100}%)`;
            requestAnimationFrame(() => {
                a.style.transform = "";
                b.style.transform = "";
                setTimeout(() => {
                    a.classList.remove("swap-moving");
                    b.classList.remove("swap-moving");
                }, 160);
            });
        } else {
            // Briefly show the attempted swap, then return both services.
            render();
            busy = true;
            const a = tiles[r1][c1], b = tiles[r2][c2];
            a.classList.add("invalid-swap");
            b.classList.add("invalid-swap");
            setTimeout(() => {
                swap();
                busy = false;
                a.classList.remove("invalid-swap");
                b.classList.remove("invalid-swap");
                render();
            }, 190);
        }
    }

    /* ---------- input (mouse, touch and pen all go through pointer events) ---------- */

    function handleTap(r, c) {
        if (!running || !settled || busy) return;
        if (!selected) {
            selected = { r, c };
        } else if (selected.r === r && selected.c === c) {
            selected = null;
        } else if (Math.abs(selected.r - r) + Math.abs(selected.c - c) === 1) {
            const s = selected;
            selected = null;
            trySwap(s.r, s.c, r, c);
        } else {
            selected = { r, c };
        }
        render();
    }

    boardEl.addEventListener("pointerdown", e => {
        const img = e.target.closest("img");
        if (!img) return;
        e.preventDefault();
        try { boardEl.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
        drag = {
            r: Number(img.dataset.r),
            c: Number(img.dataset.c),
            x: e.clientX,
            y: e.clientY,
            id: e.pointerId,
            swiped: false
        };
    });

    boardEl.addEventListener("pointermove", e => {
        if (!drag || drag.swiped || e.pointerId !== drag.id) return;
        const dx = e.clientX - drag.x;
        const dy = e.clientY - drag.y;
        const threshold = Math.max(10, (boardEl.clientWidth / COLS) * 0.24);
        if (Math.max(Math.abs(dx), Math.abs(dy)) < threshold) return;

        drag.swiped = true;
        let r2 = drag.r, c2 = drag.c;
        if (Math.abs(dx) > Math.abs(dy)) c2 += dx > 0 ? 1 : -1;
        else r2 += dy > 0 ? 1 : -1;
        selected = null;
        render();
        trySwap(drag.r, drag.c, r2, c2);
    });

    boardEl.addEventListener("pointerup", e => {
        if (!drag || e.pointerId !== drag.id) return;
        if (!drag.swiped) handleTap(drag.r, drag.c); // a tap or click without movement
        drag = null;
    });

    boardEl.addEventListener("pointercancel", () => { drag = null; });

    playAgainBtn.addEventListener("click", newGame);

    createTiles();
    newGame();
})();
