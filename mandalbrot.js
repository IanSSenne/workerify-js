import Workerify from "./lib.js";
const g = new URLSearchParams(window.location.search)
let opts = null;
try { opts = JSON.parse(g.get("opts")) } catch (e) {
    opts = [];
}
//calculate mandalbrot
function workerifyInputFunc() {
    function getColor(x, y, conf, palette) {
        const { offsetx, offsety, panx, pany, zoom, maxiterations } = conf;
        var x0 = (x + offsetx + panx) / zoom;
        var y0 = (y + offsety + pany) / zoom;
        var a = 0;
        var b = 0;
        var rx = 0;
        var ry = 0;
        var iterations = 0;
        while (iterations < maxiterations && (rx * rx + ry * ry <= 4)) {
            rx = a * a - b * b + x0;
            ry = 2 * a * b + y0;
            a = rx;
            b = ry;
            iterations++;
        }
        var color;
        if (iterations == maxiterations) {
            color = { r: 0, g: 0, b: 0 };
        } else {
            var index = Math.floor((iterations / (maxiterations - 1)) * 255);
            color = palette[index];
        }
        return color;
    }
    return function ({ width, height, chunkx, chunky, conf, palette, sampleCount }) {
        let data = new Uint8ClampedArray(Array(width * height * 4).fill(0));
        var offsetx = conf.offsetx;
        var offsety = conf.offsety;
        var panx = conf.panx;
        var pany = conf.pany;
        var zoom = conf.zoom;
        var maxiterations = conf.maxiterations;
        for (let _x = 0; _x < width; _x++) {
            for (let _y = 0; _y < height; _y++) {
                const x = chunkx + _x;
                const y = chunky + _y;
                let color = { r: 0, g: 0, b: 0 };
                for (let i = 0; i < sampleCount; i++) {
                    let sample = getColor(x + Math.random(), y + Math.random(), conf, palette);
                    color.r += sample.r;
                    color.g += sample.g;
                    color.b += sample.b;
                }
                var pixelindex = (_y * width + _x) * 4;
                data[pixelindex] = color.r / sampleCount;
                data[pixelindex + 1] = color.g / sampleCount;
                data[pixelindex + 2] = color.b / sampleCount;
                data[pixelindex + 3] = 255
            }
        }
        return Array.from(data);
    }
}
const DemoPureFunc = workerifyInputFunc();
const [modifyImage, terminate, WorkerifyWorkerHost] = Workerify(workerifyInputFunc, { maxWorkers: 25, timeout: 5 * 60000, idleTime: 100, info: false, initializer: true });

//simulate using a single worker for task, not on main thread to not do page blocking...
const [modifyImageSingle, terminateSingle, WorkerifyWorkerHostSingle] = Workerify(workerifyInputFunc, { maxWorkers: 1, timeout: 5 * 60000, idleTime: 100, info: false, initializer: true });

//ui / request render

function resize() {
    const c = document.getElementById("imageCanvas");
    c.setAttribute("width", window.innerWidth);
    c.setAttribute("height", window.innerHeight);
    runModifyImage();
}
window.addEventListener("resize", resize);
var canvas = document.getElementById('imageCanvas');
canvas.addEventListener("mousedown", (evt) => {
    if (evt.button != 0) return;
    let zoom = +document.getElementById("zoom").value;
    const x = ((canvas.width / 2) - evt.clientX) / zoom;
    const y = ((canvas.height / 2) - evt.clientY) / zoom;
    document.getElementById("panx").value = (Number(document.getElementById("panx").value) - x).toString();
    document.getElementById("pany").value = (Number(document.getElementById("pany").value) - y).toString();
    runModifyImage();
})
var ctx = canvas.getContext('2d');

let requestId = null;
var palette = [];
var roffset = 24;
var goffset = 16;
var boffset = 0;
for (var i = 0; i < 256; i++) {
    palette[i] = { r: roffset, g: goffset, b: boffset };

    if (i < 64) {
        roffset += 3;
    } else if (i < 128) {
        goffset += 3;
    } else if (i < 192) {
        boffset += 3;
    }
    // palette[i] = { r: Math.floor(Math.random() * 256), g: Math.floor(Math.random() * 256), b: Math.floor(Math.random() * 256) }
}
function runModifyImage() {
    if (WorkerifyWorkerHost.TaskQueue.length > 0) {
        if (requestId === null) {
            requestId = setTimeout(runModifyImage, 10);
        } else {
            clearTimeout(requestId);
            requestId = setTimeout(runModifyImage, 10);
        }
        return;
    }
    requestId = null;

    [...document.querySelectorAll("input")].forEach((inp, ind) => {
        opts[ind] = +inp.value;
    });
    let url = new URL(window.location.toString());
    url.search = "opts=" + JSON.stringify(opts);
    url.hash = "#";
    document.getElementById("save").href = url.toString();
    url.pathname = "/workerify-js/mandalbrot-record.html";
    document.getElementById("record").href = url.toString();
    let chunkSize = +document.getElementById("chunksize").value;
    chunkSize = Number.isNaN(chunkSize) ? 32 : Math.max(1, chunkSize);
    const conf = {};
    conf.offsetx = -canvas.width / 2;
    conf.offsety = -canvas.height / 2;
    conf.panx = +document.getElementById("panx").value * +document.getElementById("zoom").value;
    conf.pany = +document.getElementById("pany").value * +document.getElementById("zoom").value;
    conf.zoom = +document.getElementById("zoom").value * 4;
    conf.maxiterations = +document.getElementById("itter").value;
    var sampleCount = +document.getElementById("samples").value;
    const tasks = document.getElementById("tasks");
    const totalChunks = Math.ceil(canvas.width / chunkSize) * Math.ceil(canvas.height / chunkSize);
    let completeChunks = 0;
    const useWorkerify = document.getElementById("use-workerify").checked;
    console.log(useWorkerify);
    for (let y = 0; y < canvas.height; y += chunkSize) {
        for (let x = 0; x < canvas.width; x += chunkSize) {
            if (useWorkerify) {
                modifyImage({ width: chunkSize, height: chunkSize, chunkx: x, chunky: y, conf, palette, sampleCount }).then(
                    raw => {
                        ctx.putImageData(new ImageData(new Uint8ClampedArray(raw), chunkSize, chunkSize), x, y);
                        completeChunks++;
                        tasks.innerText = completeChunks + "/" + totalChunks;
                    }
                );
            } else {
                modifyImageSingle({ width: chunkSize, height: chunkSize, chunkx: x, chunky: y, conf, palette, sampleCount }).then(
                    raw => {
                        ctx.putImageData(new ImageData(new Uint8ClampedArray(raw), chunkSize, chunkSize), x, y);
                        completeChunks++;
                        tasks.innerText = completeChunks + "/" + totalChunks;
                    }
                );
            }
        }
    }
}
[...document.querySelectorAll("input[watched]")].forEach(inp => {
    inp.addEventListener("change", runModifyImage);
});
if (opts) {
    [...document.querySelectorAll("input")].forEach(inp => {
        let v = opts.shift();
        if (v) inp.value = v;
    });
} else {
    opts = [];
}

resize();