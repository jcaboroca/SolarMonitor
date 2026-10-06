// Safari no deja recorrer un ReadableStream con `for await` y pdf.js lo hace al
// leer el texto. Solo se anade si falta.
if (typeof ReadableStream !== "undefined" && !ReadableStream.prototype[Symbol.asyncIterator]) {
  ReadableStream.prototype.values = async function* ({ preventCancel = false } = {}) {
    const lector = this.getReader();
    try {
      while (true) {
        const { done, value } = await lector.read();
        if (done) return;
        yield value;
      }
    } finally {
      if (!preventCancel) lector.cancel().catch(() => {});
      lector.releaseLock();
    }
  };
  ReadableStream.prototype[Symbol.asyncIterator] = ReadableStream.prototype.values;
}
