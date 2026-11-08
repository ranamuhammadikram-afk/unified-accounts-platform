const zlib = require("zlib");

/**
 * Minimal streaming .zip writer (no extra packages). Files are written one at a time straight
 * to the output stream, so memory use stays at about one file. Photos and PDFs are stored as
 * they are (already compressed); text such as JSON or CSV is deflated.
 */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  if (typeof zlib.crc32 === "function") return zlib.crc32(buf) >>> 0;
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function dosDateTime(d) {
  const date = new Date(d || Date.now());
  const year = Math.max(1980, date.getFullYear());
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

class ZipWriter {
  constructor(out) {
    this.out = out;
    this.offset = 0;
    this.entries = [];
  }

  async write(buf) {
    this.offset += buf.length;
    if (!this.out.write(buf)) {
      await new Promise((resolve, reject) => {
        const onDrain = () => {
          this.out.off("close", onClose);
          resolve();
        };
        const onClose = () => {
          this.out.off("drain", onDrain);
          reject(new Error("The download was closed before the backup finished."));
        };
        this.out.once("drain", onDrain);
        this.out.once("close", onClose);
      });
    }
  }

  /** Adds one file. `data` is a Buffer or string; `compress` deflates it (use for text). */
  async addFile(name, data, { date, compress = false } = {}) {
    const raw = Buffer.isBuffer(data) ? data : Buffer.from(String(data), "utf8");
    const body = compress ? zlib.deflateRawSync(raw, { level: 9 }) : raw;
    const method = compress ? 8 : 0;
    const crc = crc32(raw);
    const nameBuf = Buffer.from(name, "utf8");
    const { time, date: dosDate } = dosDateTime(date);
    if (this.offset + body.length > 0xfffffff0) throw new Error("The backup is larger than 4 GB.");

    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4); // version needed
    header.writeUInt16LE(0x0800, 6); // UTF-8 file names
    header.writeUInt16LE(method, 8);
    header.writeUInt16LE(time, 10);
    header.writeUInt16LE(dosDate, 12);
    header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(body.length, 18);
    header.writeUInt32LE(raw.length, 22);
    header.writeUInt16LE(nameBuf.length, 26);
    header.writeUInt16LE(0, 28);

    const localOffset = this.offset;
    await this.write(header);
    await this.write(nameBuf);
    await this.write(body);
    this.entries.push({ nameBuf, method, time, dosDate, crc, size: body.length, rawSize: raw.length, localOffset });
  }

  /** Writes the central directory. Call once, after the last file. */
  async finish() {
    const cdStart = this.offset;
    for (const e of this.entries) {
      const h = Buffer.alloc(46);
      h.writeUInt32LE(0x02014b50, 0);
      h.writeUInt16LE(20, 4); // version made by
      h.writeUInt16LE(20, 6); // version needed
      h.writeUInt16LE(0x0800, 8);
      h.writeUInt16LE(e.method, 10);
      h.writeUInt16LE(e.time, 12);
      h.writeUInt16LE(e.dosDate, 14);
      h.writeUInt32LE(e.crc, 16);
      h.writeUInt32LE(e.size, 20);
      h.writeUInt32LE(e.rawSize, 24);
      h.writeUInt16LE(e.nameBuf.length, 28);
      // extra, comment, disk start, internal attrs = 0
      h.writeUInt32LE(0, 38); // external attrs
      h.writeUInt32LE(e.localOffset, 42);
      await this.write(h);
      await this.write(e.nameBuf);
    }
    const cdSize = this.offset - cdStart;
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(this.entries.length, 8);
    end.writeUInt16LE(this.entries.length, 10);
    end.writeUInt32LE(cdSize, 12);
    end.writeUInt32LE(cdStart, 16);
    await this.write(end);
  }
}

module.exports = { ZipWriter, crc32 };
