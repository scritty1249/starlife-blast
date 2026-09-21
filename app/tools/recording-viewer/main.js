import { Color } from "/src/engine/core/math/Color.js";
import { Vector } from "/src/engine/core/math/Vector.js";
import { TurnRecorder } from "/src/engine/runtime/utils/TurnRecorder.js";
import { Canvas2DContextCursor } from "/src/engine/core/controller/display/Canvas2DContextCursor.js";
import { checkCanvasBlurSupport } from "/src/engine/runtime/utils.js";
import { drawLine, drawCircle } from "/src/engine/runtime/debug/draw.js";
import { Random } from "/src/engine/core/math/Random.js";
import { HitpointMap } from "/src/engine/hitpoints/Core.js";

Object.defineProperty(window, "__CANVAS_BLUR_SUPPORTED", {
    value: checkCanvasBlurSupport(),
    writable: false,
    configurable: false,
    enumerable: true
});
const randomSeed = Random.seedString("SEED");
const canvas = document.getElementById("render");
const cursor = new Canvas2DContextCursor(canvas);
const container = document.getElementById("viewer");
const legend = document.querySelector("#legend > ul.legend-list.players");
const nextButton = document.getElementById("next");
const prevButton = document.getElementById("prev");
const resetButton = document.getElementById("reset");
const viewerEls = {
    header: container.querySelector(":scope > .info-card.state > .title"),
    text: container.querySelector(":scope > .info-card.state > .content"),
    players: document.getElementById("player-health")
};
const terrainOptions = {
    edgeColor: new Color("#00e8f0"),
    fillColor: new Color("#0098eb"),
};
const symbolColors = {
    NORMAL: new Color(255, 0, 0, .45),
    REBOUND: new Color(0, 255, 0, .45),
    DIRECTION: new Color(0, 0, 255, .45),
    BLAST: new Color(255, 165, 0, .65),
    "OLD BLAST": new Color(255, 165, 0, .25)
};
const states = [];
let playerInfoEls;
let playerColors;
let random;
let recording;
let index = 0;

{
    viewerEls.text.innerText = "No data loaded.";
    const symbolsLegend = document.querySelector("#legend > ul.legend-list.symbols");
    for (const [id, color] of Object.entries(symbolColors)) {
        const item = document.createElement("li");
        const key = document.createElement("span");
        const value = createDotElement(color);
        key.classList.add("key");
        key.innerText = id;
        value.classList.add("value");
        item.append(key);
        item.append(value);
        symbolsLegend.append(item);
    }
}

document.getElementById("upload").addEventListener("change", async function (event) {
    index = 0;
    try {
        const file = event.target.files[0];
        if (!file) return;
        const filename = file.name.substring(0, file.name.lastIndexOf("."));
        const buffer = await file.arrayBuffer();
        recording = TurnRecorder.process(buffer).recording;
        console.log(filename, recording);

        playerColors = {};
        random = new Random(randomSeed);
        for (const id of Object.keys(recording.start.actors)) {
            const hue = Math.floor(random.random() * 360);
            playerColors[id] = new Color(...hsl2rgb(hue, .8, .85));
        }
        fillLegend();
        fillStates();
        fillPlayerCards();
        console.log(states);
        drawFrame();
        container.classList.remove("empty");
    } catch (error) {
        console.error(error);
        container.classList.add("empty");
        viewerEls.header.innerText = "";
        viewerEls.text.innerText = "No data loaded.";
    }
});

nextButton.onclick = () => {
    index = ((index + 1) % recording.length);
    drawFrame();
};

prevButton.onclick = () => {
    index = ((index - 1) % recording.length);
    drawFrame();
};

resetButton.onclick = () => {
    index = 0;
    drawFrame();
};

function getUnit () {
    return cursor.planeSize.max() / 135;
}

