// A small, browser-viewable outer-totalistic cellular automaton (default
// B3/S23, Conway's Game of Life). This is a straight JavaScript port of the
// original Python model: LifeGrid holds one immutable generation, and
// SimulationState is the mutable bookkeeping (history and current rule) on top.

// Coordinates use (column, row), while the nested array is indexed as [row][column].
// The board is always square. WIDTH and HEIGHT track the current side length and
// change together whenever the user picks a new size; grids read them at call
// time, so a new size takes effect once the board is rebuilt.
const DEFAULT_SIZE = 27;
const MIN_SIZE = 1;
const MAX_SIZE = 100;
let WIDTH = DEFAULT_SIZE;
let HEIGHT = DEFAULT_SIZE;
const BIRTH_COUNTS = [3];
const SURVIVAL_COUNTS = [2, 3];
const MUTATION_PROBABILITY = 0;

// A generation of cells as a HEIGHT-by-WIDTH grid of booleans. Each method
// returns a new grid rather than mutating this one, so a stored generation can
// never be changed while the next one is being calculated.
class LifeGrid {
  constructor(cells) {
    this.cells = cells;
  }

  // Build a grid from zero-indexed (column, row) live-cell positions.
  static fromAliveCells(aliveCells) {
    const cells = Array.from({ length: HEIGHT }, () =>
      new Array(WIDTH).fill(false),
    );
    for (const [column, row] of aliveCells) {
      if (column >= 0 && column < WIDTH && row >= 0 && row < HEIGHT) {
        cells[row][column] = true;
      }
    }
    return new LifeGrid(cells);
  }

  // Count live Moore-neighbours; cells beyond an edge are treated as dead
  // rather than wrapping the grid around like a torus.
  livingNeighbours(column, row) {
    let count = 0;
    for (let r = Math.max(0, row - 1); r < Math.min(HEIGHT, row + 2); r++) {
      for (
        let c = Math.max(0, column - 1);
        c < Math.min(WIDTH, column + 2);
        c++
      ) {
        if ((c !== column || r !== row) && this.cells[r][c]) count++;
      }
    }
    return count;
  }

  // Advance one generation under the given outer-totalistic rule. Every
  // decision reads the current grid before any cell changes, so all cells in a
  // generation change simultaneously.
  step(birthCounts, survivalCounts) {
    const nextAlive = [];
    for (let row = 0; row < HEIGHT; row++) {
      for (let column = 0; column < WIDTH; column++) {
        const neighbours = this.livingNeighbours(column, row);
        const alive = this.cells[row][column];
        if (
          (!alive && birthCounts.includes(neighbours)) ||
          (alive && survivalCounts.includes(neighbours))
        ) {
          nextAlive.push([column, row]);
        }
      }
    }
    return LifeGrid.fromAliveCells(nextAlive);
  }

  // Randomly flip cells independently of the step rules: 0 leaves every cell
  // as-is, 1 flips every cell, values in between flip roughly that fraction.
  mutate(probability) {
    const nextAlive = [];
    for (let row = 0; row < HEIGHT; row++) {
      for (let column = 0; column < WIDTH; column++) {
        if (this.cells[row][column] !== Math.random() < probability) {
          nextAlive.push([column, row]);
        }
      }
    }
    return LifeGrid.fromAliveCells(nextAlive);
  }

  // Cells as a JSON-friendly 0 (dead) / 1 (alive) grid.
  asNumbers() {
    return this.cells.map((row) => row.map((alive) => (alive ? 1 : 0)));
  }
}

// In-memory session state for a single interactive board.
class SimulationState {
  constructor() {
    this.birthCounts = new Set(BIRTH_COUNTS);
    this.survivalCounts = new Set(SURVIVAL_COUNTS);
    this.mutationProbability = MUTATION_PROBABILITY;
    this.history = [LifeGrid.fromAliveCells([])];
    this.genIndex = 0;
  }

  get grid() {
    return this.history[this.genIndex];
  }

  // Blank the board and return to step 0, keeping the current rule.
  reset() {
    this.history = [LifeGrid.fromAliveCells([])];
    this.genIndex = 0;
  }

