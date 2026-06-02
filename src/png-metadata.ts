const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const metadataKey = "application/vnd.quickdraw+json";
// Legacy key written by quick-paint <= 0.1.1; still read so older PNGs stay editable.
const legacyMetadataKey = "application/vnd.quick-paint+json";

type Chunk = {
  type: string;
  data: Buffer;
};

export function embedSceneMetadata(png: Buffer, scene: unknown): Buffer {
  const chunks = readChunks(png).filter((chunk) => !(chunk.type === "tEXt" && (textChunkKey(chunk.data) === metadataKey || textChunkKey(chunk.data) === legacyMetadataKey)));
  const metadata = Buffer.from(`${metadataKey}\0${JSON.stringify(scene)}`, "utf8");
  const insertAt = chunks.findIndex((chunk) => chunk.type === "IEND");
  if (insertAt === -1) throw new Error("invalid PNG: missing IEND");
  chunks.splice(insertAt, 0, { type: "tEXt", data: metadata });
  return writeChunks(chunks);
}

export function extractSceneMetadata(png: Buffer): unknown | null {
  for (const chunk of readChunks(png)) {
    if (chunk.type !== "tEXt") continue;
    const separator = chunk.data.indexOf(0);
    if (separator === -1) continue;
    const key = chunk.data.subarray(0, separator).toString("utf8");
    if (key !== metadataKey && key !== legacyMetadataKey) continue;
    return JSON.parse(chunk.data.subarray(separator + 1).toString("utf8"));
  }
  return null;
}

function readChunks(png: Buffer): Chunk[] {
  if (png.length < pngSignature.length || !png.subarray(0, pngSignature.length).equals(pngSignature)) {
    throw new Error("invalid PNG signature");
  }
  const chunks: Chunk[] = [];
  let offset = pngSignature.length;
  while (offset < png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.subarray(offset + 4, offset + 8).toString("ascii");
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (dataEnd + 4 > png.length) throw new Error("invalid PNG chunk length");
    chunks.push({ type, data: png.subarray(dataStart, dataEnd) });
    offset = dataEnd + 4;
    if (type === "IEND") break;
  }
  return chunks;
}

function writeChunks(chunks: Chunk[]): Buffer {
  return Buffer.concat([
    pngSignature,
    ...chunks.map((chunk) => {
      const type = Buffer.from(chunk.type, "ascii");
      const length = Buffer.alloc(4);
      length.writeUInt32BE(chunk.data.length, 0);
      const crc = Buffer.alloc(4);
      crc.writeUInt32BE(crc32(Buffer.concat([type, chunk.data])), 0);
      return Buffer.concat([length, type, chunk.data, crc]);
    })
  ]);
}

function textChunkKey(data: Buffer): string | null {
  const separator = data.indexOf(0);
  if (separator === -1) return null;
  return data.subarray(0, separator).toString("utf8");
}

const crcTable = new Uint32Array(256).map((_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  return value >>> 0;
});

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
