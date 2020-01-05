const WorkerifyDefaultOptions = {
    maxWorkers: 1,
    timeout: 60000,
    idleTime: 30000,
    info: false
};
let generatedId = 0;
function textToUrl(arr) {
    const str = arr.filter((v) => typeof v === "string").map((_, i) => {
        return `// Start Workerify SubModule ${i}\n${_}\n// End Workerify SubModule ${i}`;
    }).join("\n");
    const blob = new Blob([str, "\n//# sourceURL=JS://WorkerifyJS/generated-" + generatedId++]);
    const url = URL.createObjectURL(blob);
    return url;
}
class WorkerifyWorkerHost {
    constructor(url, onTaskComplete, id, preserve, options) {
        this.id = id;
        this.url = url;
        this.onTaskComplete = onTaskComplete;
        this.Worker = null;
        this.isWorking = false;
        this.lastCallId = null;
        this.asyncCallback = null;
        this.preserved = preserve;
        this.options = options
        this.timeout = options.timeout;
        this.idleTime = options.idleTime;
        this.calls = 0;
        if (this.preserved) this.populateWorker();
    }
    destroy() {
        if (this.options.info) console.log("terminating worker for worker host with id=" + this.id, "worker recieved " + this.calls + " calls");
        this.calls = 0;
        if (this.Worker) {
            this.Worker.terminate();
            this.Worker = null;
        }
    }
    populateWorker() {
        if (this.Worker === null) {
            this.Worker = new Worker(this.url);
            this.Worker.onmessage = ({ data }) => {
                if (!this.asyncCallback) debugger;
                data = JSON.parse(data);
                if (data.err) {
                    this.asyncCallback(null, data.err);
                } else {
                    this.asyncCallback(data.value, null);
                }
            }
            this.Worker.onerror = (err) => {
                if (this.asyncCallback) {
                    this.asyncCallback(null, err);
                }
            }
        }
    }
    call(args) {
        this.isWorking = true;
        this.calls++;
        if (!this.Worker) {
            this.populateWorker();
        }
        return new Promise((resolve, reject) => {
            if (this.lastCallId != null) {
                clearTimeout(this.lastCallId);
            }
            if (!this.preserved) this.lastCallId = setTimeout(() => {
                this.lastCallId = null;
                this.destroy();
            }, this.timeout);
            if (this.idleTimeId != null) clearTimeout(this.idleTimeId);
            this.asyncCallback = (value, err) => {
                this.asyncCallback = null;
                if (err) {
                    reject(err);
                } else {
                    resolve(value);
                }
                this.isWorking = false;
                if (!this.preserved) this.idleTimeId = setTimeout(() => {
                    this.idleTimeId = null;
                    this.destroy();
                }, this.idleTime);
                this.onTaskComplete(this);
            };
            if (this.options.info) console.log("sending data to worker with id=" + this.id);
            this.Worker.postMessage(JSON.stringify(args));
        });
    }
}
class WorkifyManager {
    constructor(func, options) {
        this.func = func;
        this.options = options;
        this.url = textToUrl([`const func = ${this.func}`, `globalThis.onmessage=async ({data})=>{
    try{
        let res = func(...JSON.parse(data));
        if(res instanceof Promise)res = await res;
        postMessage(JSON.stringify({value:res,err:null}));
    }catch(e){
        postMessage(JSON.stringify({value:null,err:{message:e.message,raw:{...e}}}));
    }
}`]);
        this.Workers = [];
        this.TaskQueue = [];
        this.inactive = false;
        for (let i = 0; i < this.options.maxWorkers; i++) {
            this.Workers.push(new WorkerifyWorkerHost(this.url, this.onTaskComplete.bind(this), i, i == 0, options));
        }
        Object.freeze(this.Workers);
    }
    onTaskComplete(worker) {
        if (this.TaskQueue[0]) {
            const Task = this.TaskQueue.shift();
            worker.call(Task.args).then(Task.resolve).catch(Task.reject);
        }
    }
    call(args) {
        if (this.inactive) {
            throw new Error("unable to call Workerify function after destruction has occured");
        }
        for (let i = 0; i < this.Workers.length; i++) {
            if (!this.Workers[i].isWorking) {
                return this.Workers[i].call(args)
            }
        }
        let taskSuccess = null, taskFail = null;
        const TaskPromise = new Promise((resolve, reject) => {
            taskSuccess = (val) => resolve(val);
            taskFail = (val) => reject(val);
        })
        this.TaskQueue.push({ args, resolve: taskSuccess, reject: taskFail });
        return TaskPromise;
    }
    destroy() {
        this.inactive = true;
        for (let i = 0; i < this.Workers.length; i++) {
            this.Workers[i].destroy();
        }
        this.Workers = [];
    }
}
export default function Workerify(func, options) {
    const ComputedOptions = Object.assign(WorkerifyDefaultOptions, options);
    const Manager = new WorkifyManager(func, ComputedOptions);
    const call = (...args) => Manager.call(args);
    return [call, Manager.destroy.bind(Manager), Manager];
}