  stepForward() {
    // Reuse an already-computed future state (e.g. after stepping back) rather
    // than recomputing it, so redo after undo is instant.
    if (this.genIndex + 1 < this.history.length) {
      this.genIndex += 1;
      return;
    }
    const nextGrid = this.grid
      .step([...this.birthCounts], [...this.survivalCounts])
      .mutate(this.mutationProbability);
    this.history.push(nextGrid);
    this.genIndex += 1;
  }

  stepBack() {
    if (this.genIndex > 0) this.genIndex -= 1;
  }

  toggle(column, row) {
    if (column < 0 || column >= WIDTH || row < 0 || row >= HEIGHT) return;
    const cells = this.grid.cells.map((r) => [...r]);
    cells[row][column] = !cells[row][column];
    // Editing invalidates any redo states, matching a fresh branch in history.
    this.history = this.history.slice(0, this.genIndex + 1);
    this.history[this.genIndex] = new LifeGrid(cells);
  }

  randomize(density = Math.random()) {
    // A fixed density clusters the live-cell count tightly around its expected
    // value (729 cells barely deviate from the binomial mean). Randomizing the
    // density itself spreads results across the full range, from nearly empty
    // to nearly full boards.
    const alive = [];
    for (let row = 0; row < HEIGHT; row++) {
      for (let column = 0; column < WIDTH; column++) {
        if (Math.random() < density) alive.push([column, row]);
      }
    }
    this.history = [LifeGrid.fromAliveCells(alive)];
    this.genIndex = 0;
  }

  setRule(birth, survival) {
    this.birthCounts = new Set(birth.filter((n) => n >= 0 && n <= 8));
    this.survivalCounts = new Set(survival.filter((n) => n >= 0 && n <= 8));
  }

  setMutationProbability(probability) {
    this.mutationProbability = Math.min(1, Math.max(0, probability));
  }

  // Change the (square) board side length, clearing the board to the new size.
  setSize(size) {
    WIDTH = size;
    HEIGHT = size;
    this.reset();
  }

  asJson() {
    const cells = this.grid.asNumbers();
    return {
      cells,
      generation: this.genIndex,
      livingCells: cells.reduce(
        (sum, row) => sum + row.reduce((a, b) => a + b, 0),
        0,
      ),
      birth: [...this.birthCounts].sort((a, b) => a - b),
      survival: [...this.survivalCounts].sort((a, b) => a - b),
      mutationProbability: this.mutationProbability,
      width: WIDTH,
      height: HEIGHT,
    };
  }
}

// --- UI wiring -------------------------------------------------------------

const grid = document.querySelector("#grid");
const status = document.querySelector("#status");
const mutationSlider = document.querySelector("#mutation-probability");
const mutationValue = document.querySelector("#mutation-value");
const sizeInput = document.querySelector("#board-size");
const randomBirthButton = document.querySelector("#random-birth");
const randomSurvivalButton = document.querySelector("#random-survival");
const playButton = document.querySelector("#play");
const playIcon = playButton.innerHTML;
const pauseIcon =
  '<svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>';
const controlButtons = [...document.querySelectorAll("#controls button")];

const state = new SimulationState();
let timer = null;
let applyingRemoteRule = false; // true while syncing controls from state

function buildRuleCheckboxes(rowId, prefix) {
  const row = document.querySelector(rowId);
  for (let n = 0; n <= 8; n++) {
    const label = document.createElement("label");
    const box = document.createElement("input");
    box.type = "checkbox";
    box.id = `${prefix}-${n}`;
    box.onchange = onRuleCheckboxChange;
    label.append(box, document.createTextNode(String(n)));
    row.appendChild(label);
  }
}

function onRuleCheckboxChange() {
  if (applyingRemoteRule) return;
  const checkedCounts = (prefix) =>
    [...document.querySelectorAll(`[id^="${prefix}-"]`)]
      .filter((b) => b.checked)
      .map((b) => Number(b.id.split("-")[1]));
  state.setRule(checkedCounts("birth"), checkedCounts("survival"));
  render();
}

