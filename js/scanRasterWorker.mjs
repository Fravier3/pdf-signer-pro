import { perform } from "./scanRasterTasks.mjs";

self.onmessage = async ({ data }) => {
  const { ticket } = data;
  try {
    const result = await perform(data);
    self.postMessage({ ticket, result }, result?.data?.buffer ? [result.data.buffer] : []);
  } catch (error) {
    self.postMessage({ ticket, error: error.message });
  }
};