function drawFrame () {
    const { time, actors, collisions, actorsChanged, terrainChanged } = states.at(index);
    drawTerrain();
    drawActors();
    drawOldBlasts();
    drawBlasts();
    drawCollisions();

    viewerEls.header.innerText = `State: ${index + 1} of ${recording.length}`;
    if (time) viewerEls.header.innerText += ` (${time.toFixed(2)}s)`;
    let content = "";
    if (terrainChanged) {
        content += "terrain";
    }
    if (collisions.length) {
        if (content.length) content += ", ";
        content += "collision";
    }
    if (actorsChanged.length) {
        if (content.length) content += ", ";
        content += actorsChanged.map((id) => createDotElement(playerColors[id]).outerHTML).join(", ");
    }
    if (content.length) {
        content += " updated";
    }
    viewerEls.text.innerHTML = content;
    for (const [id, actor] of Object.entries(actors)) {
        populatePlayerHealthEl(id, actor);
    }

    nextButton.disabled = !(index + 1 < recording.length);
    prevButton.disabled = !(index - 1 >= 0);
    resetButton.disabled = !index;
}

function drawBlasts () {
    const { blasts } = recording.states.at(index).interval;
    cursor.save();
    cursor.fillStyle = symbolColors.BLAST.toString();
    for (const { shape } of blasts) {
        cursor.save();
        shape.draw(cursor);
        cursor.fill();
        cursor.restore();
    }
    cursor.restore();
}

function drawOldBlasts () {
    cursor.save();
    cursor.fillStyle = symbolColors["OLD BLAST"].toString();
    for (let i = 0; i < index; i++) {
        const { blasts } = recording.states.at(i).interval;
        for (const { shape } of blasts) {
            cursor.save();
            shape.draw(cursor);
            cursor.fill();
            cursor.restore();
        }
    }
    cursor.restore();
}

function drawCollisions () {
    const unit = getUnit();
    const lineThickness = unit / 7;
    const lineLength = unit * 3;
    const normalColor = symbolColors.NORMAL.toString();
    const directionColor = symbolColors.DIRECTION.toString();
    const reflectionColor = symbolColors.REBOUND.toString();
    states.at(index).collisions.forEach(({position, point, rebound, velocity, normal}) => {
        drawLine(cursor, point, point.add(normal.normalize().mul(lineLength)), lineThickness, normalColor); // normal
        drawLine(cursor, point, point.add(velocity.normalize().mul(lineLength)), lineThickness, directionColor); // direction (incoming)
        if (rebound.length) drawLine(cursor, position, position.add(rebound.normalize().mul(lineLength)), lineThickness, reflectionColor); // reflection
    });
}

function drawTerrain () {
    const { terrain } = states.at(index);
    terrain.applyOptions(terrainOptions);
    const plane = terrain.polygon.getBoundingBox();
    cursor.planeSize.x = canvas.width = plane.size.x;
    cursor.planeSize.y = canvas.height = plane.size.y * 1.25;
    terrain.draw(cursor);
}

function drawActors () {
    const radius = getUnit();
    const upColor = symbolColors.NORMAL.toString();
    const upThickness = radius / 7;
    const upLength = radius * 4;
    const lookThickness = radius / 3.5;
    const lookLength = radius * 2;
    for (const [ id, { position, orientation, rotation }] of Object.entries(states.at(index).actors)) {
        const color = playerColors[id].toString();
        const looking = Vector.fromAngle(rotation - (Math.PI / 2));
        const oriented = Vector.fromAngle(orientation + (Math.PI / 2));
        drawLine(cursor, position, position.add(oriented.mul(upLength * 2)), upThickness, upColor);
        drawCircle(cursor, position, radius, color);
        drawLine(cursor, position, position.add(looking.mul(lookLength * 2)), lookThickness, color);
    }
}

function createDotElement (color) {
    const el = document.createElement("span");
    el.classList.add("dot");
    el.style = `--color: ${color.toString()};`;
    return el;
}