function syncRuleCheckboxes(birth, survival) {
  applyingRemoteRule = true;
  for (let n = 0; n <= 8; n++) {
    document.querySelector(`#birth-${n}`).checked = birth.includes(n);
    document.querySelector(`#survival-${n}`).checked = survival.includes(n);
  }
  applyingRemoteRule = false;
}

function syncMutationSlider(probability) {
  applyingRemoteRule = true;
  mutationSlider.value = probability;
  mutationValue.textContent = `${Math.round(probability * 100)}%`;
  applyingRemoteRule = false;
}

function render() {
  const view = state.asJson();
  grid.replaceChildren(
    ...view.cells.flatMap((row, y) =>
      row.map((alive, x) => {
        const cell = document.createElement("button");
        cell.className = `cell${alive ? " alive" : ""}`;
        cell.setAttribute(
          "aria-label",
          `Column ${x + 1}, row ${y + 1}: ${alive ? "alive" : "dead"}`,
        );
        cell.onclick = () => {
          stop();
          state.toggle(x, y);
          render();
        };
        return cell;
      }),
    ),
  );
  status.textContent = `step: ${view.generation} · living cells: ${view.livingCells}`;
  syncRuleCheckboxes(view.birth, view.survival);
  syncMutationSlider(view.mutationProbability);
}

function stop() {
  clearInterval(timer);
  timer = null;
  playButton.innerHTML = playIcon;
  playButton.title = "Play";
  playButton.setAttribute("aria-label", "Play");
}

function stepForward() {
  state.stepForward();
  render();
}

mutationSlider.oninput = () => {
  if (applyingRemoteRule) return;
  const probability = Number(mutationSlider.value);
  mutationValue.textContent = `${Math.round(probability * 100)}%`;
  state.setMutationProbability(probability);
  render();
};

// Match the CSS grid track count to the board's side length.
function layoutGrid() {
  grid.style.gridTemplateColumns = `repeat(${WIDTH}, 1fr)`;
}

sizeInput.oninput = () => {
  // Only whole numbers within range are valid; anything else leaves the board
  // untouched and waits for a usable value.
  const size = Number(sizeInput.value);
  if (!Number.isInteger(size) || size < MIN_SIZE || size > MAX_SIZE) return;
  stop();
  state.setSize(size);
  layoutGrid();
  render();
};

// Snap a partial or out-of-range entry back to the board's current size once
// the field loses focus, so the input never disagrees with what's on screen.
sizeInput.onchange = () => {
  const size = Number(sizeInput.value);
  if (!Number.isInteger(size) || size < MIN_SIZE || size > MAX_SIZE) {
    sizeInput.value = String(WIDTH);
  }
};

// Flip an independent coin for each of the nine neighbour counts, giving a
// random set of Birth or Survival counts (one of 2^9 possibilities per row).
function randomCounts() {
  return Array.from({ length: 9 }, (_, n) => n).filter(() => Math.random() < 0.5);
}

randomBirthButton.onclick = () => {
  state.setRule(randomCounts(), [...state.survivalCounts]);
  render();
};
randomSurvivalButton.onclick = () => {
  state.setRule([...state.birthCounts], randomCounts());
  render();
};

document.querySelector("#step-forward").onclick = () => {
  stop();
  stepForward();
};
document.querySelector("#step-back").onclick = () => {
  stop();
  state.stepBack();
  render();
};
playButton.onclick = () => {
  if (timer) return stop();
  timer = setInterval(stepForward, 450);
  playButton.innerHTML = pauseIcon;
  playButton.title = "Pause";
  playButton.setAttribute("aria-label", "Pause");
};
document.querySelector("#random").onclick = () => {
  stop();
  state.randomize();
  render();
};
document.querySelector("#reset").onclick = () => {
  stop();
  state.reset();
  render();
};

buildRuleCheckboxes("#birth-row", "birth");
buildRuleCheckboxes("#survival-row", "survival");
// The buttons live in the markup before the checkboxes are generated; move each
// to the end of its row so it sits after the counts it randomizes.
document.querySelector("#birth-row").appendChild(randomBirthButton);
document.querySelector("#survival-row").appendChild(randomSurvivalButton);
controlButtons.forEach((b) => (b.disabled = false));
layoutGrid();
render();
