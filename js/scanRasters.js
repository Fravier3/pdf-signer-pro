const ScanRasters = (() => {
  const workers = new Map();
  const pending = new Map();
  let ticket = 0;
  let supportsWorkerCanvas;
  const base = document.baseURI;
  let tasks;

  function close(name) {
    const client = workers.get(name);
    if (!client) return;
    workers.delete(name);
    clearTimeout(client.idle);
    client.worker.terminate();
    for (const [key, request] of pending) {
      if (request.name !== name) continue;
      clearTimeout(request.timeout);
      pending.delete(key);
      request.reject(new Error("Se cerró el procesamiento local."));
    }
  }

  function clientFor(name) {
    if (workers.has(name)) return workers.get(name);
    const worker = new Worker(new URL("js/scanRasterWorker.mjs", base), { type: "module" });
    const client = { worker, idle: 0, active: 0 };
    workers.set(name, client);
    worker.onmessage = ({ data }) => {
      const request = pending.get(data.ticket);
      if (!request) return;
      pending.delete(data.ticket);
      clearTimeout(request.timeout);
      if (--client.active === 0) client.idle = setTimeout(() => close(name), 45_000);
      if (data.error) request.reject(new Error(data.error));
      else request.resolve(data.result);
    };
    worker.onerror = () => close(name);
    return client;
  }

  function run(id, operation, fields = {}) {
    if (supportsWorkerCanvas === undefined) {
      try {
        supportsWorkerCanvas = typeof Worker !== "undefined" && !!new OffscreenCanvas(1, 1).getContext("2d");
      } catch {
        supportsWorkerCanvas = false;
      }
    }
    if (!supportsWorkerCanvas) {
      tasks ||= import(new URL("js/scanRasterTasks.mjs", base).href);
      return tasks.then(({ perform }) => perform({ id, operation, ...fields }));
    }
    const client = clientFor(id);
    clearTimeout(client.idle);
    client.active++;
    const key = ++ticket;
    const transfer = fields.image?.data?.buffer ? [fields.image.data.buffer] : [];
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => close(id), 90_000);
      pending.set(key, { name: id, resolve, reject, timeout });
      try {
        client.worker.postMessage({ ticket: key, id, operation, ...fields }, transfer);
      } catch (error) {
        pending.delete(key);
        clearTimeout(timeout);
        if (--client.active === 0) client.idle = setTimeout(() => close(id), 45_000);
        reject(error);
      }
    });
  }

  return { run };
})();