function hsl2rgb (h, s, l) {
    const a = s * Math.min(l, 1 - l);
    const f = (n) => {
        const k = (n + h / 30) % 12;
        const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
        return Math.round(255 * color);
    };
    return [f(0), f(8), f(4)];
}

function fillLegend () {
    legend.innerHTML = "";
    for (const [id, color] of Object.entries(playerColors)) {
        const item = document.createElement("li");
        const key = document.createElement("span");
        const value = createDotElement(color);
        key.classList.add("key");
        key.innerText = id;
        value.classList.add("value");
        item.append(key);
        item.append(value);
        legend.append(item);
    }
}

// call after legend is filled
function fillPlayerCards () {
    playerInfoEls = {};
    viewerEls.players.innerHTML = "";
    for (const id of Object.keys(recording.start.actors)) {
        const container = createPlayerHealthEl(id);
        viewerEls.players.append(container);
        playerInfoEls[id] = container;
    }
}

function fillStates () {
    states.splice(0, states.length);
    states.push({
        time: recording.start.time,
        terrain: recording.start.terrain,
        actors: Object.fromEntries(Object.entries(recording.start.actors)),
        collisions: [],
        terrainChanged: false,
        actorsChanged: []
    });
    const allActors = Object.keys(recording.start.actors);
    const allCollisions = [];
    for (const { shots } of recording.ammoMap.legend.stages) {
        for (const shot of shots) {
            for (const collision of shot.collisions) {
                allCollisions.push(collision);
            }
        }
    }
    for (let i = 1; i < recording.length; i++) {
        const state = recording.states.at(i);
        const { terrain } = state.terrain ? state : states.at(-1);
        const collisions = allCollisions.filter(({time}) => time === state.time);
        const actors = {};
        for (const id of allActors) {
            actors[id] = id in state.actors ? state.actors[id] : states.at(-1).actors[id];
        }
        states.push({
            time: state.time,
            terrain: terrain,
            actors: actors,
            terrainChanged: !!state.terrain,
            actorsChanged: Object.keys(state.actors),
            collisions: collisions
        });
    }
}

function createPlayerHealthEl (id) {
    const container = document.createElement("div");
    container.classList.add("entry");
    container.dataset.player = id;
    const header = document.createElement("h4");
    header.classList.add("header");
    const idCard = document.createElement("span");
    idCard.classList.add();
    idCard.innerText = id.slice(0, 5) + "...";
    header.append(idCard);
    header.append(createDotElement(playerColors[id]));
    const content = document.createElement("ul");
    content.classList.add("data");
    for (const hp of recording.start.actors[id].hitpoints) {
        const el = document.createElement("li");
        const nameCard = document.createElement("span");
        nameCard.innerText = HitpointMap[hp.type]?.name || "???";
        const hpData = document.createElement("span");
        const hpDetail = document.createElement("span");
        hpData.innerText = "? / ?";
        hpDetail.innerText = "(?? %)";
        el.append(nameCard);
        el.append(hpData);
        el.append(hpDetail);
        content.append(el);
    }
    container.append(header);
    container.append(content);
    return container;
}

function populatePlayerHealthEl (id, actorState) {
    const { hitpoints } = actorState;
    const hpDataEls = Array.from(playerInfoEls[id].querySelectorAll(":scope ul.data > li > :nth-child(2)"));
    const hpDetailEls = Array.from(playerInfoEls[id].querySelectorAll(":scope ul.data > li > :nth-child(3)"));
    for (let i = 0; i < hitpoints.length && i < hpDataEls.length && i < hpDetailEls.length; i++) {
        const hp = hitpoints[i];
        const data = hpDataEls[i];
        const detail = hpDetailEls[i];
        const percent = (hp.amount / hp.max) * 100;
        data.innerText = `${hp.amount} / ${hp.max}`;
        detail.innerText = `(${percent ? (percent).toFixed(1) : 0} %)`;
    }
}